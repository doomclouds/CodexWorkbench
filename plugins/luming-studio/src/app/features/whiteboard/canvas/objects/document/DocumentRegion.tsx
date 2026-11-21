import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  STUDIO_TOOLS,
  type Actor,
  type Anchor,
  type BoardElement,
  type Feedback,
  type StudioClient,
  type StyleProfile,
} from '../../../../../../contracts/studio.js';
import { documentSurface } from '../../../../../../shared/document-surface.js';
import {
  documentAnchorState,
  documentBlockText,
  flattenDocumentBlocks,
  type DocumentBlock,
  type DocumentContent,
} from '../../../../../../contracts/document.js';
import { assetDisplayUrl, type Point } from '../../scene/canvas-model.js';
import {
  studioRequest,
  downloadStudioBlob,
  downloadStudioFile,
} from '../../../../../transport/client.js';
import { CommentPin } from '../../../../../shared/comments/CommentPin.js';
import { createDraftWorkspace, type DraftWorkspace } from '../../../draft-workspace.js';
import { useDocumentRegionEvents } from './document-interactions.js';
import {
  DocumentDraftRecovery,
  DocumentHeading,
  DocumentOutline,
  DocumentSaveNotices,
  DocumentSearch,
  DocumentViewport,
} from './DocumentRegionContent.js';
import useDocumentDraft from './useDocumentDraft.js';
import useDocumentAnnotations from './useDocumentAnnotations.js';
import useDocumentFocusSurface, { type DocumentFocusSurface } from './useDocumentFocusSurface.js';
import './document-region.css';

export type { DocumentFocusSurface } from './useDocumentFocusSurface.js';

export interface DocumentActivity {
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
}
interface DocumentRegionProps {
  element: BoardElement;
  artifactId: string;
  actor: Actor;
  client: StudioClient;
  draftWorkspace?: DraftWorkspace;
  canEdit: boolean;
  canAnnotate: boolean;
  interactive: boolean;
  expanded: boolean;
  focusHost: HTMLElement | null;
  theme: 'light' | 'dark';
  readingZoom?: number;
  editRequest?: number;
  target?: Anchor;
  annotationActive?: boolean;
  onAnnotationModeChange?(active: boolean): void;
  styleProfile?: StyleProfile;
  onMoveStart?(event: React.PointerEvent): void;
  onInteract(active: boolean): void;
  onEdit(): void;
  onExpand(): void;
  onExit(): void;
  onSave(
    document: DocumentContent,
    title: string,
    base: BoardElement,
    overwrite: boolean,
  ): Promise<BoardElement | false>;
  onUseCurrent?: () => void;
  onActivity(activity: DocumentActivity): void;
  initialScrollTop?: number;
  onReadingScroll?(point: Point): void;
  onFocusSurface?(surface: DocumentFocusSurface | null): void;
  boardPoint?(clientX: number, clientY: number): Point;
  activities?: readonly Feedback[];
  onFeedbackSelect?(feedback: Feedback, point: Point): void;
  onAnnotate(anchor: Anchor, version: number, point?: { x: number; y: number }): void;
}

function documentPresentation(
  element: BoardElement,
  readingZoom: number,
  expanded: boolean,
  styleProfile?: StyleProfile,
) {
  const surface = documentSurface(element, styleProfile);
  const projectedWidth = element.w * readingZoom;
  const projectedHeight = element.h * readingZoom;
  let inlineLayout = 'detail';
  if (projectedWidth < 120 || projectedHeight < 56) {
    inlineLayout = 'outline';
  } else if (projectedWidth < 220 || projectedHeight < 90) {
    inlineLayout = 'thumbnail';
  } else if (projectedWidth < 320 || projectedHeight < 140) {
    inlineLayout = 'compact';
  }

  const showHeading = expanded || inlineLayout !== 'outline';
  const showHeadingActions = expanded || inlineLayout === 'detail' || inlineLayout === 'compact';
  const surfaceStyle = {
    '--document-backdrop': surface.backdrop,
    '--document-paper': surface.paper,
    '--document-ink': surface.ink,
    '--document-muted': surface.muted,
    '--document-rule': surface.rule,
    '--document-code': surface.code,
    '--document-link': surface.link,
    '--document-danger': surface.scheme === 'dark' ? '#FFADB5' : '#9E303B',
    '--document-ui-scale': expanded ? 1 : Math.min(1 / readingZoom, 1.5),
    colorScheme: surface.scheme,
  } as CSSProperties;

  return { scheme: surface.scheme, inlineLayout, showHeading, showHeadingActions, surfaceStyle };
}

