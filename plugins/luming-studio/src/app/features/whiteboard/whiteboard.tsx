import { applyWhiteboardRemoteEvent } from './unit-projection.js';

export { applyWhiteboardRemoteEvent } from './unit-projection.js';
import { createDraftWorkspace, type DraftWorkspace } from './draft-workspace.js';
import { DraftRecoveryPicker } from './DraftRecoveryPicker.js';
import { isBoardElementProjection } from '../../../contracts/board-shape.js';
import { sendCanvasSave, verifyCanvasSave } from './save-receipt.js';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
  type Ref,
} from 'react';
import { FileCode2, Loader2, Share2 } from 'lucide-react';
import {
  STUDIO_TOOLS,
  type Anchor,
  type Board,
  type BoardElement,
  type HtmlSelection,
  type Operation,
  type StudioClient,
} from '../../../contracts/studio';
import type {
  ProductActivity,
  ProductAnnotation,
  ProductDescriptor,
  ProductDifferenceProps,
  ProductEditorProps,
  ProductPreviewProps,
  ProductToolbarProps,
} from '../../product-contract';
import { downloadBoard } from '../transfer';
import WhiteboardCanvas from './canvas/WhiteboardCanvas';
import { StudioDialog } from '../../shared/StudioDialog';
import { downloadStudioBlob, downloadStudioFile, studioRequest } from '../../transport/client';
import { reportStudioWarning } from '../../shared/studio-warning';
import { newClientId } from '../../shared/client-id.js';
import {
  NativeContentQueue,
  type ContentReceipt,
  type ContentTask,
} from './canvas/sync/content-queue.js';
import ContentConflictDialog from './canvas/controls/ContentConflictDialog.js';
import { copyPlainText } from '../../clipboard.js';
import {
  LIBRARY_PREVIEW_FRAME_LIMIT,
  type LibraryPreview,
  type LibraryPreviewFrame,
} from '../../library-preview';

export { CanvasOpeningScene } from './canvas/CanvasOpeningScene.js';

function downloadableUrl(client: StudioClient, path: string): string {
  const url = new URL(path, client.baseUrl || window.location.href);
  if (client.token && client.baseUrl && url.origin === new URL(client.baseUrl).origin) {
    url.searchParams.set('token', client.token);
  }
  return url.href;
}

function thumbnailUrl(client: StudioClient, thumbnail: string): string | undefined {
  if (/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/i.test(thumbnail)) {
    return thumbnail;
  }

  try {
    const url = new URL(thumbnail, client.baseUrl || window.location.href);
    const origin = new URL(client.baseUrl || window.location.href).origin;
    if (url.origin !== origin) {
      return undefined;
    }

    return client.assetUrl ? client.assetUrl(thumbnail) : downloadableUrl(client, thumbnail);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      reportStudioWarning('无法读取白板预览地址。', error);
    }
    return undefined;
  }
}

type AssetStateReader = NonNullable<StudioClient['assetState']>;

function previewMessage(
  asset: ReturnType<AssetStateReader> | undefined,
  failed: boolean,
  cached: LibraryPreview | undefined,
): { message: string | undefined; role?: 'alert' | 'status' } {
  if (asset?.status === 'error') {
    return { message: asset.message, role: 'alert' };
  }
  if (asset?.status === 'loading') {
    return { message: '正在加载预览…', role: 'status' };
  }
  if (failed) {
    return { message: '预览暂不可用' };
  }

  return { message: cached ? '空白白板' : '打开作品查看内容' };
}

function compactPreviewText(value: string, limit: number): string {
  const length = Math.min(value.length, limit);
  const units = Array.from({ length }, (_, index) => value.charCodeAt(index));

  return String.fromCharCode(...units);
}

export function projectWhiteboardPreview(board: Board): LibraryPreview {
  const frames: LibraryPreviewFrame[] = [];
  for (const element of board.elements) {
    if (element.type === 'arrow' || element.type === 'stroke') {
      continue;
    }

    frames.push({
      id: compactPreviewText(element.id, 120),
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      radius: element.type === 'container' ? 3 : 7,
      fill: compactPreviewText(element.fill || (element.type === 'html' ? '#fff' : '#e9edf2'), 128),
      stroke: compactPreviewText(element.stroke || '#a8b0bd', 128),
      label: compactPreviewText(
        String(element.text || (element.type === 'html' ? 'HTML 图解' : '')),
        28,
      ),
    });

    if (frames.length === LIBRARY_PREVIEW_FRAME_LIMIT) {
      break;
    }
  }

  return { paper: compactPreviewText(board.style.paper, 128), frames };
}

