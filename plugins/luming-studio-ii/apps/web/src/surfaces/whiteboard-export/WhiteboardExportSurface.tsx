import { Archive, Download, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type Ref } from 'react';
import type {
  ExportBoard,
  ExportBoardFile,
  ExportBoardFormat,
  ExportBoardRejection,
  ExportBoardRequest,
  ExportBoardResult,
  RequestBoardDownload,
} from '../../data/whiteboard/index.js';
import {
  AnchoredPopover,
  Button,
  Dialog,
  Select,
  StatusText,
  type ButtonHandle,
  type StatusTextTone,
} from '../../ui/base/index.js';
import './whiteboard-export.css';

export interface WhiteboardExportContext {
  readonly boardId: string;
  readonly title: string;
  readonly revision: bigint;
  readonly selectedIds: readonly string[];
  readonly selectedHtmlId?: string;
}

export interface WhiteboardExportSurfaceProps {
  readonly anchor: Element | null;
  readonly context: WhiteboardExportContext;
  readonly exportBoard: ExportBoard;
  readonly download: RequestBoardDownload;
  readonly onRequestClose: () => void;
  readonly restoreFocus?: () => void;
  readonly inline?: boolean;
  readonly canBackup?: boolean;
}

interface ExportNotice {
  readonly message: string;
  readonly tone: StatusTextTone;
  readonly retry?: { readonly label: string; readonly onActivate: () => void };
}

interface ExportOption {
  readonly format: ExportBoardFormat;
  readonly label: string;
  readonly description?: string;
}

interface ExportSelection {
  readonly option: ExportOption;
  readonly request: ExportBoardRequest;
  readonly trigger: HTMLButtonElement;
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
  description: '包含历史记录、备注与资源',
} as const;
const htmlSelection = {
  format: 'html',
  label: '选区网页（HTML）',
  description: '导出选中对象的已保存内容，不含协作评论和历史。',
} as const;
const htmlSource = { format: 'html-source', label: 'HTML 源码' } as const;

const rejectionMessages: Record<ExportBoardRejection, string> = {
  invalidSelection: '部分选中对象已发生变化。请重新选择导出范围。',
  unsupported: '该范围包含当前格式无法导出的内容。',
  assetUnavailable: '导出所需的素材已不可用。',
  tooLarge: '该范围超出文件大小上限。请选择较小的范围。',
};

function resultNotice(result: Exclude<ExportBoardResult, { kind: 'file' }>): ExportNotice {
  switch (result.kind) {
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
  return format !== 'zip';
}

interface ExportFormatButtonProps {
  readonly option: ExportOption;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly disabled: boolean;
  readonly onExport: (option: ExportOption, trigger: HTMLButtonElement) => void;
}

function ExportFormatButton({ option, buttonRef, disabled, onExport }: ExportFormatButtonProps) {
  const { format, label, description } = option;
  const isBackup = format === 'zip';
  const Icon = isBackup ? Archive : Download;
  const extension = format === 'html-source' ? 'HTML' : format.toUpperCase();

  return (
    <button
      type="button"
      ref={buttonRef}
      className="whiteboard-export__format"
      data-export-format={format}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => onExport(option, event.currentTarget)}
    >
      <Icon size={18} aria-hidden="true" />
      <span>
        {isBackup ? <strong>{label}</strong> : label}
        {description && <small className="whiteboard-export__description">{description}</small>}
      </span>
      <small>{extension}</small>
    </button>
  );
}