function documentCommentPins(
  activities: readonly Feedback[] | undefined,
  element: BoardElement,
  readingZoom: number,
  onFeedbackSelect: DocumentRegionProps['onFeedbackSelect'],
) {
  const commentPins = activities?.length ? new Map<string, ReactNode[]>() : undefined;
  if (commentPins) {
    activities?.forEach((feedback) => {
      const { pin, blockIds, elementIds } = feedback.anchor;
      const blockId = blockIds?.[0];
      if (pin?.coordinateSpace !== 'document' || elementIds?.[0] !== element.id || !blockId) {
        return;
      }

      const pins = commentPins.get(blockId) ?? [];
      pins.push(
        <CommentPin
          key={feedback.id}
          feedback={feedback}
          left={`${pin.x * 100}%`}
          top={`${pin.y * 100}%`}
          zoom={readingZoom}
          onSelect={onFeedbackSelect}
        />,
      );
      commentPins.set(blockId, pins);
    });
  }

  return commentPins ? (blockId: string) => commentPins.get(blockId) : undefined;
}

type DocumentDraft = ReturnType<typeof useDocumentDraft>;
type DocumentAnnotations = ReturnType<typeof useDocumentAnnotations>;

interface DocumentEditingOptions {
  expanded: boolean;
  interactive: boolean;
  canEdit: boolean;
  annotationActive: boolean;
  editRequest?: number;
  onEdit(): void;
  onInteract(active: boolean): void;
}

function useDocumentEditing({
  expanded,
  interactive,
  canEdit,
  annotationActive,
  editRequest,
  onEdit,
  onInteract,
}: DocumentEditingOptions) {
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [consumedEditRequest, setConsumedEditRequest] = useState<number>();
  const [pendingEditBlock, setPendingEditBlock] = useState<string>();
  const [editFocusBlockId, setEditFocusBlockId] = useState<string>();
  const editingAllowed = interactive && !annotationActive;
  const hasEditRequest = editRequest && consumedEditRequest !== editRequest;
  const shouldStopEditing = !expanded || !editingAllowed;
  if (expanded && canEdit && hasEditRequest) {
    setConsumedEditRequest(editRequest);
    setEditFocusBlockId(pendingEditBlock);
    setPendingEditBlock(undefined);
    setEditing(true);
  } else if (editing && shouldStopEditing && !composing) {
    setEditing(false);
  }

  const notifyEdit = useEffectEvent(() => onInteract(true));
  useEffect(() => {
    if (consumedEditRequest) {
      notifyEdit();
    }
  }, [consumedEditRequest]);
  function requestEdit(blockId?: string) {
    setPendingEditBlock(blockId);
    onEdit();
  }

  return {
    editing,
    setEditing,
    composing,
    setComposing,
    editFocusBlockId,
    requestEdit,
    editingAllowed,
    showEditor: expanded && editing && ((canEdit && editingAllowed) || composing),
  };
}

interface ReaderOptions {
  elementId: string;
  version: number;
  expanded: boolean;
  zoom: number;
  focusHost: HTMLElement | null;
  interactive: boolean;
  annotationActive: boolean;
  editing: boolean;
  showEditor: boolean;
  initialScrollTop?: number;
  onReadingScroll?: (point: Point) => void;
  onFocusSurface?: (surface: DocumentFocusSurface | null) => void;
  prepareExit(): Promise<boolean>;
}