function WhiteboardPreview({ artifact, cached, client }: ProductPreviewProps) {
  const [, assetsChanged] = useState(0);
  useEffect(() => client.subscribeAssets?.(() => assetsChanged((value) => value + 1)), [client]);
  const image = artifact.thumbnail ? thumbnailUrl(client, artifact.thumbnail) : undefined;
  const assetState = artifact.thumbnail ? client.assetState?.(artifact.thumbnail) : undefined;
  const [attempt, setAttempt] = useState({ image, failed: false });
  const failed = attempt.image === image && attempt.failed;
  if (attempt.image !== image) {
    setAttempt({ image, failed: false });
  }
  if (image && !failed) {
    return (
      <div className="studio-artifact-preview">
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setAttempt({ image, failed: true })}
        />
      </div>
    );
  }

  const elements = cached?.frames || [];

  if (!elements.length) {
    const { role, message } = previewMessage(assetState, failed, cached);
    return (
      <div className="studio-artifact-preview studio-blank-preview">
        <div className="studio-preview-paper">
          <span />
          <span />
          <span />
        </div>
        <span role={role}>{message}</span>
      </div>
    );
  }
  const left = Math.min(...elements.map((element) => element.x)) - 32;
  const top = Math.min(...elements.map((element) => element.y)) - 32;
  const width = Math.max(480, ...elements.map((element) => element.x + element.w - left)) + 32;
  const height = Math.max(300, ...elements.map((element) => element.y + element.h - top)) + 32;
  return (
    <div className="studio-artifact-preview">
      <svg
        aria-hidden="true"
        viewBox={`${left} ${top} ${width} ${height}`}
        style={{ background: cached?.paper }}
      >
        {elements.map((element) => (
          <g key={element.id}>
            <rect
              x={element.x}
              y={element.y}
              width={element.w}
              height={element.h}
              rx={element.radius}
              fill={element.fill}
              stroke={element.stroke}
              strokeWidth={1.2}
            />
            <text x={element.x + 10} y={element.y + 22} fontSize={13} fill="#303c4c">
              {element.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function WhiteboardDifference({
  current: currentDocument,
  previous: previousDocument,
  diff,
}: ProductDifferenceProps) {
  const current = currentDocument as Board;
  const previous = previousDocument as Board;
  const now = new Map(current.elements.map((element) => [element.id, element]));
  const then = new Map(previous.elements.map((element) => [element.id, element]));
  const ids = [...new Set([...now.keys(), ...then.keys()])];
  const changes = ids
    .filter((id) => JSON.stringify(now.get(id)) !== JSON.stringify(then.get(id)))
    .map((id) => {
      let kind = '修改';
      if (!then.has(id)) {
        kind = '新增';
      } else if (!now.has(id)) {
        kind = '移除';
      }
      return { id, kind, name: String((now.get(id) || then.get(id))?.text || id).slice(0, 50) };
    });

  return (
    <div className="studio-version-diff" aria-label="与当前白板的差异">
      <h4>从此版本到当前白板</h4>
      <p>
        {changes.length ? `${changes.length} 个对象有变化` : '对象内容相同'}
        {current.artifact.title !== previous.artifact.title ? ' · 标题有变化' : ''}
      </p>
      {changes.slice(0, 30).map((change) => (
        <div className="studio-diff-row" key={change.id}>
          <span data-kind={change.kind}>{change.kind}</span>
          <span>{change.name}</span>
        </div>
      ))}
      {changes.length > 30 && <p>另有 {changes.length - 30} 项</p>}
      {diff && !changes.length && Array.isArray(diff.changes) && diff.changes.length > 0 && (
        <p>此版本另有样式或元数据变更。</p>
      )}
    </div>
  );
}

function whiteboardAnnotation(
  board: Board,
  selection: HtmlSelection,
  pin?: Anchor['pin'],
): ProductAnnotation {
  const region = board.elements.find((element) => element.id === selection.regionId);
  return {
    label: 'HTML 内部选区',
    sourceLabel: `选区来源版本 ${selection.sourceRevision} · 保存时冻结上下文`,
    screenPoint: selection.screenPoint,
    anchor: {
      coordinateSpace: 'html',
      regionId: selection.regionId,
      targetIds: selection.targetIds,
      sourceRevision: selection.sourceRevision,
      quote: selection.quote,
      excerpt: selection.excerpt,
      selector: selection.selector,
      ...selection.rect,
      ...(pin ? { pin } : {}),
    },
    versions: region ? { [region.id]: region.version } : undefined,
  };
}

function WhiteboardEditor(props: ProductEditorProps) {
  const board = props.document as Board;
  const service = props.client.embedded ? 'embedded' : props.client.baseUrl;
  const scope = JSON.stringify([service, board.artifact.id, props.actor.id]);
  return <WhiteboardEditorSession key={scope} {...props} />;
}

function createContentSession(
  board: Board,
  client: StudioClient,
  onChanged: ProductEditorProps['onChanged'],
) {
  let current = { board, client, onChanged };
  let mounted = false;
  const queue = new NativeContentQueue({
    send: (args) => sendCanvasSave(current.client, () => current.board, args),
    confirm: (args) => verifyCanvasSave(current.client, () => current.board, args),
    changed() {},
    accepted(_task, receipt) {
      const { artifact } = current.board;
      if (
        !mounted ||
        artifact.id !== receipt.board.artifact.id ||
        artifact.revision > receipt.board.artifact.revision
      ) {
        return;
      }

      current.board = receipt.board;
      current.onChanged(receipt.board);
    },
  });

  return {
    queue,
    activate() {
      mounted = true;
      return () => {
        mounted = false;
      };
    },
    update(board: Board, client: StudioClient, onChanged: ProductEditorProps['onChanged']) {
      current = { board, client, onChanged };
    },
  };
}

interface SourceEditorHandle {
  editSource: (regionId?: string) => Promise<void>;
}

function WhiteboardEditorSession(props: ProductEditorProps) {
  const { document, onChanged, onAnnotate, onActivityChange, onError, onNotice, ...rest } = props;
  const board = document as Board;
  const sourceEditor = useRef<SourceEditorHandle>(null);
  const [insertedElementId, setInsertedElementId] = useState<string>();
  const [contentSession] = useState(() => createContentSession(board, props.client, onChanged));
  const [draftWorkspace] = useState(() =>
    createDraftWorkspace(
      props.client,
      props.actor.id,
      board.artifact.id,
      props.panelViewId,
      props.restoreReadingFrom,
    ),
  );
  useLayoutEffect(
    () => contentSession.update(board, props.client, onChanged),
    [contentSession, board, props.client, onChanged],
  );
  useLayoutEffect(() => contentSession.activate(), [contentSession]);
  const contentQueue = contentSession.queue;
  useEffect(() => {
    contentQueue.setEnabled(
      !props.readOnly && !props.preview && ['owner', 'editor'].includes(props.actor.role),
    );

    return () => contentQueue.setEnabled(false);
  }, [contentQueue, props.readOnly, props.preview, props.actor.role]);
  const activities = useRef<Record<'canvas' | 'source', ProductActivity>>({
    canvas: { editingIds: [], movingIds: [], dirty: false },
    source: { editingIds: [], movingIds: [], dirty: false },
  });
  const report = useCallback(
    (origin: 'canvas' | 'source', activity: ProductActivity) => {
      activities.current[origin] = activity;
      const values = Object.values(activities.current);
      onActivityChange?.({
        editingIds: [...new Set(values.flatMap((value) => value.editingIds))],
        movingIds: [...new Set(values.flatMap((value) => value.movingIds))],
        savingIds: [...new Set(values.flatMap((value) => value.savingIds ?? []))],
        dirty: values.some((value) => value.dirty),
        saving: values.some((value) => value.saving),
        saveError: values.find((value) => value.saveError)?.saveError || '',
        issues: values.flatMap((value) => value.issues || []),
      });
    },
    [onActivityChange],
  );
  const canvasActivity = useCallback(
    (activity: ProductActivity) => report('canvas', activity),
    [report],
  );
  const sourceActivity = useCallback(
    (activity: ProductActivity) => report('source', activity),
    [report],
  );
  function handleEditHtml(element?: BoardElement) {
    sourceEditor.current?.editSource(element?.id).catch((error) => onError?.(error));
  }
  return (
    <>
      <WhiteboardCanvas
        {...rest}
        draftWorkspace={draftWorkspace}
        contentQueue={contentQueue}
        board={board}
        insertedElementId={insertedElementId}
        onChanged={onChanged}
        onActivityChange={canvasActivity}
        onAnnotate={(selection, pin) => onAnnotate(whiteboardAnnotation(board, selection, pin))}
        onAnnotateNative={onAnnotate}
        onEditHtml={handleEditHtml}
      />
      {!props.preview && (
        <WhiteboardToolbar
          key={props.client.baseUrl ?? 'embedded'}
          document={board}
          client={props.client}
          actor={props.actor}
          selectedIds={[]}
          disabled={!!props.readOnly}
          onChanged={onChanged}
          onError={(error) => onError?.(error)}
          onNotice={(message) => onNotice?.(message)}
          onActivityChange={sourceActivity}
          editorRef={sourceEditor}
          queue={contentQueue}
          draftWorkspace={draftWorkspace}
          onInserted={setInsertedElementId}
        />
      )}
    </>
  );
}

interface SourceDraft {
  regionId?: string;
  newRegionId?: string;
  version?: number;
  base?: BoardElement;
  title: string;
  html: string;
}

function decodeSourceDraft(raw: string): SourceDraft | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
    const { title, html, base, version, regionId, newRegionId } = fields;
    if (typeof title !== 'string' || typeof html !== 'string') {
      return null;
    }

    const validIds = [regionId, newRegionId].every(
      (value) =>
        value === undefined || (typeof value === 'string' && /^[-.\w]{1,120}$/.test(value)),
    );

    if (!validIds) {
      return null;
    }

    const existing = typeof regionId === 'string' ? regionId : undefined;
    const proposed = typeof newRegionId === 'string' ? newRegionId : undefined;
    const validBase = isBoardElementProjection(base) && base.id === existing;
    const htmlBase = validBase && (base.type === 'html' || base.type === 'diagram');
    return {
      title,
      html,
      regionId: existing,
      newRegionId: proposed,
      version: typeof version === 'number' && Number.isSafeInteger(version) ? version : undefined,
      base: htmlBase ? base : undefined,
    };
  } catch (failure) {
    if (failure instanceof SyntaxError || failure instanceof RangeError) {
      return null;
    }

    throw failure;
  }
}

function updateSourceOperation(id: string, draft: SourceDraft): Operation {
  return { op: 'update', id, changes: { html: draft.html, text: draft.title } };
}

function createSourceOperation(draft: SourceDraft, board: Board): Operation {
  if (draft.regionId) {
    return updateSourceOperation(draft.regionId, draft);
  }

  const x = board.elements.length
    ? Math.max(...board.elements.map((element) => element.x + element.w)) + 80
    : 80;

  return {
    op: 'add',
    element: {
      id: draft.newRegionId ?? newClientId('html'),
      type: 'html',
      x,
      y: 80,
      w: 1440,
      h: 1120,
      text: draft.title || 'HTML 图解',
      html: draft.html,
    },
  };
}

function comparedSourceOperation(draft: SourceDraft, region: BoardElement | undefined): Operation {
  if (region) {
    return updateSourceOperation(region.id, draft);
  }

  return {
    op: 'add',
    element: {
      ...draft.base,
      id: newClientId('html'),
      type: 'html',
      x: draft.base?.x ?? 80,
      y: draft.base?.y ?? 80,
      w: draft.base?.w ?? 1440,
      h: draft.base?.h ?? 1120,
      html: draft.html,
      text: draft.title,
    },
  };
}

function WhiteboardToolbar({
  document: opaqueDocument,
  client,
  selectedIds,
  disabled,
  onChanged,
  onError,
  onNotice,
  onActivityChange,
  editorRef,
  queue,
  draftWorkspace,
  onInserted,
}: ProductToolbarProps & {
  editorRef: Ref<SourceEditorHandle>;
  queue: NativeContentQueue;
  draftWorkspace: DraftWorkspace;
  onInserted: (id: string) => void;
}) {
  const board = opaqueDocument as Board;
  const [sourceSlot] = useState(() => draftWorkspace.open('source'));
  const [source, setSource] = useState<SourceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const boardRef = useRef(board);
  useLayoutEffect(() => {
    boardRef.current = board;
  }, [board]);
  const mounted = useRef(true);
  const pendingSave = useRef<{ fingerprint: string; operations: Operation[] } | null>(null);
  const sourceBaseline = useRef('');
  const [sourceError, setSourceError] = useState('');
  const [sourceConflict, setSourceConflict] = useState<ContentTask | null>(null);
  const [sourceComparisonBoard, setSourceComparisonBoard] = useState<Board | null>(null);
  function showSourceConflict(task: ContentTask) {
    setSourceComparisonBoard(boardRef.current);
    setSourceConflict(task);
  }
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function changeDraft(next: SourceDraft | null) {
    setSource(next);
    try {
      if (next) {
        const serialized = JSON.stringify(next);
        if (serialized !== sourceBaseline.current) {
          sourceSlot.write(serialized);
        }
      } else {
        sourceSlot.clear();
      }
    } catch (error) {
      reportStudioWarning('无法更新本机 HTML 草稿。', error);
      setSourceError('本机草稿保存失败，请复制 HTML 源码后再关闭。');
    }
  }
  useEffect(() => {
    onActivityChange?.({
      editingIds: !saving && source?.regionId ? [source.regionId] : [],
      movingIds: [],
      savingIds: saving && source ? [source.regionId ?? source.newRegionId!].filter(Boolean) : [],
      dirty: !!source && JSON.stringify(source) !== sourceBaseline.current,
      saving,
      saveError: source ? sourceError : '',
      issues:
        source && sourceError
          ? [
              {
                type: 'source-save',
                message: sourceError,
                ids: source?.regionId ? [source.regionId] : [],
              },
            ]
          : [],
    });
  }, [source, sourceError, saving, onActivityChange]);
  useEffect(
    () => () => onActivityChange?.({ editingIds: [], movingIds: [], dirty: false, issues: [] }),
    [onActivityChange],
  );
  function openSource(draft: SourceDraft) {
    const next = draft.regionId
      ? draft
      : { ...draft, newRegionId: draft.newRegionId ?? newClientId('html') };
    sourceBaseline.current = JSON.stringify(next);
    setSourceError('');
    changeDraft(next);
  }
  const selectedRegion = board.elements.find(
    (element) => selectedIds.includes(element.id) && element.type === 'html',
  );
  async function editSource(regionId = selectedRegion?.id) {
    if (disabled || busy) {
      return;
    }

    pendingSave.current = null;
    const region = boardRef.current.elements.find(
      (element) => element.id === regionId && element.type === 'html',
    );

    if (!region) {
      openSource({ title: 'HTML 图解', html: '' });
      return;
    }
    const id = board.artifact.id;
    setBusy(true);
    try {
      const result = await client.call(STUDIO_TOOLS.read, {
        artifactId: id,
        mode: 'source',
        regionId: region.id,
      });

      if (mounted.current && boardRef.current.artifact.id === id) {
        if (!('html' in result) || typeof result.html !== 'string' || result.html !== region.html) {
          throw new Error('读取期间 HTML 已有新修改，请重新打开源码。');
        }

        openSource({
          regionId: region.id,
          version: region.version,
          base: region,
          title: region.text || 'HTML 图解',
          html: result.html,
        });
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  useImperativeHandle(editorRef, () => ({ editSource }));
  async function importFile(file: File) {
    if (busy) {
      return;
    }

    const artifactId = boardRef.current.artifact.id;
    setBusy(true);
    try {
      const html = await file.text();
      if (mounted.current && boardRef.current.artifact.id === artifactId) {
        setSourceError('');
        changeDraft({
          ...source,
          title: source?.regionId ? source.title : file.name.replace(/\.html?$/i, ''),
          html,
        });
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  function prepareSourceSave(draft: SourceDraft, current: Board) {
    const fingerprint = JSON.stringify(draft);
    if (pendingSave.current?.fingerprint !== fingerprint) {
      const operation = createSourceOperation(draft, current);
      pendingSave.current = { fingerprint, operations: [operation] };
    }
    const { operations } = pendingSave.current;
    const targetId = draft.regionId ?? draft.newRegionId ?? operations[0]?.element?.id;
    return { operations, targetId };
  }

  async function writeSource(draft: SourceDraft, current: Board) {
    const prepared = prepareSourceSave(draft, current);
    let { operations } = prepared;
    const { targetId } = prepared;
    const sameOperations = (task: ContentTask) =>
      JSON.stringify(task.operations) === JSON.stringify(operations);
    const failed = queue.drafts.find((task) => {
      const sameTarget = !!targetId && task.keys.includes(targetId);
      return task.state === 'failed' && (sameOperations(task) || sameTarget);
    });
    let retry: ContentReceipt | null = null;
    if (failed) {
      retry = await queue.retry(failed.id);
      if (!retry) {
        showSourceConflict({
          ...failed,
          operations,
          sources: draft.base ? [draft.base] : failed.sources,
        });

        throw failed.failure ?? new Error(failed.error);
      }
      if (sameOperations(failed)) {
        return { result: retry, targetId };
      }
    }
    const created = retry?.board.elements.find((element) => element.id === targetId);
    if (!draft.regionId && created) {
      operations = [updateSourceOperation(created.id, draft)];
      const next = { ...draft, regionId: created.id, version: created.version, base: created };
      changeDraft(next);
      pendingSave.current = { fingerprint: JSON.stringify(next), operations };
    }
    const base = created ?? draft.base;
    const result = await queue.enqueue(
      retry?.board ?? current,
      operations,
      draft.regionId || created ? '保存 HTML 源码' : '添加 HTML 图解',
      base ? [base] : current.elements,
    );

    if (!result) {
      throwRejectedSource(draft.regionId, operations[0]?.element?.id);
    }
    return { result, targetId };
  }

  function throwRejectedSource(regionId: string | undefined, elementId: string | undefined): never {
    const rejected = queue.drafts.find(
      (task) =>
        task.state === 'failed' &&
        task.operations.some(
          (operation) => operation.id === regionId || operation.element?.id === elementId,
        ),
    );

    if (rejected && /CONFLICT|冲突|其他人|被删除/.test(rejected.error ?? '')) {
      showSourceConflict(rejected);
    }
    throw rejected?.failure ?? new Error('HTML 草稿尚未保存，请比较双方内容或重试原操作。');
  }

  async function saveSource(draft: SourceDraft) {
    const current = boardRef.current;
    setBusy(true);
    setSaving(true);
    setSourceError('');
    try {
      const { result, targetId } = await writeSource(draft, current);
      if (!mounted.current || boardRef.current.artifact.id !== current.artifact.id) {
        return;
      }

      onChanged(result.board);
      if (!draft.regionId && targetId) {
        onInserted(targetId);
      }
      pendingSave.current = null;
      setSourceConflict(null);
      changeDraft(null);
      onNotice(draft.regionId ? 'HTML 源码已保存。' : 'HTML 图解已加入白板。');
    } catch (error) {
      if (mounted.current && boardRef.current.artifact.id === current.artifact.id) {
        setSourceError(error instanceof Error ? error.message : String(error));
      }
      throw error;
    } finally {
      if (mounted.current) {
        setBusy(false);
        setSaving(false);
      }
    }
  }

  async function overwriteSource(task: ContentTask, draft: SourceDraft) {
    const current = sourceComparisonBoard ?? boardRef.current;
    const region = current.elements.find((element) => element.id === draft.regionId);
    const operation = comparedSourceOperation(draft, region);
    queue.discard(task.id);
    setSourceConflict(null);
    pendingSave.current = null;
    setBusy(true);
    setSaving(true);
    try {
      const result = await queue.enqueue(
        current,
        [operation],
        region ? '应用已比较的 HTML 源码' : '另存 HTML 草稿',
        current.elements,
      );

      if (!result) {
        throw new Error('HTML 尚未保存，草稿已保留，请比较最新内容。');
      }
      if (!mounted.current) {
        return;
      }

      onChanged(result.board);
      if (operation.op === 'add' && operation.element?.id) {
        onInserted(operation.element.id);
      }
      setSourceError('');
      changeDraft(null);
      onNotice('HTML 源码已保存。');
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (mounted.current) {
        setBusy(false);
        setSaving(false);
      }
    }
  }

  function handleSaveSource(event: SubmitEvent) {
    event.preventDefault();
    const hasSource = source?.html.trim();
    if (!source || !hasSource) {
      return;
    }

    if (!busy && !disabled) {
      saveSource(source).catch(onError);
    }
  }

  function handleOverwriteSource() {
    if (sourceConflict && source && !disabled) {
      overwriteSource(sourceConflict, source).catch(onError);
    }
  }

  function handleCloseSource() {
    if (!busy) {
      changeDraft(null);
    }
  }

  function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) {
      importFile(file).catch(onError);
    }
  }

  function handleUseRemoteSource() {
    if (!sourceConflict) {
      return;
    }

    queue.discardFor(sourceConflict.keys);
    setSourceConflict(null);
    setSourceError('');
    changeDraft(null);
  }
  function compareSourceDraft(raw: string) {
    const recovered = decodeSourceDraft(raw);
    const target = recovered?.regionId ?? recovered?.newRegionId;
    const current = board.elements.find((element) => element.id === target);
    const currentHtml = current?.type === 'html' || current?.type === 'diagram';
    const missingNewRegion = recovered?.regionId === undefined && !current;
    const sameTarget = missingNewRegion || (currentHtml && typeof current.html === 'string');

    return {
      draft: recovered?.html ?? raw,
      saved: current?.html ?? '',
      recoverable: Boolean(recovered && sameTarget),
    };
  }

  function handleRecoverSourceDraft(raw: string) {
    const recovered = decodeSourceDraft(raw);
    if (recovered) {
      const target = recovered.regionId ?? recovered.newRegionId;
      const current = board.elements.find((element) => element.id === target);
      const base = recovered.base ?? current;
      sourceBaseline.current = '';
      pendingSave.current = null;
      changeDraft({
        ...recovered,
        regionId: current?.id,
        base,
        version: base?.version ?? recovered.version,
      });
    }
  }

  return (
    <>
      {!disabled && (
        <DraftRecoveryPicker
          slot={sourceSlot}
          canRecover={!busy}
          hidden={!!source}
          compare={compareSourceDraft}
          onRecover={handleRecoverSourceDraft}
          onError={onError}
        />
      )}
      {source && (
        <StudioDialog
          title={source.regionId ? '编辑 HTML 源码' : '导入 HTML 图解'}
          onClose={handleCloseSource}
          wide
        >
          <form onSubmit={handleSaveSource}>
            <div className="studio-source-heading">
              <label className="studio-field-label">
                区域名称
                <input
                  className="studio-text-field"
                  aria-label="HTML 区域名称"
                  disabled={busy || disabled}
                  value={source.title}
                  onChange={(event) => changeDraft({ ...source, title: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="studio-button"
                disabled={busy || disabled}
                onClick={() => fileInput.current?.click()}
              >
                <FileCode2 size={16} />
                选择 HTML 文件
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".html,.htm,text/html"
                aria-label="选择 HTML 文件"
                disabled={busy || disabled}
                hidden
                onChange={handleImportFile}
              />
            </div>
            <label className="studio-field-label" htmlFor="studio-html-source">
              HTML 源码
            </label>
            <textarea
              id="studio-html-source"
              className="studio-source-editor"
              spellCheck={false}
              disabled={busy || disabled}
              value={source.html}
              onChange={(event) => changeDraft({ ...source, html: event.target.value })}
              placeholder="粘贴完整 HTML 或选择文件…"
            />
            <p className="studio-small-note">
              HTML
              会作为独立区域显示在白板上，保留自己的样式。可以标注区域内部的文字与图形，并附加到对话。
            </p>
            {sourceError && (
              <p role="alert" className="studio-danger-text">
                {sourceError}
              </p>
            )}
            <div className="studio-modal-footer">
              <button
                type="button"
                className="studio-button"
                disabled={busy}
                onClick={() => changeDraft(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="studio-button studio-primary"
                disabled={!source.html.trim() || busy || disabled}
              >
                {busy && <Loader2 className="studio-spin" size={15} />}
                {source.regionId ? '保存源码' : '添加到白板'}
              </button>
            </div>
          </form>
        </StudioDialog>
      )}
      {sourceConflict && (
        <ContentConflictDialog
          task={sourceConflict}
          current={sourceComparisonBoard ?? board}
          disabled={disabled || busy}
          onKeep={() => setSourceConflict(null)}
          onRemote={handleUseRemoteSource}
          onOverwrite={handleOverwriteSource}
          onCopy={() => {
            copyPlainText(source?.html ?? '').catch(onError);
          }}
        />
      )}
    </>
  );
}

async function exportWhiteboard(
  document: unknown,
  format: 'png' | 'svg' | 'html' | 'json',
  client: StudioClient,
) {
  const board = document as Board;
  try {
    if (format === 'png') {
      await downloadBoard(
        board,
        format,
        {
          baseUrl: client.baseUrl,
          token: client.token,
          request: (url: string | URL) => studioRequest(client, url),
        },
        (blob, filename) => downloadStudioBlob(client, blob, filename),
      );

      return;
    }
    const result = await client.call<{ filename: string; downloadPath: string }>(
      STUDIO_TOOLS.export,
      { artifactId: board.artifact.id, format },
    );
    await downloadStudioFile(client, result.downloadPath, result.filename);
  } catch (error) {
    if (
      !(
        (error as { code?: string })?.code === 'EXPORT_BROWSER_REQUIRED' ||
        (error instanceof Error && error.message.includes('EXPORT_BROWSER_REQUIRED'))
      )
    ) {
      throw error;
    }

    await downloadBoard(
      board,
      format,
      {
        baseUrl: client.baseUrl,
        token: client.token,
        request: (url: string | URL) => studioRequest(client, url),
      },
      (blob, filename) => downloadStudioBlob(client, blob, filename),
    );
  }
}

export const whiteboardProduct: ProductDescriptor = {
  id: 'whiteboard',
  label: '白板',
  defaultTitle: '未命名白板',
  Icon: Share2,
  Editor: WhiteboardEditor,
  Preview: WhiteboardPreview,
  projectLibraryPreview: (document) => projectWhiteboardPreview(document as Board),
  Difference: WhiteboardDifference,
  applyRemoteEvent(document, event) {
    return applyWhiteboardRemoteEvent(document as Board, event);
  },
  selectionContext(document, selectedIds) {
    const board = document as Board;
    return {
      label: selectedIds.length ? `关于选中的 ${selectedIds.length} 个对象` : '关于整块白板',
      anchor: { elementIds: selectedIds },
      versions: Object.fromEntries(
        board.elements
          .filter((element) => selectedIds.includes(element.id))
          .map((element) => [element.id, element.version]),
      ),
    };
  },
  locateAnchor(document, anchor) {
    const board = document as Board;
    const ids = anchor.regionId ? [anchor.regionId] : anchor.elementIds || [];
    const elements = board.elements.filter((element) => ids.includes(element.id));
    if (elements.length) {
      const x = Math.min(...elements.map((element) => element.x));
      const y = Math.min(...elements.map((element) => element.y));
      return {
        ids: elements.map((element) => element.id),
        bounds: {
          x,
          y,
          w: Math.max(...elements.map((element) => element.x + element.w)) - x,
          h: Math.max(...elements.map((element) => element.y + element.h)) - y,
        },
      };
    }
    if (
      anchor.coordinateSpace === 'board' &&
      typeof anchor.x === 'number' &&
      typeof anchor.y === 'number'
    ) {
      return {
        ids: [],
        bounds: { x: anchor.x, y: anchor.y, w: anchor.w || 200, h: anchor.h || 120 },
      };
    }

    return undefined;
  },
  exportFormats: [
    { format: 'png', label: 'PNG 图片' },
    { format: 'svg', label: 'SVG 图片' },
    { format: 'html', label: '整板网页（HTML）' },
    { format: 'json', label: '白板文件 (.json)' },
  ],
  exportDocument: exportWhiteboard,
};
