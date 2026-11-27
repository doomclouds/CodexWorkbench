import { Archive, Download, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type Ref } from 'react';
import type {
  ExportBoard,
  ExportBoardFile,
  ExportBoardFormat,
  ExportBoardRejection,
  ExportBoardResult,
} from '../../data/whiteboard/index.js';
import {
  AnchoredPopover,
  Button,
  Select,
  StatusText,
  type StatusTextTone,
} from '../../ui/base/index.js';
import './whiteboard-export.css';

export interface WhiteboardExportContext {
  readonly boardId: string;
  readonly title: string;
  readonly revision: bigint;
  readonly selectedIds: readonly string[];
}

export interface WhiteboardExportSurfaceProps {
  readonly anchor: Element | null;
  readonly context: WhiteboardExportContext;
  readonly exportBoard: ExportBoard;
  readonly download: (file: ExportBoardFile) => void;
  readonly onRequestClose: () => void;
  readonly restoreFocus?: () => void;
  readonly inline?: boolean;
  readonly canBackup?: boolean;
}

interface ExportNotice {
  readonly message: string;
  readonly tone: StatusTextTone;
}

interface ExportOption {
  readonly format: ExportBoardFormat;
  readonly label: string;
  readonly description?: string;
}

const formats: readonly ExportOption[] = [
  { format: 'png', label: 'PNG 图片' },
  { format: 'svg', label: 'SVG 图片' },
  {
    format: 'html',
    label: '整板网页（HTML）',
    description: '导出整块白板的已保存内容，不含协作评论和历史。网页中的交互状态仅保存在本页内存。',
  },
  { format: 'json', label: '白板文件 (.json)' },
];
const backup = {
  format: 'zip',
  label: '完整作品备份',
  description: '包含历史记录与资源',
} as const;

const rejectionMessages: Record<ExportBoardRejection, string> = {
  invalidSelection: '部分选中对象已发生变化。请重新选择导出范围。',
  unsupported: '该范围包含当前格式无法导出的内容。',
  assetUnavailable: '导出所需的素材已不可用。',
  tooLarge: '该范围超出文件大小上限。请选择较小的范围。',
};

function resultNotice(result: ExportBoardResult): ExportNotice {
  switch (result.kind) {
    case 'file':
      return { tone: 'success', message: '导出已生成。' };
    case 'stale':
      return {
        tone: 'warning',
        message: `当前保存版次已变为 ${result.revision}。请重新打开白板后重试。`,
      };
    case 'rejected':
      return { tone: 'error', message: rejectionMessages[result.reason] };
  }
}

function supportsSelection(format: ExportBoardFormat): boolean {
  return format !== 'html' && format !== 'zip';
}

interface ExportFormatButtonProps {
  readonly option: ExportOption;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly disabled: boolean;
  readonly onExport: (format: ExportBoardFormat) => void;
}

function ExportFormatButton({ option, buttonRef, disabled, onExport }: ExportFormatButtonProps) {
  const { format, label, description } = option;
  const isBackup = format === 'zip';
  const Icon = isBackup ? Archive : Download;

  return (
    <button
      type="button"
      ref={buttonRef}
      className="whiteboard-export__format"
      data-export-format={format}
      aria-label={label}
      disabled={disabled}
      onClick={() => onExport(format)}
    >
      <Icon size={18} aria-hidden="true" />
      <span>
        {isBackup ? <strong>{label}</strong> : label}
        {description && <small className="whiteboard-export__description">{description}</small>}
      </span>
      <small>{format.toUpperCase()}</small>
    </button>
  );
}

function OpenExport({
  anchor,
  context,
  exportBoard,
  download,
  onRequestClose,
  restoreFocus,
  inline = false,
  canBackup = false,
}: WhiteboardExportSurfaceProps) {
  const [scope, setScope] = useState<'whole' | 'selection'>('whole');
  const [pendingFormat, setPendingFormat] = useState<ExportBoardFormat>();
  const [notice, setNotice] = useState<ExportNotice>();
  const pending = useRef<AbortController>(undefined);
  const firstFormat = useRef<HTMLButtonElement>(null);
  const selectionCount = context.selectedIds.length;
  const selectionUnavailable = scope === 'selection' && selectionCount === 0;

  useLayoutEffect(() => () => pending.current?.abort(), []);

  function handleClose() {
    pending.current?.abort();
    pending.current = undefined;
    setPendingFormat(undefined);
    onRequestClose();
  }

  function handleExport(format: ExportBoardFormat) {
    if (pending.current || (selectionUnavailable && supportsSelection(format))) {
      return;
    }

    const { boardId, revision, selectedIds } = context;
    const selectedScope =
      scope === 'selection' && supportsSelection(format)
        ? { kind: 'selection' as const, objectIds: [...selectedIds] }
        : { kind: 'whole' as const };
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setPendingFormat(format);
    setNotice(undefined);

    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return exportBoard(
          { boardId, expectedRevision: revision, scope: selectedScope, format },
          signal,
        );
      })
      .then((result) => {
        signal.throwIfAborted();
        if (result.kind === 'file') {
          download(result.file);
        }

        setNotice(resultNotice(result));
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setNotice({
            tone: 'error',
            message: error instanceof Error ? error.message : '导出未能完成。',
          });
        }
      })
      .finally(() => {
        if (pending.current === controller && !signal.aborted) {
          pending.current = undefined;
          setPendingFormat(undefined);
        }
      });
  }

  function renderFormat(option: ExportOption) {
    const { format } = option;

    return (
      <ExportFormatButton
        key={format}
        option={option}
        buttonRef={format === 'png' ? firstFormat : undefined}
        disabled={
          pendingFormat !== undefined || (selectionUnavailable && supportsSelection(format))
        }
        onExport={handleExport}
      />
    );
  }

  const content = (
    <section className="whiteboard-export" aria-busy={pendingFormat !== undefined}>
      {!inline && (
        <header className="whiteboard-export__header">
          <h2 className="whiteboard-export__title">导出白板</h2>
          <Button
            label="关闭导出"
            icon={<X size={16} />}
            iconOnly
            variant="ghost"
            onActivate={handleClose}
          />
        </header>
      )}
      <p className="whiteboard-export__revision">
        {context.title} · 保存版次 {context.revision.toString()}
      </p>
      <Select
        label="导出范围"
        value={scope}
        disabled={pendingFormat !== undefined}
        options={[
          { id: 'whole', label: '整板' },
          {
            id: 'selection',
            label: `当前选区（${selectionCount} 项）`,
            disabled: selectionCount === 0,
          },
        ]}
        onValueChange={(value) => setScope(value === 'selection' ? 'selection' : 'whole')}
      />
      <div className="whiteboard-export__formats">
        <p className="whiteboard-export__revision">选择导出格式</p>
        {formats.map(renderFormat)}
      </div>
      {canBackup && renderFormat(backup)}
      {pendingFormat && <StatusText message="正在导出…" announcement="polite" busy />}
      {notice && <StatusText message={notice.message} tone={notice.tone} announcement="polite" />}
    </section>
  );

  if (inline) {
    return content;
  }

  return (
    <AnchoredPopover
      open
      anchor={anchor}
      label="导出白板"
      placement="bottom"
      initialFocus={() => firstFormat.current?.focus({ preventScroll: true })}
      restoreFocus={restoreFocus}
      onRequestClose={handleClose}
    >
      {content}
    </AnchoredPopover>
  );
}

export function WhiteboardExportSurface(props: WhiteboardExportSurfaceProps) {
  const { anchor, context, inline } = props;

  return anchor || inline ? <OpenExport key={context.boardId} {...props} /> : null;
}