function useDocumentReader({
  elementId,
  version,
  expanded,
  zoom,
  focusHost,
  interactive,
  annotationActive,
  editing,
  showEditor,
  initialScrollTop,
  onReadingScroll,
  onFocusSurface,
  prepareExit,
}: ReaderOptions) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef({ inline: 0, focus: 0 });
  const previousExpanded = useRef(false);
  useLayoutEffect(() => {
    if (expanded && !focusHost) {
      return;
    }

    if (expanded && !previousExpanded.current) {
      scrollPosition.current.focus = initialScrollTop ?? scrollPosition.current.inline;
    }

    previousExpanded.current = expanded;
    if (scroll.current) {
      scroll.current.scrollTop = expanded
        ? scrollPosition.current.focus
        : scrollPosition.current.inline;
    }
  }, [expanded, focusHost, showEditor, initialScrollTop]);
  const scrollDocumentBy = useCallback(({ x, y }: Point) => {
    const node = scroll.current;
    if (node) {
      node.scrollLeft += x;
      node.scrollTop += y;
    }
  }, []);
  useDocumentFocusSurface({
    expanded,
    id: elementId,
    version,
    zoom,
    host: focusHost,
    scroll,
    content,
    scrollBy: scrollDocumentBy,
    prepareExit,
    onChange: onFocusSurface,
  });
  const focusReader = useEffectEvent(() => {
    if (!annotationActive) {
      scroll.current?.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    if (interactive && !expanded && !editing) {
      focusReader();
    }
  }, [interactive, expanded, editing]);
  useEffect(() => {
    if (expanded && focusHost && !editing) {
      focusReader();
    }
  }, [expanded, focusHost, editing]);

  function handleReaderScroll(event: React.UIEvent<HTMLDivElement>) {
    const y = event.currentTarget.scrollTop;
    scrollPosition.current[expanded ? 'focus' : 'inline'] = y;
    if (expanded) {
      onReadingScroll?.({ x: 0, y });
    }
  }

  return { scroll, content, handleReaderScroll, scrollDocumentBy };
}

function useDocumentSearch(
  blocks: DocumentBlock[],
  editing: boolean,
  scroll: RefObject<HTMLDivElement | null>,
  scrollBy: (delta: Point) => void,
  expanded: boolean,
  readingZoom: number,
  focusHost: HTMLElement | null,
  targetIds: string[],
  version: number,
  targetPin?: Anchor['pin'],
) {
  const [find, setFind] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const headings = blocks.filter((block) => block.type === 'heading');
  const query = find.trim().toLocaleLowerCase();
  const matches = query
    ? blocks.filter((block) => documentBlockText(block).toLocaleLowerCase().includes(query))
    : [];
  function jump(id: string) {
    const selector = editing
      ? `.bn-block-outer[data-id="${CSS.escape(id)}"]`
      : `[data-document-block-id="${CSS.escape(id)}"]`;
    const reader = scroll.current;
    const block = reader?.querySelector<HTMLElement>(selector);
    if (block && reader) {
      const offset = block.getBoundingClientRect().top - reader.getBoundingClientRect().top;
      scrollBy({ x: 0, y: offset / (expanded ? 1 : readingZoom) - 24 });
    }
  }

  function handleFindChange(value: string) {
    setFind(value);
    setFindIndex(0);
  }

  const revealFirstMatch = useEffectEvent(() => {
    if (find.trim() && matches.length) {
      jump(matches[0].id);
    }
  });
  useEffect(() => {
    revealFirstMatch();
  }, [find]);
  function nextMatch(delta: number) {
    if (!matches.length) {
      return;
    }

    const index = (findIndex + delta + matches.length) % matches.length;
    setFindIndex(index);
    jump(matches[index].id);
  }

  const targetId = targetIds[0];
  const targetIdsKey = targetIds.join(',');
  const revealTarget = useEffectEvent((id: string, pinned: boolean) => {
    const reader = scroll.current;
    if (pinned && reader) {
      const block = reader
        .querySelector(`[data-document-block-id="${CSS.escape(id)}"]`)
        ?.getBoundingClientRect();
      const viewport = reader.getBoundingClientRect();
      if (block && block.bottom > viewport.top && block.top < viewport.bottom) {
        return;
      }
    }

    jump(id);
  });
  useEffect(() => {
    if (targetId) {
      revealTarget(targetId, Boolean(targetPin));
    }
  }, [targetId, targetIdsKey, version, editing, targetPin, focusHost]);

  return {
    find,
    findIndex,
    headings,
    matches,
    onChange: handleFindChange,
    onAdvance: nextMatch,
    onReveal: jump,
  };
}

