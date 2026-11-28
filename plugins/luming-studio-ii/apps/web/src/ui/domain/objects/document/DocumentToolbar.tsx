import { useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { Button, Select, StatusText, Toolbar } from '../../../base/index.js';
import type { SearchFieldHandle } from '../../../base/index.js';
import type { DocumentActivity, DocumentExportFormat, DocumentObjectProps } from './contracts.js';
import { blockText, documentText, documentTitleLimit, untitledDocument } from './model.js';
import type { useDocumentDraft } from './useDocumentDraft.js';
import type { useDocumentViewport } from './useDocumentViewport.js';

type ExportAction = NonNullable<DocumentObjectProps['onExport']>;

interface EditorToolbarProps {
  readonly mode: DocumentActivity['mode'];
  readonly editorState?: 'loading' | 'failed';
  readonly iconOnly?: boolean;
  readonly expandControl?: DocumentObjectProps['expandControl'];
  readonly readOnly: boolean;
  readonly annotationActive?: boolean;
  readonly exportOpen: boolean;
  readonly draft: ReturnType<typeof useDocumentDraft>;
  readonly outline?: ReactNode;
  readonly onEdit: () => void;
  readonly onRead: () => void;
  readonly onOpen: () => void;
  readonly onToggleExport: () => void;
  readonly onCloseExport: () => void;
  readonly onExport?: DocumentObjectProps['onExport'];
  readonly onAnnotate?: () => void;
  readonly canAnnotate: boolean;
  readonly onCompare: () => void;
}

function DocumentOpenIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m-5 13h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

function DocumentEditIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 5l4 4M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4.8 16z" />
    </svg>
  );
}

function DocumentExportIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12m-4-4 4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export function DocumentReadIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 7v15M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3a6 6 0 0 1 6 6 6 6 0 0 1 6-6h3a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4a5 5 0 0 0-5 4 5 5 0 0 0-5-4Z" />
    </svg>
  );
}

function DocumentSaveStatus({ draft }: { readonly draft: EditorToolbarProps['draft'] }) {
  if (draft.failure) {
    return <StatusText message="未保存" tone="error" announcement="polite" />;
  }
  if (draft.saving) {
    return <StatusText message="保存中" busy announcement="polite" />;
  }

  return <StatusText message={draft.dirty ? '待保存' : '已保存'} announcement="polite" />;
}

function DocumentCanvasSaveStatus({ draft }: { readonly draft: EditorToolbarProps['draft'] }) {
  const confirmed = !draft.failure && !draft.saving && !draft.dirty;

  return (
    <span
      className="studio-document-canvas-save"
      data-document-save-failed={Boolean(draft.failure) || undefined}
    >
      {confirmed && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      <DocumentSaveStatus draft={draft} />
    </span>
  );
}

function DocumentExport({
  draft,
  iconOnly,
  exportOpen,
  onToggleExport,
  onCloseExport,
  onExport,
}: Pick<
  EditorToolbarProps,
  'draft' | 'exportOpen' | 'iconOnly' | 'onToggleExport' | 'onCloseExport'
> & {
  readonly onExport: ExportAction;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const activeExport = useRef<AbortController | undefined>(undefined);
  const closeMenu = useEffectEvent(onCloseExport);

  useEffect(() => () => activeExport.current?.abort(), []);
  useEffect(() => {
    const node = menu.current;
    if (!exportOpen || !node) {
      return;
    }

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !node?.contains(event.target)) {
        closeMenu();
      }
    }

    const owner = node.ownerDocument;
    owner.addEventListener('pointerdown', closeOutside);

    return () => owner.removeEventListener('pointerdown', closeOutside);
  }, [exportOpen]);

  async function exportDocument(format: DocumentExportFormat, signal: AbortSignal) {
    const value = await draft.prepareExport();
    if (value && !signal.aborted) {
      const { title, document } = value;
      await onExport(format, { title, document }, signal);
    }
  }

  function handleExport(format: DocumentExportFormat) {
    if (activeExport.current) {
      return;
    }

    const controller = new AbortController();
    activeExport.current = controller;
    onCloseExport();
    exportDocument(format, controller.signal)
      .finally(() => {
        activeExport.current = undefined;
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          draft.reportFailure(failure);
        }
      });
  }

  return (
    <div ref={menu} className="studio-document-export">
      <Button
        label="导出文档"
        variant="ghost"
        icon={iconOnly ? <DocumentExportIcon /> : undefined}
        iconOnly={iconOnly}
        onActivate={onToggleExport}
      />
      {exportOpen && (
        <div className="studio-document-export-options" role="menu" aria-label="文档导出格式">
          <button type="button" role="menuitem" onClick={() => handleExport('md')}>
            全文 Markdown
          </button>
          <button type="button" role="menuitem" onClick={() => handleExport('html')}>
            全文 HTML
          </button>
          <button type="button" role="menuitem" onClick={() => handleExport('json')}>
            块 JSON
          </button>
        </div>
      )}
    </div>
  );
}

