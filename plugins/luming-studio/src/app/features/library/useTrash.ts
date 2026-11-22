import { useRef, useState } from 'react';
import { STUDIO_TOOLS, type Artifact } from '../../../contracts/studio';
import type {
  LibraryFilter,
  LibraryListResult,
  LibraryOptions,
  PurgeConfirmation,
} from './library-contract';

interface PurgeFailure {
  artifactId: string;
  code: string;
  message: string;
}

interface PurgeResult {
  deletedIds: string[];
  failures: PurgeFailure[];
}

interface TrashOptions extends LibraryOptions {
  artifacts: Artifact[];
  filter: LibraryFilter;
  query: string;
  loadLibrary: () => Promise<void>;
  removeArtifacts: (ids: ReadonlySet<string>) => void;
  forgetPreviews: (ids: readonly string[]) => void;
}

function useTrashSelection(
  activeId: string,
  filter: LibraryFilter,
  query: string,
  artifacts: Artifact[],
) {
  const [trashSelection, setTrashSelection] = useState<string[]>([]);
  const [purgeConfirmation, setPurgeConfirmation] = useState<PurgeConfirmation | null>(null);
  const [purgeFailures, setPurgeFailures] = useState<(PurgeFailure & { title: string })[]>([]);
  const [purgeError, setPurgeError] = useState('');
  const [trashInputs, setTrashInputs] = useState({
    activeId,
    filter,
    query,
    artifacts,
    purgeFailures,
  });

  if (
    trashInputs.activeId !== activeId ||
    trashInputs.filter !== filter ||
    trashInputs.query !== query
  ) {
    const failures: typeof purgeFailures = [];
    setTrashInputs({ activeId, filter, query, artifacts, purgeFailures: failures });
    setTrashSelection([]);
    setPurgeFailures(failures);
    setPurgeError('');
    setPurgeConfirmation(null);
  } else if (trashInputs.artifacts !== artifacts || trashInputs.purgeFailures !== purgeFailures) {
    setTrashInputs({ activeId, filter, query, artifacts, purgeFailures });
    const retained = new Set([
      ...artifacts.filter((item) => item.trashedAt).map((item) => item.id),
      ...purgeFailures.map((item) => item.artifactId),
    ]);
    const selection = trashSelection.filter((id) => retained.has(id));
    if (selection.length !== trashSelection.length) {
      setTrashSelection(selection);
    }
  }

  function selectTrashItems(ids: readonly string[], selected: boolean) {
    if (selected) {
      setTrashSelection((previous) => [...new Set([...previous, ...ids])]);
      return;
    }

    const removed = new Set(ids);
    setTrashSelection((previous) => previous.filter((id) => !removed.has(id)));
  }

  return {
    trashSelection,
    setTrashSelection,
    selectTrashItems,
    purgeConfirmation,
    setPurgeConfirmation,
    purgeFailures,
    setPurgeFailures,
    purgeError,
    setPurgeError,
  };
}

export function useTrash({
  activeId,
  filter,
  query,
  artifacts,
  busy,
  canManage,
  client,
  isMounted,
  setBusy,
  reportError,
  describeError,
  inform,
  loadLibrary,
  removeArtifacts,
  forgetPreviews,
}: TrashOptions) {
  const {
    trashSelection,
    selectTrashItems,
    setTrashSelection,
    purgeConfirmation,
    setPurgeConfirmation,
    purgeFailures,
    setPurgeFailures,
    purgeError,
    setPurgeError,
  } = useTrashSelection(activeId, filter, query, artifacts);
  const purgeRunning = useRef(false);

  function confirmPurge(ids: readonly string[]) {
    if (busy || !canManage) {
      return;
    }

    const unique = [...new Set(ids)];
    if (!unique.length) {
      return;
    }

    setPurgeError('');
    setPurgeConfirmation({
      targets: unique.map((id) => ({
        id,
        title:
          artifacts.find((item) => item.id === id)?.title ||
          purgeFailures.find((item) => item.artifactId === id)?.title ||
          id,
      })),
      all: false,
    });
  }

  async function prepareEmptyTrash() {
    if (busy || !canManage) {
      return;
    }

    setBusy('prepare-purge');
    setPurgeError('');
    try {
      const targets = new Map<string, { id: string; title: string }>();
      let cursor: string | undefined;
      do {
        const result = await client.call<LibraryListResult>(STUDIO_TOOLS.list, {
          trashed: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        result.artifacts.forEach((item) =>
          targets.set(item.id, { id: item.id, title: item.title }),
        );
        cursor = result.nextCursor;
      } while (cursor);

      if (isMounted()) {
        if (targets.size) {
          setPurgeConfirmation({ targets: [...targets.values()], all: true });
        } else {
          inform('回收站已经为空。');
        }
      }
    } catch (cause) {
      if (isMounted()) {
        setPurgeError(describeError(cause));
      }
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  async function purgeArtifacts() {
    const confirmation = purgeConfirmation;
    const purgeInProgress = busy || purgeRunning.current;
    if (!confirmation || purgeInProgress || !canManage) {
      return;
    }

    purgeRunning.current = true;
    setBusy('purge');
    setPurgeError('');
    const deleted = new Set<string>();
    const failures: PurgeFailure[] = [];
    try {
      for (let offset = 0; offset < confirmation.targets.length; offset += 100) {
        const ids = confirmation.targets.slice(offset, offset + 100).map((item) => item.id);
        try {
          const result = await client.call<PurgeResult>(STUDIO_TOOLS.manage, {
            action: 'purge',
            ...(ids.length === 1 ? { artifactId: ids[0] } : { artifactIds: ids }),
          });
          result.deletedIds.forEach((id) => deleted.add(id));
          failures.push(...result.failures);
        } catch (cause) {
          failures.push(
            ...ids.map((artifactId) => ({
              artifactId,
              code: 'REQUEST_FAILED',
              message: describeError(cause),
            })),
          );
        }
      }

      if (!isMounted()) {
        return;
      }

      setPurgeFailures(
        failures.map((item) => ({
          ...item,
          title:
            confirmation.targets.find((target) => target.id === item.artifactId)?.title ||
            item.artifactId,
        })),
      );
      setTrashSelection((previous) => [
        ...new Set([
          ...previous.filter((id) => !deleted.has(id)),
          ...failures.map((item) => item.artifactId),
        ]),
      ]);
      removeArtifacts(deleted);
      forgetPreviews([...deleted]);
      setPurgeConfirmation(null);
      if (deleted.size) {
        inform(`已永久删除 ${deleted.size} 项作品。`);
      }

      await loadLibrary();
    } finally {
      purgeRunning.current = false;
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  function cancelPurge() {
    if (!purgeRunning.current) {
      setPurgeConfirmation(null);
    }
  }

  const purgeDialog = purgeConfirmation && {
    busy: Boolean(busy),
    deleting: busy === 'purge',
    confirmation: purgeConfirmation,
    onCancel: cancelPurge,
    onConfirm: () => void purgeArtifacts().catch(reportError),
  };

  return {
    data: { trashSelection, purgeFailures, purgeError },
    actions: {
      confirmPurge,
      prepareEmptyTrash: () => void prepareEmptyTrash().catch(reportError),
      clearTrashSelection: () => setTrashSelection([]),
    },
    purgeDialog,
    selectTrashItems,
  };
}