function useDocumentExportMenu(
  showActions: boolean,
  getShell: () => HTMLElement | null,
  expanded: boolean,
) {
  const [exportMenu, setExportMenu] = useState(false);
  if (exportMenu && !showActions) {
    setExportMenu(false);
  }

  const getActiveShell = useEffectEvent(getShell);
  useEffect(() => {
    if (!exportMenu || !showActions) {
      return;
    }

    function closeOutside(event: PointerEvent) {
      const menu = getActiveShell()?.querySelector('.studio-document-export');
      if (event.target instanceof Node && !menu?.contains(event.target)) {
        setExportMenu(false);
      }
    }

    window.document.addEventListener('pointerdown', closeOutside, true);

    return () => window.document.removeEventListener('pointerdown', closeOutside, true);
  }, [exportMenu, expanded, showActions]);

  return {
    open: exportMenu,
    close: () => setExportMenu(false),
    toggle: () => setExportMenu((value) => !value),
  };
}

function useDocumentFiles(client: StudioClient, artifactId: string, canEdit: boolean) {
  const pendingAssets = useRef(new Set<() => void>());
  useEffect(() => {
    const pending = pendingAssets.current;

    return () => {
      for (const cancel of pending) {
        cancel();
      }
    };
  }, []);
  const uploadFile = async (file: File) => {
    if (!canEdit || !client.baseUrl) {
      throw new Error('请连接可编辑的 Studio 服务后上传图片。');
    }
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
      throw new Error('请选择不超过 20 MB 的图片。');
    }

    const response = await studioRequest(
      client,
      new URL(`/api/assets?artifactId=${encodeURIComponent(artifactId)}`, client.baseUrl),
      {
        method: 'POST',
        headers: {
          ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}),
          'Content-Type': file.type,
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      },
    );
    const result = (await response.json()) as { src?: string; error?: { message?: string } };
    if (!response.ok || !result.src) {
      throw new Error(result.error?.message || '文档图片上传失败。');
    }

    return result.src;
  };

  const resolveFileUrl = async (source: string): Promise<string> => {
    const ready = assetDisplayUrl(source, client);
    if (ready) {
      return ready;
    }

    const failed = client.assetState?.(source);
    if (failed?.status === 'error') {
      throw new Error(failed.message || '文档图片读取失败。');
    }
    if (!client.subscribeAssets) {
      throw new Error('文档图片尚不可用，请重新打开文档。');
    }

    const pending = pendingAssets.current;
    const subscribe = client.subscribeAssets;

    return new Promise((resolve, reject) => {
      const subscription: { unsubscribe?: () => void } = {};
      let settled = false;
      function finish(url?: string, cause?: Error) {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        subscription.unsubscribe?.();
        pending.delete(cancel);
        if (url) {
          resolve(url);
        } else {
          reject(cause);
        }
      }

      const cancel = () => finish(undefined, new Error('文档已关闭，图片读取已取消。'));
      const timer = setTimeout(
        () => finish(undefined, new Error('文档图片读取超时，请重试。')),
        15_000,
      );
      pending.add(cancel);
      function checkAsset() {
        const url = assetDisplayUrl(source, client);
        const state = client.assetState?.(source);
        if (url) {
          finish(url);
        } else if (state?.status === 'error') {
          finish(undefined, new Error(state.message || '文档图片读取失败。'));
        }
      }

      try {
        const unsubscribe = subscribe(checkAsset);
        if (settled) {
          unsubscribe();
        } else {
          subscription.unsubscribe = unsubscribe;
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        finish(undefined, error);
      }
    });
  };

  return { uploadFile, resolveFileUrl };
}

async function exportDocument(
  client: StudioClient,
  artifactId: string,
  regionId: string,
  { title, document, dirty, save }: DocumentDraft,
  format: 'json' | 'html',
) {
  if (dirty && !(await save())) {
    return;
  }

  if (format === 'json') {
    await downloadStudioBlob(
      client,
      new Blob([JSON.stringify({ title, document }, null, 2)], { type: 'application/json' }),
      `${title.replace(/[<>:"/\\|?*]/g, '-') || '文档'}.json`,
    );
  } else {
    const result = await client.call<{ filename: string; downloadPath: string }>(
      STUDIO_TOOLS.export,
      { artifactId, format: 'html', regionId },
    );
    await downloadStudioFile(client, result.downloadPath, result.filename);
  }
}

