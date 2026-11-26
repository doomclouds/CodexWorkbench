import type { KeyboardEvent, Ref } from 'react';
import {
  Button,
  SearchField,
  Select,
  StatusText,
  TextField,
  Toolbar,
} from '../../../base/index.js';
import type { SearchFieldHandle } from '../../../base/index.js';
import type { DocumentActivity, DocumentDraft, DocumentObjectProps } from './contracts.js';
import { blockText, documentText, documentTitleLimit, untitledDocument } from './model.js';
import type { useDocumentDraft } from './useDocumentDraft.js';
import type { useDocumentViewport } from './useDocumentViewport.js';

type ExportAction = NonNullable<DocumentObjectProps['onExport']>;

interface EditorToolbarProps {
  readonly mode: DocumentActivity['mode'];
  readonly iconOnly?: boolean;
  readonly readOnly: boolean;
  readonly exportOpen: boolean;
  readonly draft: ReturnType<typeof useDocumentDraft>;
  readonly onEdit: () => void;
  readonly onRead: () => void;
  readonly onOpen: () => void;
  readonly onToggleExport: () => void;
  readonly onExport?: DocumentObjectProps['onExport'];
  readonly onAnnotate?: () => void;
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

function DocumentSaveStatus({ draft }: { readonly draft: EditorToolbarProps['draft'] }) {
  if (draft.failure) {
    return <StatusText message="未保存" tone="error" announcement="polite" />;
  }
  if (draft.saving) {
    return <StatusText message="保存中" busy announcement="polite" />;
  }

  return <StatusText message={draft.dirty ? '待保存' : '已保存'} />;
}

function DocumentCanvasSaveStatus({ draft }: { readonly draft: EditorToolbarProps['draft'] }) {
  const confirmed = !draft.failure && !draft.saving && !draft.dirty;

  return (
    <span className="studio-document-canvas-save">
      {confirmed && (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m2 8 4 4 8-8" />
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
  onExport,
}: Pick<EditorToolbarProps, 'exportOpen' | 'iconOnly' | 'onToggleExport'> & {
  readonly draft: DocumentDraft;
  readonly onExport: ExportAction;
}) {
  function exportDocument(format: 'html' | 'json') {
    onExport(format, draft);
    onToggleExport();
  }

  return (
    <div className="studio-document-export">
      <Button
        label="导出文档"
        variant="ghost"
        icon={iconOnly ? <DocumentExportIcon /> : undefined}
        iconOnly={iconOnly}
        onActivate={onToggleExport}
      />
      {exportOpen && (
        <div className="studio-document-export-options" role="group" aria-label="文档导出格式">
          <Button label="全文 HTML" onActivate={() => exportDocument('html')} />
          <Button label="块 JSON" onActivate={() => exportDocument('json')} />
        </div>
      )}
    </div>
  );
}

export function DocumentToolbar({
  mode,
  iconOnly = false,
  readOnly,
  draft,
  onEdit,
  onRead,
  onOpen,
  exportOpen,
  onToggleExport,
  onExport,
  onAnnotate,
  onCompare,
}: EditorToolbarProps) {
  function handleRetry() {
    draft.save().catch(draft.reportFailure);
  }

  return (
    <>
      <Toolbar label="文档操作">
        {iconOnly && <DocumentCanvasSaveStatus draft={draft} />}
        {mode !== 'edit' && (!readOnly || iconOnly) && (
          <Button
            label="编辑文档"
            icon={iconOnly ? <DocumentEditIcon /> : undefined}
            iconOnly={iconOnly}
            variant={iconOnly ? 'ghost' : undefined}
            disabled={readOnly}
            onActivate={onEdit}
          />
        )}
        {mode === 'inline' && (
          <Button
            label="放大阅读"
            icon={iconOnly ? <DocumentOpenIcon /> : undefined}
            iconOnly={iconOnly}
            variant={iconOnly ? 'ghost' : undefined}
            onActivate={onOpen}
          />
        )}
        {mode === 'edit' && <Button label="回到阅读" onActivate={onRead} />}
        {onExport && (
          <DocumentExport
            draft={draft.draft}
            iconOnly={iconOnly}
            exportOpen={exportOpen}
            onToggleExport={onToggleExport}
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
        {onAnnotate && mode !== 'edit' && (
          <Button label="标注所选段落" variant="ghost" onActivate={onAnnotate} />
        )}
        {mode === 'edit' && <DocumentSaveStatus draft={draft} />}
      </Toolbar>
      {draft.failure && (
        <div className="studio-document-notice">
          <StatusText message={draft.failure} tone="error" announcement="assertive" />
          <Button label="重试保存" disabled={readOnly || draft.saving} onActivate={handleRetry} />
          <Button label="比较最新内容" onActivate={onCompare} />
        </div>
      )}
    </>
  );
}

interface DocumentReaderToolsProps {
  readonly viewport: ReturnType<typeof useDocumentViewport>;
  readonly searchField: Ref<SearchFieldHandle>;
}

export function DocumentReaderTools({ viewport, searchField }: DocumentReaderToolsProps) {
  const { headings, find, matches, matchIndex, handleFind, advance, reveal } = viewport;

  function handleSearchKey(event: KeyboardEvent<HTMLDivElement>) {
    const searchInput = event.target instanceof HTMLInputElement;
    if (searchInput && event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      advance(event.shiftKey ? -1 : 1);
    }
  }

  return (
    <div className="studio-document-reader-tools" onKeyDown={handleSearchKey}>
      <SearchField
        label="查找文档"
        clearLabel="清空查找"
        value={find}
        onValueChange={handleFind}
        ref={searchField}
      />
      {find.trim() && (
        <StatusText
          message={
            matches.length ? String(matchIndex + 1) + ' / ' + matches.length : '没有匹配结果'
          }
          announcement="polite"
        />
      )}
      {matches.length > 1 && (
        <>
          <Button label="上一处" variant="ghost" onActivate={() => advance(-1)} />
          <Button label="下一处" variant="ghost" onActivate={() => advance(1)} />
        </>
      )}
      {headings.length > 0 && (
        <Select
          label="文档目录"
          value=""
          options={[
            { id: '', label: '跳到标题' },
            ...headings.map((block) => ({
              id: block.id,
              label: blockText(block) || untitledDocument,
            })),
          ]}
          onValueChange={reveal}
        />
      )}
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
  function handleTitleChange(title: string) {
    draft.change({ title: title.slice(0, documentTitleLimit) });
  }

  if (editing) {
    return (
      <TextField
        label="文档名称"
        value={draft.draft.title}
        readOnly={readOnly}
        onValueChange={handleTitleChange}
      />
    );
  }

  return (
    <h2 className="studio-document-title" data-canvas-drag-surface={inline ? 'title' : undefined}>
      {draft.draft.title || untitledDocument}
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
    <section className="studio-document-comparison" aria-label="比较文档草稿">
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
