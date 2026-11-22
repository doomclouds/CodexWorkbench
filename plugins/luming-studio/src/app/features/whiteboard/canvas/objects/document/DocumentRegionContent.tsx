import { lazy, Suspense, type RefObject } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FileText,
  GripVertical,
  List,
  Loader2,
  Maximize,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import type { BoardElement, StudioClient } from '../../../../../../contracts/studio.js';
import {
  defaultDocument,
  documentBlockText,
  documentPlainText,
  type DocumentBlock,
} from '../../../../../../contracts/document.js';
import type useDocumentDraft from './useDocumentDraft.js';
import type useDocumentAnnotations from './useDocumentAnnotations.js';
import OperationNotice from '../../../../../shared/OperationNotice.js';
import DocumentReadView from './DocumentReadView.js';
import { DraftRecoveryPicker } from '../../../DraftRecoveryPicker.js';

const DocumentEditor = lazy(() => import('./DocumentEditor.js'));

type Draft = ReturnType<typeof useDocumentDraft>;
type Annotations = ReturnType<typeof useDocumentAnnotations>;

interface DocumentHeadingProps {
  draft: Draft;
  showActions: boolean;
  expanded: boolean;
  editing: boolean;
  canEdit: boolean;
  locked: boolean;
  titleEditable: boolean;
  disabled: boolean;
  hasHeadings: boolean;
  tocOpen: boolean;
  exportMenu: boolean;
  onToggleToc(): void;
  onToggleExport(): void;
  onExport(format: 'html' | 'json'): void;
  onMoveStart?: React.PointerEventHandler<HTMLButtonElement>;
  onBack(): void;
  onToggleEditor(): void;
  onExpand(): void;
}

function SaveIndicator({ saving, error, dirty }: Pick<Draft, 'saving' | 'error' | 'dirty'>) {
  let label: React.ReactNode;
  if (saving) {
    label = (
      <>
        <Loader2 size={13} className="studio-spin" />
        保存中
      </>
    );
  } else if (error) {
    label = '未保存';
  } else if (dirty) {
    label = '待保存';
  } else {
    label = (
      <>
        <Check size={13} />
        已保存
      </>
    );
  }

  return (
    <span className={`studio-document-save${error ? ' has-error' : ''}`} role="status">
      {label}
    </span>
  );
}

