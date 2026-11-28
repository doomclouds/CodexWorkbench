import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, ScrollRegion, StatusText } from '../../../base/index.js';
import type { SearchFieldHandle } from '../../../base/index.js';
import type { DocumentActivity, DocumentObjectProps } from './contracts.js';
import { plainDocumentInput, useDocumentAnnotations } from './document-annotations.js';
import { DocumentReadingLayout } from './DocumentFocusedReading.js';
import { DocumentReadView } from './DocumentReadView.js';
import { DocumentComparison, DocumentTitle, DocumentToolbar } from './DocumentToolbar.js';
import { untitledDocument } from './model.js';
import { useDocumentDraft } from './useDocumentDraft.js';
import { useDocumentPan } from './useDocumentPan.js';
import { useDocumentView } from './useDocumentView.js';
import { useDocumentViewport } from './useDocumentViewport.js';
import './document-object.css';

const DocumentEditor = lazy(() => import('./DocumentEditor.js'));
const nativeControl = 'button,input,textarea,select,a[href],[contenteditable]';
const vendorMenu =
  '.bn-suggestion-menu,[role="menu"],[role="listbox"],.bn-container [role="dialog"]';
const readingBackground = '#ffffff';
const readingInk = '#211f1d';

function panelPresentation(
  paper: DocumentObjectProps['paper'],
  canvas: DocumentObjectProps['canvas'],
  expanded: boolean,
) {
  const scheme = paper?.scheme ?? 'light';
  const backgroundColor = paper?.fill ?? (scheme === 'dark' ? '#1c1d1e' : readingBackground);
  const color = paper?.ink ?? (scheme === 'dark' ? '#f7f4ed' : readingInk);
  const inline = expanded ? undefined : canvas;
  const layout = inline && documentLayout(inline);
  const shell = { backgroundColor, color, colorScheme: scheme };
  const surface = {
    ...shell,
    backgroundColor: paper?.backdrop ?? backgroundColor,
    '--studio-document-paper': backgroundColor,
    '--document-ui-scale': inline && Math.min(1 / inline.zoom, 1.5),
    '--document-canvas-scale': inline?.zoom,
  } as CSSProperties;

  return { layout, shell, surface };
}

function documentLayout(canvas: NonNullable<DocumentObjectProps['canvas']>) {
  const width = canvas.width * canvas.zoom;
  const height = canvas.height * canvas.zoom;
  if (width < 64 || height < 28) {
    return 'outline';
  }
  if (width < 220 || height < 90) {
    return 'thumbnail';
  }
  if (width < 320 || height < 140) {
    return 'compact';
  }

  return 'detail';
}

export function DocumentContentUnavailable({
  title,
  paper,
  canvas,
  focusedReading = false,
}: Pick<DocumentObjectProps, 'paper' | 'canvas' | 'focusedReading'> & {
  readonly title: string;
}) {
  const { layout, shell, surface } = panelPresentation(paper, canvas, focusedReading);
  const label = title.trim() || untitledDocument;

  return (
    <div
      className="studio-document-surface"
      data-document-layout={layout}
      data-document-focused-reading={focusedReading || undefined}
      data-document-content-unavailable=""
      data-paper-scheme={shell.colorScheme}
      style={surface}
    >
      <div className={focusedReading ? 'studio-document-focused-heading' : 'studio-document-top'}>
        <DocumentCanvasHeading
          visible={layout !== undefined || focusedReading}
          moveHandle={false}
          locked
        />
        <h3 className="studio-document-title" title={label}>
          {label}
        </h3>
      </div>
      <div className="studio-document-unavailable" style={shell}>
        <StatusText message="暂未取得文档正文" announcement="polite" />
      </div>
    </div>
  );
}

function DocumentCanvasHeading({
  visible,
  moveHandle,
  locked,
}: {
  readonly visible: boolean;
  readonly moveHandle: boolean;
  readonly locked: boolean;
}) {
  if (!visible) {
    return null;
  }

  return (
    <span className="studio-document-canvas-symbols">
      {moveHandle && (
        <button
          className="studio-document-move"
          data-canvas-drag-surface="title"
          type="button"
          aria-label="移动文档"
          title={locked ? '文档位置已锁定' : '拖动把手移动文档'}
          disabled={locked}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </button>
      )}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M8 13h8m-8 4h8" />
      </svg>
    </span>
  );
}

function vendorControlsOpen(container: HTMLElement) {
  const dialog = container.closest('dialog');
  const menus = (dialog ?? container).querySelectorAll<HTMLElement>(vendorMenu);

  return Array.from(menus).some((menu) => menu.getClientRects().length > 0);
}

function blockTarget(target: EventTarget | null) {
  if (target instanceof Element && !target.closest(nativeControl)) {
    return target.closest<HTMLElement>('[data-document-read-block]')?.dataset.documentReadBlock;
  }
}

