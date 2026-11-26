import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchiveImportService } from '../../../data/archive-import/index.js';

interface ArchiveImportFeedback {
  readonly kind: 'error' | 'success';
  readonly message: string;
}

interface ArchiveImportOptions {
  readonly service?: ArchiveImportService;
  readonly createCommandId: () => string;
  readonly readRouteGeneration: () => number;
  readonly onOpenBoard: (boardId: string) => void;
}

const maxArchiveBytes = 128 * 1024 * 1024;
const failedConnection =
  /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)$/i;

function describeImportFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (failedConnection.test(message)) {
    return '无法连接作品服务，请重试或重新打开页面。';
  }

  return message || '作品备份未能导入。';
}

export function useArchiveImport({
  service,
  createCommandId,
  readRouteGeneration,
  onOpenBoard,
}: ArchiveImportOptions) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ArchiveImportFeedback>();
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const pendingImport = useRef<AbortController | undefined>(undefined);
  const dismissFeedback = useCallback(() => setFeedback(undefined), []);

  useEffect(
    () => () => {
      pendingImport.current?.abort();
      pendingImport.current = undefined;
    },
    [],
  );

  function reportFailure(error: unknown) {
    setFeedback({ kind: 'error', message: describeImportFailure(error) });
  }

  function releaseImport(request: AbortController) {
    if (pendingImport.current !== request) {
      return false;
    }

    pendingImport.current = undefined;
    setBusy(false);

    return true;
  }

  function onFile(file: File) {
    if (!service || pendingImport.current) {
      return;
    }

    if (file.size > maxArchiveBytes) {
      reportFailure(new Error('作品备份超过 128 MB。'));
      return;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      reportFailure(error);
      return;
    }

    const request = new AbortController();
    const startGeneration = readRouteGeneration();
    pendingImport.current = request;
    setBusy(true);
    setFeedback(undefined);

    Promise.resolve()
      .then(() => {
        request.signal.throwIfAborted();
        return service.importArchive({ file, commandId }, request.signal);
      })
      .then((receipt) => {
        if (pendingImport.current !== request) {
          return;
        }
        if (!receipt.boardId.trim()) {
          throw new Error('作品备份未能导入。');
        }

        setCatalogRefresh((current) => current + 1);
        const currentRoute = readRouteGeneration() === startGeneration;
        if (currentRoute) {
          onOpenBoard(receipt.boardId);
        }

        setFeedback({
          kind: 'success',
          message: currentRoute
            ? '作品已导入，原作品保持完整。'
            : '作品已导入，可从 Luming Studio 打开。',
        });
        releaseImport(request);
      })
      .catch((error: unknown) => {
        if (releaseImport(request)) {
          reportFailure(error);
        }
      });
  }

  return {
    feedback,
    dismissFeedback,
    workbench: service ? { busy, catalogRefresh, onFile } : undefined,
  };
}
