import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, ScrollRegion, StatusText } from '../../../base/index.js';
import type { SearchFieldHandle } from '../../../base/index.js';
import type { DocumentActivity, DocumentObjectProps } from './contracts.js';
import { DocumentReadView } from './DocumentReadView.js';
import {
  DocumentComparison,
  DocumentReaderTools,
  DocumentTitle,
  DocumentToolbar,
} from './DocumentToolbar.js';
import { untitledDocument } from './model.js';
import { useDocumentDraft } from './useDocumentDraft.js';
import { useDocumentPan } from './useDocumentPan.js';
import { useDocumentViewport } from './useDocumentViewport.js';
import './document-object.css';

const DocumentEditor = lazy(() => import('./DocumentEditor.js'));
const nativeControl = 'button,input,textarea,select,a[href],[contenteditable]';
const vendorMenu = '.bn-suggestion-menu,[role="menu"],[role="listbox"]';
const readingBackground = '#ffffff';
const readingInk = '#211f1d';

interface DocumentView {
  readonly mode: DocumentActivity['mode'];
  readonly focusBlockId?: string;
}

function panelStyles(paper: DocumentObjectProps['paper']) {
  const scheme = paper?.scheme ?? 'light';
  const backgroundColor = paper?.fill ?? (scheme === 'dark' ? '#1c1d1e' : readingBackground);
  const color = paper?.ink ?? (scheme === 'dark' ? '#f7f4ed' : readingInk);

  return { backgroundColor, color, colorScheme: scheme };
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
  readOnly = false,
  theme = 'light',
  paper,
  editRequest,
  onChange,
  onCommit,
  onActivity,
  onExport,
  onAnnotate,
  resolveImage,
  uploadImage,
}: DocumentObjectProps) {
  const [view, setView] = useState<DocumentView>({ mode: 'inline' });
  const [consumedEditRequest, setConsumedEditRequest] = useState<number>();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [composing, setComposing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const searchField = useRef<SearchFieldHandle>(null);
  const draft = useDocumentDraft({ value, readOnly, composing, onCommit, onChange });
  const { dirty, saving } = draft;
  const phase = view.mode === 'edit' && readOnly && !composing ? 'read' : view.mode;
  const viewport = useDocumentViewport(phase, draft.draft.document, draft.confirmed.version);
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
  const shell = panelStyles(paper);
  const observe = useEffectEvent(() => notifyMode(onActivity, phase, dirty, saving, composing));

  if (editRequest !== undefined && consumedEditRequest !== editRequest) {
    setConsumedEditRequest(editRequest);
    if (!readOnly) {
      setView({ mode: 'edit' });
    }
  }

  useEffect(() => observe(), [phase, dirty, saving, composing]);

  const capturePortal = useCallback((node: HTMLElement | null) => {
    if (node) {
      setPortal(node.ownerDocument.body);
    }
  }, []);

  function openEditor(focusBlockId?: string) {
    if (!readOnly) {
      setView({ mode: 'edit', focusBlockId });
    }
  }

  function toggleExport() {
    setExportOpen((current) => !current);
  }

  function annotate() {
    const note = readSelection();
    if (note) {
      onAnnotate?.(note);
    }
  }

  async function switchMode(mode: 'inline' | 'read') {
    if (composing || !(await draft.prepareExit())) {
      return;
    }

    setComparing(false);
    setExportOpen(false);
    setView({ mode });
  }

  function handleBack() {
    if (exportOpen) {
      setExportOpen(false);
    } else if (comparing) {
      setComparing(false);
    } else {
      switchMode('inline').catch(draft.reportFailure);
    }
  }

  function handleRead() {
    switchMode('read').catch(draft.reportFailure);
  }

  function handleOpen() {
    setView({ mode: 'read' });
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || expanded || readOnly) {
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
    if (composing || event.nativeEvent.isComposing || vendorControlsOpen(event.currentTarget)) {
      return;
    }

    const consumed = editing || comparing || exportOpen;
    if (!consumed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (exportOpen || comparing) {
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
    pan.handleKeyDown(event);
    const command = event.ctrlKey || event.metaKey;
    if (expanded && command && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      searchField.current?.focus();
      return;
    }

    viewport.handleSelectAll(event);
  }

  const actions = (
    <DocumentToolbar
      mode={phase}
      readOnly={readOnly}
      draft={draft}
      exportOpen={exportOpen}
      onEdit={() => openEditor()}
      onOpen={handleOpen}
      onRead={handleRead}
      onExport={onExport}
      onToggleExport={toggleExport}
      onAnnotate={onAnnotate ? annotate : undefined}
      onCompare={() => setComparing(true)}
    />
  );
  const body = (
    <div
      className="studio-document-surface"
      data-document-view={phase}
      data-paper-scheme={shell.colorScheme}
      style={{ backgroundColor: paper?.backdrop ?? shell.backgroundColor, color: shell.color }}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onKeyUp={pan.handleKeyUp}
      onBlur={pan.resetDrag}
      onPointerDown={pan.handlePointerDown}
      onPointerMove={pan.handlePointerMove}
      onPointerUp={pan.handlePointerEnd}
      onPointerCancel={pan.handlePointerEnd}
    >
      <div className="studio-document-top">
        <DocumentTitle draft={draft} editing={editing} readOnly={readOnly} inline={!expanded} />
        {actions}
        {expanded && <DocumentReaderTools viewport={viewport} searchField={searchField} />}
      </div>
      <ScrollRegion label="文档正文" axis="both" contain ref={scroll} onScroll={handleScroll}>
        <div
          ref={paperNode}
          className="studio-document-paper"
          data-canvas-drag-surface={expanded ? undefined : 'background'}
          style={shell}
          onDoubleClick={handleDoubleClick}
          onPointerUp={captureSelection}
          onKeyUp={captureSelection}
        >
          {editing ? (
            <Suspense
              fallback={<StatusText message="正在打开文档编辑器" busy announcement="polite" />}
            >
              <DocumentEditor
                value={draft.draft.document}
                editable={!readOnly || composing}
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
            />
          )}
        </div>
      </ScrollRegion>
      {comparing && (
        <DocumentComparison model={draft} readOnly={readOnly} onClose={() => setComparing(false)} />
      )}
    </div>
  );

  return (
    <section
      ref={capturePortal}
      aria-label="白板文档"
      className="studio-document-object"
      data-theme={theme}
    >
      {expanded && portal
        ? createPortal(
            <Dialog
              open
              title={draft.draft.title || untitledDocument}
              closeLabel="返回白板"
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