function notifyMode(
  onActivity: DocumentObjectProps['onActivity'],
  mode: DocumentActivity['mode'],
  dirty: boolean,
  saving: boolean,
  composing: boolean,
) {
  onActivity?.({ mode, dirty, saving, composing });
}

export function DocumentObject({
  value,
  interactive = true,
  readOnly: readOnlyDocument = false,
  theme = 'light',
  paper,
  canvas,
  focusedReading = false,
  annotationActive,
  nativeBlockRequest,
  expandControl,
  locked = false,
  onOpenPresentation,
  onClosePresentation,
  editRequest,
  onChange,
  onCommit,
  onActivity,
  onExport,
  onAnnotate,
  resolveImage,
  uploadImage,
}: DocumentObjectProps) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [composing, setComposing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const searchField = useRef<SearchFieldHandle>(null);
  const readOnly = readOnlyDocument;
  const writesPaused = [readOnly, annotationActive].some(Boolean);
  const {
    view,
    setView,
    mode: phase,
    standalone,
  } = useDocumentView({
    focused: focusedReading,
    readOnly,
    composing,
    editRequest,
    annotationActive,
    onOpen: onOpenPresentation,
  });
  const draft = useDocumentDraft({ value, readOnly: writesPaused, composing, onCommit, onChange });
  const { dirty, saving } = draft;
  const viewport = useDocumentViewport(
    phase,
    draft.draft.document,
    draft.confirmed.version,
    nativeBlockRequest,
    focusedReading,
  );
  const {
    scroll,
    body: paperNode,
    currentId,
    handleScroll,
    captureSelection,
    readSelection,
  } = viewport;
  const pan = useDocumentPan(phase, paperNode, scroll);
  const expanded = phase !== 'inline';
  const editing = phase === 'edit';
  const matchingIds = new Set(viewport.matches.map((block) => block.id));
  const { layout, shell, surface } = panelPresentation(paper, canvas, expanded);
  const observe = useEffectEvent(() => notifyMode(onActivity, phase, dirty, saving, composing));
  const focusReader = (focusedReading || interactive) && !editing;
  const annotation = useDocumentAnnotations({
    active: annotationActive,
    editing,
    interactive,
    focused: focusedReading,
    onAnnotate,
    readSelection,
    noteForBlock: viewport.noteForBlock,
  });

  useEffect(() => observe(), [phase, dirty, saving, composing]);
  useLayoutEffect(() => {
    if (focusReader) {
      paperNode.current?.parentElement?.focus({ preventScroll: true });
    }
  }, [focusedReading, focusReader, paperNode]);

  const capturePortal = useCallback((node: HTMLElement | null) => {
    if (node) {
      setPortal(node.ownerDocument.body);
    }
  }, []);

  function openEditor(focusBlockId?: string) {
    if (!writesPaused) {
      setView({ mode: 'edit', focusBlockId });
    }
  }

  function toggleExport() {
    setExportOpen((current) => !current);
  }

  function closeExport() {
    setExportOpen(false);
  }

  function annotate() {
    const note = readSelection();
    if (note) {
      onAnnotate?.(note);
    }
  }

  async function switchMode(mode: 'inline' | 'read') {
    if (composing || !(await draft.prepareExit())) {
      return false;
    }

    setComparing(false);
    setExportOpen(false);
    setView({ mode });

    return true;
  }

  function handleBack() {
    if (exportOpen) {
      setExportOpen(false);
    } else if (comparing) {
      setComparing(false);
    } else {
      switchMode('inline')
        .then((closed) => {
          if (closed && focusedReading) {
            onClosePresentation?.();
          }
        })
        .catch(draft.reportFailure);
    }
  }

  function handleRead() {
    switchMode('read').catch(draft.reportFailure);
  }

  function handleOpen() {
    if (phase === 'read') {
      paperNode.current?.parentElement?.focus({ preventScroll: true });
      return;
    }

    if (!onOpenPresentation) {
      setView({ mode: 'read' });
      return;
    }
    if (composing) {
      return;
    }

    switchMode('read').catch(draft.reportFailure);
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || editing || readOnly) {
      return;
    }
    if (annotationActive || !plainDocumentInput(event)) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest(nativeControl)) {
      return;
    }

    event.stopPropagation();
    openEditor(blockTarget(target));
  }

  function handleEscape(event: KeyboardEvent<HTMLDivElement>) {
    const composingNow = composing || event.nativeEvent.isComposing || event.key === 'Process';
    if (composingNow || event.repeat) {
      return;
    }

    const localDialog = comparing || exportOpen;
    const editingOwnsEscape =
      editing && !annotationActive && !vendorControlsOpen(event.currentTarget);

    if (!localDialog && !editingOwnsEscape) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (localDialog) {
      setExportOpen(false);
      setComparing(false);
    } else {
      handleRead();
    }
  }

  function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      handleEscape(event);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (annotation.handleAnnotationKey(event)) {
      return;
    }

    pan.handleKeyDown(event);
    if (handleReadingShortcut(event)) {
      return;
    }

    const command = event.ctrlKey || event.metaKey;
    if (expanded && command && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      searchField.current?.focus();
      return;
    }

    viewport.handleSelectAll(event);
  }

  function handleReadingShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
    const composingNow = event.nativeEvent.isComposing || event.key === 'Process';
    if (event.defaultPrevented || event.repeat || composingNow) {
      return false;
    }

    const canExitReader = focusedReading && !editing && !annotationActive;
    if (canExitReader && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleBack();

      return true;
    }

    const enterEditor = event.key === 'Enter' || event.key === 'F2';
    const target = event.target;
    const readingArea = paperNode.current?.parentElement;
    const inReader = target instanceof Element && readingArea?.contains(target);
    if (!enterEditor || !plainDocumentInput(event) || !inReader) {
      return false;
    }

    const blockedEditor = readOnly || editing || annotationActive;
    if (blockedEditor || target.closest(nativeControl)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    openEditor(blockTarget(target));

    return true;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    pan.handlePointerDown(event);
    if (event.defaultPrevented || event.button !== 0 || !focusReader) {
      return;
    }

    const target = event.target;
    const reader = paperNode.current?.parentElement;
    const inReader = target instanceof Element && reader?.contains(target);
    if (inReader && !target.closest(nativeControl)) {
      reader?.focus({ preventScroll: true });
    }
  }

  function renderActions(outline?: ReactNode) {
    return (
      <DocumentToolbar
        mode={phase}
        iconOnly={layout !== undefined || focusedReading}
        expandControl={expandControl}
        readOnly={readOnly}
        annotationActive={annotationActive}
        draft={draft}
        outline={outline}
        exportOpen={exportOpen}
        onEdit={() => openEditor()}
        onOpen={handleOpen}
        onRead={handleRead}
        onExport={onExport}
        onToggleExport={toggleExport}
        onCloseExport={closeExport}
        onAnnotate={onAnnotate ? annotate : undefined}
        canAnnotate={viewport.canAnnotate}
        onCompare={() => setComparing(true)}
      />
    );
  }
  const content = (
    <ScrollRegion label="文档正文" axis="both" contain ref={scroll} onScroll={handleScroll}>
      <div
        ref={paperNode}
        className="studio-document-paper"
        data-canvas-drag-surface={expanded ? undefined : 'background'}
        style={shell}
        onDoubleClick={handleDoubleClick}
        onClickCapture={annotation.handleAnnotationClick}
        onPointerUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {editing ? (
          <Suspense
            fallback={<StatusText message="正在打开文档编辑器" busy announcement="polite" />}
          >
            <DocumentEditor
              value={draft.draft.document}
              editable={!writesPaused || composing}
              theme={shell.colorScheme}
              focusBlockId={view.focusBlockId}
              resolveImage={resolveImage}
              uploadImage={uploadImage}
              onChange={(document) => draft.change({ document })}
              onCompositionChange={setComposing}
            />
          </Suspense>
        ) : (
          <DocumentReadView
            value={draft.draft.document}
            resolveImage={resolveImage}
            matchingIds={matchingIds}
            selectedId={currentId}
            annotation={annotation.enabled}
          />
        )}
      </div>
    </ScrollRegion>
  );
  const body = (
    <div
      className="studio-document-surface"
      data-document-view={phase}
      data-document-layout={layout}
      data-document-focused-reading={focusedReading || undefined}
      data-canvas-native={annotation.useNativeSurface ? '' : undefined}
      data-paper-scheme={shell.colorScheme}
      style={surface}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onKeyUp={pan.handleKeyUp}
      onBlur={pan.resetDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={pan.handlePointerMove}
      onPointerUp={pan.handlePointerEnd}
      onPointerCancel={pan.handlePointerEnd}
    >
      <DocumentReadingLayout
        focused={focusedReading}
        onBack={onClosePresentation ? handleBack : undefined}
        closingDisabled={composing}
        viewport={viewport}
        searchField={searchField}
        expanded={expanded}
        interactive={annotation.allowReadBody}
        heading={
          <>
            <DocumentCanvasHeading
              visible={layout !== undefined || focusedReading}
              moveHandle={layout !== undefined}
              locked={locked || writesPaused}
            />
            <DocumentTitle
              draft={draft}
              editing={editing}
              readOnly={writesPaused}
              inline={!expanded}
            />
          </>
        }
        renderActions={renderActions}
        comparison={
          comparing && (
            <DocumentComparison
              model={draft}
              readOnly={writesPaused}
              onClose={() => setComparing(false)}
            />
          )
        }
      >
        {content}
      </DocumentReadingLayout>
    </div>
  );

  return (
    <section
      ref={capturePortal}
      aria-label="白板文档"
      className="studio-document-object"
      data-theme={theme}
    >
      {standalone && portal
        ? createPortal(
            <Dialog
              open
              title={draft.draft.title || untitledDocument}
              closeLabel="返回画板"
              onRequestClose={handleBack}
            >
              {body}
            </Dialog>,
            portal,
          )
        : body}
    </section>
  );
}
