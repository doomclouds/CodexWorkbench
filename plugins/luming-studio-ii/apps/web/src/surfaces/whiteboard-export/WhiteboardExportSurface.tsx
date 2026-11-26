import { Download, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
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
}

interface ExportNotice {
  readonly message: string;
  readonly tone: StatusTextTone;
}

const formats = [
  { format: 'json', label: '白板文件' },
  { format: 'svg', label: 'SVG 图片' },
] as const;

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

type OpenExportProps = WhiteboardExportSurfaceProps & { readonly anchor: Element };

function OpenExport({
  anchor,
  context,
  exportBoard,
  download,
  onRequestClose,
  restoreFocus,
}: OpenExportProps) {
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

  function startExport(format: ExportBoardFormat) {
    if (pending.current || selectionUnavailable) {
      return;
    }

    const { boardId, revision, selectedIds } = context;
    const selectedScope =
      scope === 'selection'
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
      <section className="whiteboard-export" aria-busy={pendingFormat !== undefined}>
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
          {formats.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              ref={format === 'json' ? firstFormat : undefined}
              className="whiteboard-export__format"
              disabled={pendingFormat !== undefined || selectionUnavailable}
              onClick={() => startExport(format)}
            >
              <Download size={18} aria-hidden="true" />
              <span>{label}</span>
              <small>{format.toUpperCase()}</small>
            </button>
          ))}
        </div>
        {pendingFormat && <StatusText message="正在导出…" announcement="polite" busy />}
        {notice && <StatusText message={notice.message} tone={notice.tone} announcement="polite" />}
      </section>
    </AnchoredPopover>
  );
}

export function WhiteboardExportSurface(props: WhiteboardExportSurfaceProps) {
  const { anchor, context } = props;

  return anchor ? <OpenExport key={context.boardId} {...props} anchor={anchor} /> : null;
}