export function DocumentHeading({
  draft,
  showActions,
  expanded,
  editing,
  canEdit,
  locked,
  titleEditable,
  disabled,
  hasHeadings,
  tocOpen,
  exportMenu,
  onToggleToc,
  onToggleExport,
  onExport,
  onMoveStart,
  onBack,
  onToggleEditor,
  onExpand,
}: DocumentHeadingProps) {
  function handleMove(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0 && canEdit && !locked) {
      onMoveStart?.(event);
    }
  }

  const editorLabel = canEdit && !editing ? '编辑文档' : '阅读文档';
  const { title, setTitle } = draft;

  return (
    <header className="studio-document-heading" data-document-controls="true">
      {expanded && (
        <button type="button" className="studio-button" disabled={disabled} onClick={onBack}>
          <ArrowLeft size={16} />
          返回画板
        </button>
      )}
      {showActions && !expanded && onMoveStart && (
        <button
          type="button"
          className="studio-document-move"
          aria-label="移动文档"
          title={locked ? '文档位置已锁定' : '拖动把手移动文档'}
          disabled={!canEdit || locked}
          data-document-move-handle="true"
          onPointerDown={handleMove}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>
      )}
      {showActions && <FileText className="studio-document-kind" size={18} />}
      {expanded ? (
        <input
          aria-label="文档标题"
          value={title}
          readOnly={!titleEditable}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
        />
      ) : (
        <span className="studio-document-title" aria-label="文档标题" title={title}>
          {title}
        </span>
      )}
      {showActions && (
        <>
          <SaveIndicator saving={draft.saving} error={draft.error} dirty={draft.dirty} />
          <button
            type="button"
            className="studio-icon-button studio-document-edit"
            aria-label={editorLabel}
            title={editorLabel}
            disabled={disabled}
            onClick={onToggleEditor}
          >
            {editing ? <BookOpen size={17} /> : <Pencil size={17} />}
          </button>
          {!expanded && (
            <button
              type="button"
              className="studio-icon-button"
              aria-label="展开文档"
              title="展开阅读与编辑"
              onClick={onExpand}
            >
              <Maximize size={17} />
            </button>
          )}
          {expanded && hasHeadings && (
            <button
              type="button"
              className="studio-icon-button"
              aria-label="切换文档目录"
              title="文档目录"
              aria-expanded={tocOpen}
              onClick={onToggleToc}
            >
              <List size={17} />
            </button>
          )}
          <div className="studio-document-export">
            <button
              type="button"
              className="studio-icon-button"
              aria-label="导出文档"
              title="导出全文"
              aria-expanded={exportMenu}
              onClick={onToggleExport}
            >
              <Download size={16} />
            </button>
            {exportMenu && (
              <div role="menu" aria-label="文档导出格式">
                <button type="button" role="menuitem" onClick={() => onExport('html')}>
                  全文 HTML
                </button>
                <button type="button" role="menuitem" onClick={() => onExport('json')}>
                  块 JSON
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </header>
  );
}

interface DocumentSearchProps {
  value: string;
  index: number;
  matches: DocumentBlock[];
  onChange(value: string): void;
  onAdvance(delta: number): void;
  onReveal(id: string): void;
}

export function DocumentSearch({
  value,
  index,
  matches,
  onChange,
  onAdvance,
  onReveal,
}: DocumentSearchProps) {
  function handleSearchKey(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onAdvance(event.shiftKey ? -1 : 1);
    }
  }

  const count = matches.length;
  const current = Math.min(index, count - 1);
  const position = count > 0 ? `${current + 1} / ` : '';

  return (
    <div className="studio-document-find">
      <Search size={15} />
      <input
        aria-label="文档内查找"
        placeholder="查找文档…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleSearchKey}
      />
      <span>{value.trim() ? `${position}${count} 处` : ''}</span>
      {count > 0 && (
        <>
          <button
            type="button"
            className="studio-link-button"
            onClick={() => onReveal(matches[current].id)}
          >
            定位
          </button>
          <button
            type="button"
            className="studio-icon-button"
            aria-label="上一个匹配"
            onClick={() => onAdvance(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="studio-icon-button"
            aria-label="下一个匹配"
            onClick={() => onAdvance(1)}
          >
            ›
          </button>
        </>
      )}
      {value && (
        <button
          type="button"
          className="studio-icon-button"
          aria-label="清除文档查找"
          onClick={() => onChange('')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function DocumentOutline({
  headings,
  compact = false,
  onReveal,
}: {
  headings: DocumentBlock[];
  compact?: boolean;
  onReveal(id: string): void;
}) {
  if (compact) {
    return (
      <select
        className="studio-document-mobile-toc"
        aria-label="跳转文档标题"
        value=""
        onChange={(event) => onReveal(event.target.value)}
      >
        <option value="" disabled>
          文档目录
        </option>
        {headings.map((block) => (
          <option key={block.id} value={block.id}>
            {documentBlockText(block) || '未命名标题'}
          </option>
        ))}
      </select>
    );
  }

  return (
    <nav className="studio-document-toc" aria-label="文档目录">
      <strong>目录</strong>
      {headings.map((block) => (
        <button
          type="button"
          key={block.id}
          onClick={() => onReveal(block.id)}
          style={{ paddingLeft: 10 + (Number(block.props.level) || 1) * 8 }}
        >
          {documentBlockText(block) || '未命名标题'}
        </button>
      ))}
    </nav>
  );
}

export function DocumentDraftRecovery({
  draft,
  canEdit,
  onRestore,
}: {
  draft: Draft;
  canEdit: boolean;
  onRestore(raw: string): void;
}) {
  return (
    <>
      {canEdit && (
        <DraftRecoveryPicker
          slot={draft.draftSlot}
          canRecover={!draft.dirty}
          compare={draft.compareRecovery}
          onRecover={onRestore}
          onError={draft.reportError}
        />
      )}
      {draft.warning && (
        <OperationNotice
          source="文档草稿"
          message={draft.warning}
          closeLabel="关闭文档草稿通知"
          fallbackClass="studio-document-message has-error"
          actions={
            <button type="button" onClick={draft.copy}>
              复制本机草稿
            </button>
          }
        />
      )}
    </>
  );
}

export function DocumentSaveNotices({
  draft,
  element,
  canEdit,
}: {
  draft: Draft;
  element: BoardElement;
  canEdit: boolean;
}) {
  function save(overwrite: boolean) {
    draft.save(overwrite).catch(draft.reportError);
  }

  const saveDisabled = draft.saving || !canEdit;

  return (
    <>
      {draft.error && (
        <OperationNotice
          source={`文档 · ${draft.title}`}
          message={draft.error}
          closeLabel="关闭文档保存通知"
          fallbackClass="studio-document-message has-error"
          actions={
            <>
              <button type="button" onClick={() => save(false)} disabled={saveDisabled}>
                重试保存
              </button>
              <button type="button" onClick={() => draft.setComparing(true)}>
                比较最新内容
              </button>
              <button type="button" onClick={draft.copy}>
                复制草稿
              </button>
            </>
          }
        />
      )}
      {draft.comparing && (
        <div className="studio-document-comparison" role="dialog" aria-label="比较文档草稿">
          <h3>比较最新内容后再保存</h3>
          <div>
            <section>
              <strong>当前已保存内容 · {element.text || '文档'}</strong>
              <pre>{documentPlainText(element.document ?? defaultDocument())}</pre>
            </section>
            <section>
              <strong>你的文档草稿 · {draft.title}</strong>
              <pre>{documentPlainText(draft.document)}</pre>
            </section>
          </div>
          <footer>
            <button type="button" onClick={() => draft.setComparing(false)}>
              保留草稿
            </button>
            <button type="button" disabled={draft.saving} onClick={draft.adoptCurrent}>
              采用当前内容
            </button>
            <button type="button" disabled={saveDisabled} onClick={() => save(true)}>
              保存已比较的草稿
            </button>
          </footer>
        </div>
      )}
    </>
  );
}

interface DocumentViewportProps {
  draft: Draft;
  annotations: Annotations;
  client: StudioClient;
  scheme: 'light' | 'dark';
  highlightedIds: string[];
  editorTargetIds: string[];
  find: string;
  expanded: boolean;
  interactive: boolean;
  zoom: number;
  showEditor: boolean;
  editable: boolean;
  initialFocusBlockId?: string;
  annotatingRead: boolean;
  scroll: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  onScroll(event: React.UIEvent<HTMLDivElement>): void;
  onCompositionChange(active: boolean): void;
  uploadFile(file: File): Promise<string>;
  resolveFileUrl(source: string): Promise<string>;
  renderCommentPins?: (id: string) => React.ReactNode;
}

export function DocumentViewport({
  draft,
  annotations,
  client,
  scheme,
  highlightedIds,
  editorTargetIds,
  find,
  expanded,
  interactive,
  zoom,
  showEditor,
  editable,
  initialFocusBlockId,
  annotatingRead,
  scroll,
  content,
  onScroll,
  onCompositionChange,
  uploadFile,
  resolveFileUrl,
  renderCommentPins,
}: DocumentViewportProps) {
  const readingEnabled = interactive || expanded;
  const readerTabIndex = readingEnabled ? 0 : -1;
  const previewPointer = annotatingRead ? annotations.handleAnnotationPointer : undefined;
  const clearPreview = annotatingRead ? annotations.clearPreview : undefined;

  return (
    <div
      ref={scroll}
      className="studio-document-scroll"
      data-document-content="true"
      tabIndex={showEditor ? undefined : readerTabIndex}
      aria-label={`文档正文：${draft.title}`}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onScroll={onScroll}
      onMouseUp={showEditor ? undefined : annotations.handleReadingSelection}
      onPointerOver={previewPointer}
      onPointerMove={previewPointer}
      onPointerLeave={clearPreview}
      onPointerCancel={clearPreview}
      onScrollCapture={annotatingRead ? annotations.handleAnnotationScroll : undefined}
    >
      <div ref={content} className="studio-document-content" style={{ zoom: expanded ? zoom : 1 }}>
        {showEditor ? (
          <Suspense
            fallback={
              <div className="studio-document-message">
                <Loader2 size={16} className="studio-spin" />
                正在打开编辑器…
              </div>
            }
          >
            <DocumentEditor
              value={draft.document}
              editable={editable}
              theme={scheme}
              initialFocusBlockId={initialFocusBlockId}
              highlightedIds={editorTargetIds}
              find={find}
              onChange={draft.setDocument}
              onSelection={annotations.handleSelectionChange}
              onCompositionChange={onCompositionChange}
              uploadFile={uploadFile}
              resolveFileUrl={resolveFileUrl}
            />
          </Suspense>
        ) : (
          <DocumentReadView
            document={draft.document}
            client={client}
            scheme={scheme}
            highlightedIds={highlightedIds}
            find={find}
            annotating={annotatingRead}
            interactive={readingEnabled}
            renderCommentPins={renderCommentPins}
          />
        )}
      </div>
    </div>
  );
}
