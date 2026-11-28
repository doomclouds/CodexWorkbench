import { useEffect, useRef, useState } from 'react';
import type {
  BoardHistoryExportResult,
  ExportBoardFile,
  ExportBoardRejection,
  ExportBoardScope,
  ExportBoardVersionCommand,
} from '../../data/whiteboard/index.js';
import type { WhiteboardHistorySurfaceProps } from './contracts.js';

interface VersionExportOptions extends Pick<
  WhiteboardHistorySurfaceProps,
  'boardId' | 'service' | 'download'
> {
  readonly sourceRevision: bigint;
}

interface ExportNotice {
  readonly tone: 'error' | 'success' | 'warning';
  readonly message: string;
  readonly retry?: { readonly label: string; readonly onActivate: () => void };
}

const exportMessages: Readonly<Record<ExportBoardRejection, string>> = {
  invalidSelection: '选区在该历史版本中不可导出。',
  unsupported: '选定内容无法导出为此格式。',
  assetUnavailable: '导出所需素材已不可用。',
  tooLarge: '导出内容超过大小限制。',
};

function exportError(result: Exclude<BoardHistoryExportResult, { kind: 'file' }>): string {
  return result.kind === 'unavailable' ? '所选历史版本已无法导出。' : exportMessages[result.reason];
}

export function useVersionExport({
  boardId,
  sourceRevision,
  service,
  download,
}: VersionExportOptions) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ExportNotice>();
  const active = useRef<AbortController>(undefined);

  useEffect(() => () => active.current?.abort(), []);

  function handleExport(
    format: ExportBoardVersionCommand['format'],
    scope: ExportBoardScope,
    retainedFile?: ExportBoardFile,
  ) {
    if (active.current) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setPending(true);
    setNotice(undefined);
    let file = retainedFile;

    Promise.resolve()
      .then(async () => {
        signal.throwIfAborted();
        if (!file) {
          const result = await service.exportVersion(
            { boardId, revision: sourceRevision, format, scope },
            signal,
          );
          signal.throwIfAborted();
          if (result.kind !== 'file') {
            setNotice({ tone: 'error', message: exportError(result) });
            return;
          }

          file = result.file;
        }

        const delivery = await download(file, signal);
        signal.throwIfAborted();
        setNotice({
          tone: delivery?.kind === 'unavailable' ? 'warning' : 'success',
          message: delivery?.message ?? `已发起下载「${file.filename}」。`,
        });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          const message = error instanceof Error ? error.message : '所选版本未能导出。';
          setNotice({
            tone: 'error',
            message,
            retry: {
              label: file ? '重试下载' : '重试导出',
              onActivate: () => handleExport(format, scope, file),
            },
          });
        }
      })
      .finally(() => {
        if (active.current === controller && !signal.aborted) {
          active.current = undefined;
          setPending(false);
        }
      });
  }

  return { pending, notice, handleExport };
}