interface DocumentRegionBodyProps {
  element: BoardElement;
  client: StudioClient;
  canEdit: boolean;
  expanded: boolean;
  interactive: boolean;
  readingZoom: number;
  annotationActive: boolean;
  annotatingRead: boolean;
  targetIds: string[];
  anchorState: ReturnType<typeof documentAnchorState> | null;
  commentPins?: (blockId: string) => ReactNode;
  draft: DocumentDraft;
  editing: ReturnType<typeof useDocumentEditing>;
  reader: ReturnType<typeof useDocumentReader>;
  search: ReturnType<typeof useDocumentSearch>;
  annotations: DocumentAnnotations;
  files: ReturnType<typeof useDocumentFiles>;
  exportMenu: ReturnType<typeof useDocumentExportMenu>;
  presentation: ReturnType<typeof documentPresentation>;
  tocOpen: boolean;
  onToggleToc(): void;
  onMoveStart?: DocumentRegionProps['onMoveStart'];
  onExpand(): void;
  onToggleEditor(): void;
  onBack(): void;
  onExport(format: 'json' | 'html'): void;
  onRestore(raw: string): void;
}

function DocumentRegionBody({
  element,
  client,
  canEdit,
  expanded,
  interactive,
  readingZoom,
  annotationActive,
  annotatingRead,
  targetIds,
  anchorState,
  commentPins,
  draft,
  editing,
  reader,
  search,
  annotations,
  files,
  exportMenu,
  presentation,
  tocOpen,
  onToggleToc,
  onMoveStart,
  onExpand,
  onToggleEditor,
  onBack,
  onExport,
  onRestore,
}: DocumentRegionBodyProps) {
  const { scheme, showHeading, showHeadingActions } = presentation;
  const outlineVisible = expanded && tocOpen && search.headings.length > 0;
  const editingAvailable = canEdit && !draft.leaving;
  const highlightedIds =
    annotationActive && annotations.selection ? annotations.selection.blockIds : targetIds;

  return (
    <>
      {showHeading && (
        <DocumentHeading
          draft={draft}
          showActions={showHeadingActions}
          expanded={expanded}
          editing={editing.editing}
          canEdit={canEdit}
          locked={Boolean(element.locked)}
          titleEditable={editingAvailable && editing.editing && editing.editingAllowed}
          disabled={editing.composing || draft.leaving}
          hasHeadings={search.headings.length > 0}
          tocOpen={tocOpen}
          exportMenu={exportMenu.open}
          onToggleToc={onToggleToc}
          onToggleExport={exportMenu.toggle}
          onExport={onExport}
          onMoveStart={onMoveStart}
          onBack={onBack}
          onToggleEditor={onToggleEditor}
          onExpand={onExpand}
        />
      )}
      {expanded && (
        <DocumentSearch
          value={search.find}
          index={search.findIndex}
          matches={search.matches}
          onChange={search.onChange}
          onAdvance={search.onAdvance}
          onReveal={search.onReveal}
        />
      )}
      {outlineVisible && (
        <DocumentOutline compact headings={search.headings} onReveal={search.onReveal} />
      )}
      {anchorState && anchorState !== 'current' && (
        <div className="studio-document-message" role="status">
          {anchorState === 'missing'
            ? '备注对应的段落已删除，原选区仍保留在备注来源中。'
            : '备注对应的原文已有变化，请核对冻结来源。'}
        </div>
      )}
      <DocumentDraftRecovery draft={draft} canEdit={canEdit} onRestore={onRestore} />
      <div className="studio-document-body">
        {outlineVisible && (
          <DocumentOutline headings={search.headings} onReveal={search.onReveal} />
        )}
        <DocumentViewport
          draft={draft}
          annotations={annotations}
          client={client}
          scheme={scheme}
          highlightedIds={highlightedIds}
          editorTargetIds={targetIds}
          find={search.find}
          expanded={expanded}
          interactive={interactive}
          zoom={readingZoom}
          showEditor={editing.showEditor}
          editable={editingAvailable && (editing.editingAllowed || editing.composing)}
          initialFocusBlockId={editing.editFocusBlockId}
          annotatingRead={annotatingRead}
          scroll={reader.scroll}
          content={reader.content}
          onScroll={reader.handleReaderScroll}
          onCompositionChange={editing.setComposing}
          uploadFile={files.uploadFile}
          resolveFileUrl={files.resolveFileUrl}
          renderCommentPins={commentPins}
        />
      </div>
      <DocumentSaveNotices draft={draft} element={element} canEdit={canEdit} />
    </>
  );
}

