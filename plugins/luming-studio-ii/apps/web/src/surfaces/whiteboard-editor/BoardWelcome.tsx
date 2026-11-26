import { ArrowUpRight, Braces, Circle, FileText, Square } from 'lucide-react';

interface BoardWelcomeProps {
  readonly canEdit: boolean;
  readonly disabled: boolean;
  readonly onAddDocument: () => void;
  readonly onAddHtml: () => void;
}

export function BoardWelcome({ canEdit, disabled, onAddDocument, onAddHtml }: BoardWelcomeProps) {
  return (
    <div className="whiteboard-editor__empty">
      <div className="whiteboard-editor__empty-symbol" aria-hidden="true">
        <Square size={27} />
        <Circle size={25} />
        <ArrowUpRight size={24} />
      </div>
      <strong>从一个想法开始</strong>
      <p>
        {canEdit ? '添加文档、文字、便签或图形，也可以导入 HTML 图解。' : '这块白板还没有内容。'}
      </p>
      {canEdit && (
        <>
          <button type="button" onClick={onAddDocument} disabled={disabled}>
            <FileText size={16} /> 添加文档
          </button>
          <button type="button" onClick={onAddHtml} disabled={disabled}>
            <Braces size={16} /> 添加 HTML 图解
          </button>
        </>
      )}
    </div>
  );
}