function DocumentModeAction({
  mode,
  editorState,
  iconOnly,
  readOnly,
  annotationActive,
  onEdit,
  onRead,
  onOpen,
}: Pick<
  EditorToolbarProps,
  | 'mode'
  | 'editorState'
  | 'iconOnly'
  | 'readOnly'
  | 'annotationActive'
  | 'onEdit'
  | 'onRead'
  | 'onOpen'
>) {
  const variant = iconOnly ? 'ghost' : undefined;
  if (editorState === 'loading') {
    return (
      <Button
        label="取消打开文档编辑器"
        icon={iconOnly ? '×' : undefined}
        iconOnly={iconOnly}
        variant={variant}
        onActivate={onRead}
      />
    );
  }
  if (mode === 'edit') {
    return (
      <Button
        label={iconOnly ? '阅读文档' : '回到阅读'}
        icon={iconOnly ? <DocumentReadIcon /> : undefined}
        iconOnly={iconOnly}
        variant={variant}
        disabled={annotationActive}
        onActivate={onRead}
      />
    );
  }
  if (readOnly) {
    return (
      <Button
        label="阅读文档"
        icon={iconOnly ? <DocumentReadIcon /> : undefined}
        iconOnly={iconOnly}
        variant={variant}
        onActivate={onOpen}
      />
    );
  }

  return (
    <Button
      label="编辑文档"
      icon={iconOnly ? <DocumentEditIcon /> : undefined}
      iconOnly={iconOnly}
      variant={variant}
      disabled={annotationActive || editorState === 'failed'}
      onActivate={onEdit}
    />
  );
}

function DocumentEditorStatus({ state }: { readonly state: EditorToolbarProps['editorState'] }) {
  if (!state) {
    return null;
  }

  const loading = state === 'loading';
  return (
    <span className="studio-document-editor-status">
      <StatusText
        message={loading ? '正在打开文档编辑器' : '编辑器打开失败，可继续阅读'}
        tone={loading ? 'neutral' : 'error'}
        busy={loading}
        announcement={loading ? 'polite' : 'assertive'}
      />
    </span>
  );
}

function DocumentExpandAction({
  iconOnly,
  expandControl,
  onOpen,
}: Pick<EditorToolbarProps, 'iconOnly' | 'expandControl' | 'onOpen'>) {
  const button = (
    <Button
      label={expandControl?.label ?? '放大阅读'}
      icon={iconOnly ? <DocumentOpenIcon /> : undefined}
      iconOnly={iconOnly}
      variant={iconOnly ? 'ghost' : undefined}
      onActivate={onOpen}
    />
  );

  return expandControl ? (
    <span className="studio-document-expand-control" title={expandControl.title}>
      {button}
    </span>
  ) : (
    button
  );
}

export function DocumentToolbar({
  mode,
  editorState,
  iconOnly = false,
  expandControl,
  readOnly,
  annotationActive,
  draft,
  outline,
  onEdit,
  onRead,
  onOpen,
  exportOpen,
  onToggleExport,
  onCloseExport,
  onExport,
  onAnnotate,
  canAnnotate,
  onCompare,
}: EditorToolbarProps) {
  function handleRetry() {
    draft.save().catch(draft.reportFailure);
  }

  return (
    <>
      <Toolbar label="文档操作">
        {iconOnly && !editorState && <DocumentCanvasSaveStatus draft={draft} />}
        <DocumentEditorStatus state={editorState} />
        <DocumentModeAction
          mode={mode}
          editorState={editorState}
          iconOnly={iconOnly}
          readOnly={readOnly}
          annotationActive={annotationActive}
          onEdit={onEdit}
          onRead={onRead}
          onOpen={onOpen}
        />
        {mode === 'inline' && (
          <DocumentExpandAction iconOnly={iconOnly} expandControl={expandControl} onOpen={onOpen} />
        )}
        {outline}
        {onExport && (
          <DocumentExport
            draft={draft}
            iconOnly={iconOnly}
            exportOpen={exportOpen}
            onToggleExport={onToggleExport}
            onCloseExport={onCloseExport}
            onExport={onExport}
          />
        )}
        {!onExport && iconOnly && (
          <Button
            label="导出文档"
            icon={<DocumentExportIcon />}
            iconOnly
            variant="ghost"
            disabled
          />
        )}
        {onAnnotate && !iconOnly && mode !== 'edit' && (
          <Button
            label="标注所选段落"
            variant="ghost"
            disabled={!canAnnotate}
            onActivate={onAnnotate}
          />
        )}
        {!iconOnly && mode === 'edit' && <DocumentSaveStatus draft={draft} />}
      </Toolbar>
      {draft.failure && (
        <div className="studio-document-notice">
          <StatusText message={draft.failure} tone="error" announcement="assertive" />
          <Button
            label="重试保存"
            disabled={readOnly || annotationActive || draft.saving}
            onActivate={handleRetry}
          />
          <Button label="比较最新内容" onActivate={onCompare} />
        </div>
      )}
    </>
  );
}