interface DocumentRegionFrameProps {
  presentation: ReturnType<typeof documentPresentation>;
  interactiveEvents: ReturnType<typeof useDocumentRegionEvents>;
  shell: RefObject<HTMLDivElement | null>;
  focusShell: RefObject<HTMLElement | null>;
  expanded: boolean;
  interactive: boolean;
  annotationActive: boolean;
  focusHost: HTMLElement | null;
  elementId: string;
  title: string;
  children: ReactNode;
}

function DocumentRegionFrame({
  presentation,
  interactiveEvents,
  shell,
  focusShell,
  expanded,
  interactive,
  annotationActive,
  focusHost,
  elementId,
  title,
  children,
}: DocumentRegionFrameProps) {
  const { surfaceStyle, inlineLayout } = presentation;

  return (
    <>
      <div
        ref={shell}
        className={`studio-document-region${interactive ? ' is-interactive' : ''}${annotationActive ? ' is-annotating' : ''}`}
        style={surfaceStyle}
        data-document-id={elementId}
        data-document-layout={inlineLayout}
        data-native-interactive={interactive ? 'true' : undefined}
        {...interactiveEvents}
      >
        {expanded ? (
          <div className="studio-document-expanded-placeholder">正在展开文档</div>
        ) : (
          children
        )}
      </div>
      {expanded &&
        focusHost &&
        createPortal(
          <section
            ref={focusShell}
            className="studio-document-focus"
            style={surfaceStyle}
            data-document-id={elementId}
            aria-label={`文档：${title}`}
            data-native-interactive="true"
            {...interactiveEvents}
          >
            {children}
          </section>,
          focusHost,
        )}
    </>
  );
}