function ExportProgress({
  busy,
  message,
  notice,
}: {
  readonly busy: boolean;
  readonly message: string;
  readonly notice: ExportNotice | undefined;
}) {
  return (
    <>
      {busy && <StatusText message={message} announcement="polite" busy />}
      {notice && <StatusText message={notice.message} tone={notice.tone} announcement="polite" />}
    </>
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
  const [selection, setSelection] = useState<ExportSelection>();
  const [file, setFile] = useState<ExportBoardFile>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ExportNotice>();
  const pending = useRef<AbortController>(undefined);
  const firstFormat = useRef<HTMLButtonElement>(null);
  const cancel = useRef<ButtonHandle>(null);
  const hostConfirms = download.confirmation === 'host';
  const selectionCount = context.selectedIds.length;
  const selectionUnavailable = scope === 'selection' && selectionCount === 0;
  const exportHtmlSource =
    scope === 'selection' &&
    selectionCount === 1 &&
    context.selectedHtmlId === context.selectedIds[0];

  useLayoutEffect(() => () => pending.current?.abort(), []);

  function handleCloseDownload() {
    pending.current?.abort();
    pending.current = undefined;
    setBusy(false);
    setSelection(undefined);
    setFile(undefined);
    setNotice(undefined);
  }

  function handleClose() {
    handleCloseDownload();
    onRequestClose();
  }

  function runExport(request: ExportBoardRequest, preparedFile?: ExportBoardFile) {
    if (pending.current) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(true);
    setNotice(undefined);
    cancel.current?.focus();
    let ready = preparedFile;

    async function completeExport() {
      if (!ready) {
        const result = await exportBoard(request, signal);
        signal.throwIfAborted();
        if (result.kind !== 'file') {
          setNotice(resultNotice(result));
          return;
        }

        ready = result.file;
        if (!hostConfirms) {
          setFile(ready);
          return;
        }
      }

      const delivery = await download(ready, signal);
      signal.throwIfAborted();
      if (delivery?.kind === 'unavailable') {
        setNotice({ tone: 'warning', message: delivery.message });
      } else {
        setSelection(undefined);
        setFile(undefined);
      }
    }

    completeExport()
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setNotice({
            tone: 'error',
            message: error instanceof Error ? error.message : '导出未能完成。',
            retry: {
              label: ready ? '重试下载' : '重试导出',
              onActivate: () => runExport(request, ready),
            },
          });
        }
      })
      .finally(() => {
        if (pending.current === controller && !signal.aborted) {
          pending.current = undefined;
          setBusy(false);
        }
      });
  }

  function handleExport(option: ExportOption, trigger: HTMLButtonElement) {
    const { format } = option;
    const unavailable = selectionUnavailable && supportsSelection(format);
    if (selection || pending.current || unavailable) {
      return;
    }
    if (format === 'html-source' && !exportHtmlSource) {
      return;
    }

    const { boardId, revision, selectedIds } = context;
    const request: ExportBoardRequest = {
      boardId,
      expectedRevision: revision,
      format,
      scope:
        scope === 'selection' && supportsSelection(format)
          ? { kind: 'selection', objectIds: [...selectedIds] }
          : { kind: 'whole' },
    };

    if (!hostConfirms) {
      setSelection({ option, request, trigger });
    }

    runExport(request);
  }

  function handleDownload() {
    if (selection && file) {
      runExport(selection.request, file);
    }
  }

  function handleRestoreDownloadFocus() {
    const target = selection?.trigger.isConnected ? selection.trigger : firstFormat.current;
    target?.focus({ preventScroll: true });
  }

  function renderFormat(option: ExportOption) {
    const { format } = option;

    return (
      <ExportFormatButton
        key={format}
        option={option}
        buttonRef={format === 'png' ? firstFormat : undefined}
        disabled={selectionUnavailable && supportsSelection(format)}
        onExport={handleExport}
      />
    );
  }

  const webProgress = file ? '正在打开下载…' : '正在生成导出文件…';
  const status = (
    <ExportProgress
      busy={busy}
      message={hostConfirms ? '正在导出…' : webProgress}
      notice={notice}
    />
  );
  const retry = notice?.retry && (
    <Button label={notice.retry.label} variant="primary" onActivate={notice.retry.onActivate} />
  );
  const content = (
    <section className="whiteboard-export">
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
        {formats.map((option) =>
          renderFormat(option.format === 'html' && scope === 'selection' ? htmlSelection : option),
        )}
        {exportHtmlSource && renderFormat(htmlSource)}
      </div>
      {canBackup && renderFormat(backup)}
      {hostConfirms && (
        <>
          {status}
          {retry}
        </>
      )}
      {selection && (
        <Dialog
          open
          title="下载导出文件"
          description={selection.option.label}
          closeLabel="关闭下载窗口"
          initialFocus={() => cancel.current?.focus()}
          restoreFocus={handleRestoreDownloadFocus}
          onRequestClose={handleCloseDownload}
        >
          {file && <p className="whiteboard-export__filename">{file.filename}</p>}
          {status}
          <div className="whiteboard-export__actions">
            <Button ref={cancel} label="取消" onActivate={handleCloseDownload} />
            {retry || (
              <Button
                label="下载"
                variant="primary"
                disabled={!file || busy || notice !== undefined}
                onActivate={handleDownload}
              />
            )}
          </div>
        </Dialog>
      )}
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