interface DocumentReaderToolsProps {
  readonly viewport: ReturnType<typeof useDocumentViewport>;
  readonly searchField: Ref<SearchFieldHandle>;
  readonly showOutline?: boolean;
}

function outlineOptions(headings: ReturnType<typeof useDocumentViewport>['headings']) {
  return [
    { id: '', label: '文档目录', disabled: true },
    ...headings.map((block) => ({ id: block.id, label: blockText(block) || '未命名标题' })),
  ];
}

export function DocumentOutlineSelect({ viewport }: Pick<DocumentReaderToolsProps, 'viewport'>) {
  return (
    <Select
      label="跳转文档标题"
      value=""
      options={outlineOptions(viewport.headings)}
      onValueChange={viewport.reveal}
    />
  );
}

function DocumentSearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function DocumentReaderTools({
  viewport,
  searchField,
  showOutline = true,
}: DocumentReaderToolsProps) {
  const { headings, find, matches, matchIndex, handleFind, advance, reveal } = viewport;
  const input = useRef<HTMLInputElement>(null);
  const current = matches[Math.min(matchIndex, matches.length - 1)];
  const count = matches.length;
  const position = current ? String(matchIndex + 1) + ' / ' : '';

  useImperativeHandle(
    searchField,
    () => ({
      focus() {
        input.current?.focus();
      },
    }),
    [],
  );

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      advance(event.shiftKey ? -1 : 1);
    }
  }

  return (
    <div className="studio-document-reader-tools">
      <DocumentSearchIcon />
      <input
        ref={input}
        type="search"
        aria-label="文档内查找"
        placeholder="查找文档…"
        value={find}
        onChange={(event) => handleFind(event.currentTarget.value)}
        onKeyDown={handleSearchKey}
      />
      {find.trim() && <StatusText message={position + count + ' 处'} announcement="polite" />}
      {current && (
        <>
          <Button label="定位" variant="ghost" onActivate={() => reveal(current.id)} />
          <Button
            label="上一个匹配"
            iconOnly
            icon="‹"
            variant="ghost"
            onActivate={() => advance(-1)}
          />
          <Button
            label="下一个匹配"
            iconOnly
            icon="›"
            variant="ghost"
            onActivate={() => advance(1)}
          />
        </>
      )}
      {find && (
        <Button
          label="清除文档查找"
          iconOnly
          icon="×"
          variant="ghost"
          onActivate={() => handleFind('')}
        />
      )}
      {showOutline && headings.length > 0 && <DocumentOutlineSelect viewport={viewport} />}
    </div>
  );
}

export function DocumentTitle({
  draft,
  editing,
  readOnly,
  inline,
}: {
  readonly draft: EditorToolbarProps['draft'];
  readonly editing: boolean;
  readonly readOnly: boolean;
  readonly inline: boolean;
}) {
  const title = draft.draft.title || untitledDocument;
  if (!inline) {
    return (
      <input
        className="studio-document-title"
        aria-label="文档标题"
        value={draft.draft.title}
        readOnly={!editing || readOnly}
        maxLength={documentTitleLimit}
        onChange={(event) =>
          draft.change({ title: event.currentTarget.value.slice(0, documentTitleLimit) })
        }
      />
    );
  }

  return (
    <h2
      className="studio-document-title"
      aria-label="文档标题"
      title={title}
      data-canvas-drag-surface="title"
    >
      {title}
    </h2>
  );
}

export function DocumentComparison({
  model,
  readOnly,
  onClose,
}: {
  readonly model: EditorToolbarProps['draft'];
  readonly readOnly: boolean;
  readonly onClose: () => void;
}) {
  function handleAdopt() {
    model.useCurrent();
    onClose();
  }

  async function overwrite() {
    if (await model.save(true)) {
      onClose();
    }
  }

  function handleOverwrite() {
    overwrite().catch(model.reportFailure);
  }

  return (
    <section className="studio-document-comparison" role="dialog" aria-label="比较文档草稿">
      <div>
        <h3>最新已保存内容</h3>
        <p>{model.confirmed.title}</p>
        <pre>{documentText(model.confirmed.document)}</pre>
      </div>
      <div>
        <h3>我的草稿</h3>
        <p>{model.draft.title}</p>
        <pre>{documentText(model.draft.document)}</pre>
      </div>
      <Toolbar label="比较结果">
        <Button label="保留草稿" onActivate={onClose} />
        <Button label="采用最新内容" disabled={model.saving} onActivate={handleAdopt} />
        <Button
          label="保存此草稿"
          disabled={readOnly || model.saving}
          onActivate={handleOverwrite}
        />
      </Toolbar>
    </section>
  );
}