export default function DocumentRegion({
  element,
  artifactId,
  actor,
  client,
  draftWorkspace,
  canEdit,
  canAnnotate,
  interactive,
  expanded,
  focusHost,
  readingZoom = 1,
  editRequest,
  target,
  annotationActive = false,
  onAnnotationModeChange,
  styleProfile,
  onMoveStart,
  onInteract,
  onEdit,
  onExpand,
  onExit,
  onSave,
  onUseCurrent,
  onActivity,
  initialScrollTop,
  onReadingScroll,
  onAnnotate,
  onFocusSurface,
  boardPoint,
  activities,
  onFeedbackSelect,
}: DocumentRegionProps) {
  const shell = useRef<HTMLDivElement>(null);
  const focusShell = useRef<HTMLElement>(null);
  const exit = useRef(onExit);
  useLayoutEffect(() => {
    exit.current = onExit;
  }, [onExit]);
  const [tocOpen, setTocOpen] = useState(false);
  const editing = useDocumentEditing({
    expanded,
    interactive,
    canEdit,
    annotationActive,
    editRequest,
    onEdit,
    onInteract,
  });
  const [draftSlot] = useState(() =>
    (draftWorkspace ?? createDraftWorkspace(client, actor.id, artifactId)).open(
      'document',
      element.id,
    ),
  );
  const draft = useDocumentDraft({
    element,
    draftSlot,
    canEdit,
    composing: editing.composing,
    onSave,
    onUseCurrent,
  });
  const reader = useDocumentReader({
    elementId: element.id,
    version: element.version,
    expanded,
    zoom: readingZoom,
    focusHost,
    interactive,
    annotationActive,
    editing: editing.editing,
    showEditor: editing.showEditor,
    initialScrollTop,
    onReadingScroll,
    onFocusSurface,
    prepareExit: draft.prepareExit,
  });
  const blocks = useMemo(() => flattenDocumentBlocks(draft.document.blocks), [draft.document]);
  const annotatingRead = annotationActive && canAnnotate && !editing.showEditor;
  const annotations = useDocumentAnnotations({
    artifactId,
    elementId: element.id,
    interactive,
    expanded,
    composing: editing.composing,
    active: annotationActive,
    canAnnotate,
    annotatingRead,
    document: draft.document,
    blocks,
    scroll: reader.scroll,
    content: reader.content,
    session: draft,
    boardPoint,
    onAnnotate,
  });
  const presentation = documentPresentation(element, readingZoom, expanded, styleProfile);
  const exportMenu = useDocumentExportMenu(
    presentation.showHeadingActions,
    () => (expanded ? focusShell.current : shell.current),
    expanded,
  );
  const documentTarget =
    target?.coordinateSpace === 'document' && target.elementIds?.includes(element.id);
  const targetIds = documentTarget ? (target.blockIds ?? []) : [];
  const anchorState = targetIds.length ? documentAnchorState(target!, element) : null;
  const search = useDocumentSearch(
    blocks,
    editing.editing,
    reader.scroll,
    reader.scrollDocumentBy,
    expanded,
    readingZoom,
    focusHost,
    targetIds,
    element.version,
    target?.pin,
  );
  const files = useDocumentFiles(client, artifactId, canEdit);

  const notifyActivity = useEffectEvent(onActivity);
  const editingActivity = (editing.editing && interactive) || editing.composing;
  const activityError = draft.error || (draft.dirty ? draft.warning : '');
  useEffect(() => {
    notifyActivity({
      editing: editingActivity,
      dirty: draft.dirty,
      saving: draft.saving,
      error: activityError,
    });
  }, [editingActivity, draft.dirty, draft.saving, activityError]);
  useEffect(
    () => () => notifyActivity({ editing: false, dirty: false, saving: false, error: '' }),
    [],
  );

  function handleBack() {
    draft
      .prepareExit()
      .then((ready) => {
        if (ready) {
          exit.current();
        }
      })
      .catch(draft.reportError);
  }

  function handleToggleEditor() {
    if (editing.editing) {
      editing.setEditing(false);
    } else if (canEdit) {
      editing.requestEdit();
    } else {
      onExpand();
    }
  }

  function handleRestore(raw: string) {
    if (draft.restore(raw)) {
      editing.requestEdit();
    }
  }

  function handleExport(format: 'json' | 'html') {
    exportMenu.close();
    exportDocument(client, artifactId, element.id, draft, format).catch(draft.reportError);
  }

  const interactiveEvents = useDocumentRegionEvents({
    expanded,
    focusHost,
    interactive,
    canEdit,
    locked: Boolean(element.locked),
    annotationActive,
    annotatingRead,
    editing: editing.editing,
    composing: editing.composing,
    leaving: draft.leaving,
    comparing: draft.comparing,
    exportMenu: exportMenu.open,
    shell,
    focusShell,
    scroll: reader.scroll,
    annotations,
    closeExport: exportMenu.close,
    closeComparison: () => draft.setComparing(false),
    closeEditor: () => editing.setEditing(false),
    requestBack: handleBack,
    requestEdit: editing.requestEdit,
    onAnnotationModeChange,
    onInteract,
    onMoveStart,
  });

  const commentPins = documentCommentPins(activities, element, readingZoom, onFeedbackSelect);

  return (
    <DocumentRegionFrame
      presentation={presentation}
      interactiveEvents={interactiveEvents}
      shell={shell}
      focusShell={focusShell}
      expanded={expanded}
      interactive={interactive}
      annotationActive={annotationActive}
      focusHost={focusHost}
      elementId={element.id}
      title={draft.title}
    >
      <DocumentRegionBody
        element={element}
        client={client}
        canEdit={canEdit}
        expanded={expanded}
        interactive={interactive}
        readingZoom={readingZoom}
        annotationActive={annotationActive}
        annotatingRead={annotatingRead}
        targetIds={targetIds}
        anchorState={anchorState}
        commentPins={commentPins}
        draft={draft}
        editing={editing}
        reader={reader}
        search={search}
        annotations={annotations}
        files={files}
        exportMenu={exportMenu}
        presentation={presentation}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen((value) => !value)}
        onMoveStart={onMoveStart}
        onExpand={onExpand}
        onToggleEditor={handleToggleEditor}
        onBack={handleBack}
        onExport={handleExport}
        onRestore={handleRestore}
      />
    </DocumentRegionFrame>
  );
}
