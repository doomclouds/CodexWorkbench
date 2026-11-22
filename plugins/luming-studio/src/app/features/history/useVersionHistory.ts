import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STUDIO_TOOLS,
  type HistoryBatch,
  type HistoryEntry,
  type StudioClient,
} from '../../../contracts/studio';
import type { StudioDocument } from '../../product-contract';
import { newClientId } from '../../shared/client-id';
import type { StudioViewRequests } from '../../shared/studio-view-scope';

interface HistoryOptions {
  client: StudioClient;
  scope: StudioViewRequests;
  open: boolean;
  revision?: number;
  canEdit: boolean;
  operationBusy: string;
  setOperationBusy: (busy: string) => void;
  clearError: () => void;
  reportError: (cause: unknown, retry?: () => void) => void;
  inform: (message: string) => void;
  stopFollowing: () => void;
  getDocument: () => StudioDocument | null;
  acceptDocument: (document: StudioDocument) => void;
  refreshBoard: (artifactId: string) => Promise<void>;
}

export type VersionHistoryView = ReturnType<typeof useVersionHistory>['view'];

export function useVersionHistory({
  client,
  scope,
  open,
  revision,
  canEdit,
  operationBusy,
  setOperationBusy,
  clearError,
  reportError,
  inform,
  stopFollowing,
  getDocument,
  acceptDocument,
  refreshBoard,
}: HistoryOptions) {
  const [batches, setBatches] = useState<HistoryBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ board: StudioDocument; version: HistoryEntry } | null>(
    null,
  );
  const [previewBusy, setPreviewBusy] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const listSequence = useRef(0);
  const previewSequence = useRef(0);
  const busy = operationBusy || previewBusy;

  const loadHistory = useCallback(
    async function load() {
      const route = scope.capture();
      if (!route.artifactId || !scope.isCurrent(route)) {
        return;
      }

      const serial = ++listSequence.current;
      const isCurrent = () => serial === listSequence.current && scope.isCurrent(route);
      setLoading(true);
      try {
        const { batches } = await client.call(STUDIO_TOOLS.read, {
          artifactId: route.artifactId,
          mode: 'history',
        });

        if (isCurrent()) {
          setBatches([...batches].sort((a, b) => b.revision - a.revision));
        }
      } catch (cause) {
        if (isCurrent()) {
          reportError(cause, () => {
            if (scope.isCurrent(route)) {
              void load().catch(reportError);
            }
          });
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [client, scope, reportError],
  );

  useEffect(() => {
    if (open) {
      void loadHistory().catch(reportError);
    }
  }, [open, revision, loadHistory, reportError]);

  function closePreview() {
    previewSequence.current += 1;
    setPreviewBusy('');
    setRestoreOpen(false);
    setPreview(null);
  }

  function reset() {
    listSequence.current += 1;
    setBatches([]);
    setLoading(false);
    closePreview();
  }

  async function previewVersion(version: HistoryEntry) {
    const route = scope.capture();
    if (!route.artifactId || !scope.isCurrent(route)) {
      return;
    }

    const serial = ++previewSequence.current;
    const isCurrent = () => serial === previewSequence.current && scope.isCurrent(route);
    setRestoreOpen(false);
    setPreviewBusy(`version:${version.id}`);
    clearError();
    try {
      const result = await client.call(STUDIO_TOOLS.read, {
        artifactId: route.artifactId,
        mode: 'version',
        versionId: version.id,
      });

      if (isCurrent()) {
        stopFollowing();
        setPreview({ board: result.board, version });
      }
    } catch (cause) {
      if (isCurrent()) {
        reportError(cause);
      }
    } finally {
      if (isCurrent()) {
        setPreviewBusy('');
      }
    }
  }

  async function loadChanges(entry: HistoryBatch) {
    const route = scope.capture();
    if (!route.artifactId || !scope.isCurrent(route)) {
      return [];
    }

    const result = await client.call(STUDIO_TOOLS.read, {
      artifactId: route.artifactId,
      mode: 'diff',
      ...(entry.beforeVersionId
        ? { fromVersionId: entry.beforeVersionId, toVersionId: entry.id }
        : { versionId: entry.id, adjacent: true as const }),
    });

    return scope.isCurrent(route) ? result.units : [];
  }

  async function restoreVersion(version = preview?.version, unitId?: string): Promise<boolean> {
    if (!version || busy || !canEdit) {
      return false;
    }

    const route = scope.capture();
    if (!route.artifactId || !scope.isCurrent(route)) {
      return false;
    }

    const current = getDocument();
    if (current?.artifact.id !== route.artifactId) {
      return false;
    }

    setOperationBusy('restore-version');
    clearError();
    try {
      const result = await client.call<{ board: StudioDocument }>(STUDIO_TOOLS.apply, {
        artifactId: route.artifactId,
        operationId: newClientId('op'),
        expectedRevision: current.artifact.revision,
        operations: [{ op: 'restore', versionId: version.id, ...(unitId ? { id: unitId } : {}) }],
      });

      if (!scope.isCurrent(route)) {
        return true;
      }

      acceptDocument(result.board);
      setPreview(null);
      setRestoreOpen(false);
      await refreshBoard(route.artifactId);
      if (!scope.isCurrent(route)) {
        return true;
      }

      await loadHistory();
      if (scope.isCurrent(route)) {
        inform(
          unitId
            ? '已恢复这一处，并保留其他内容和历史记录。'
            : '已恢复此版本，并保留后续历史记录。',
        );
      }

      return true;
    } catch (cause) {
      if (scope.isCurrent(route)) {
        reportError(cause);
      }

      return false;
    } finally {
      setOperationBusy('');
    }
  }

  return {
    view: {
      batches,
      loading,
      preview,
      restoreOpen,
      loadChanges,
      closePreview,
      refresh: () => void loadHistory().catch(reportError),
      previewVersion: (version: HistoryEntry) => void previewVersion(version).catch(reportError),
      restoreVersion,
      requestRestore: () => setRestoreOpen(true),
      cancelRestore: () => {
        if (!busy) {
          setRestoreOpen(false);
        }
      },
      confirmRestore: () => void restoreVersion().catch(reportError),
    },
    previewBusy,
    reset,
  };
}
