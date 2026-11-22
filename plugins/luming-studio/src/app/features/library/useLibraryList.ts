import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STUDIO_TOOLS, type Artifact } from '../../../contracts/studio';
import type { LibraryFilter, LibraryListResult, LibraryOptions } from './library-contract';

function appendPage(previous: Artifact[], incoming: Artifact[]) {
  const loaded = new Set(previous.map((artifact) => artifact.id));

  return [...previous, ...incoming.filter((artifact) => !loaded.has(artifact.id))];
}

export function useLibraryList({
  client,
  activeId,
  initialView,
  canManage,
  scope,
  reportError,
}: LibraryOptions) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>(initialView === 'trash' ? 'trash' : 'recent');
  const [query, setQuery] = useState('');
  const listSequence = useRef(0);

  const loadLibrary = useCallback(
    async function loadPage(cursor?: string) {
      const scopeAtStart = scope.capture();
      const serial = ++listSequence.current;
      const canUpdateList = () => serial === listSequence.current && scope.isCurrent(scopeAtStart);
      setLibraryLoading(true);
      try {
        const result = await client.call<LibraryListResult>(STUDIO_TOOLS.list, {
          query: query.trim(),
          trashed: filter === 'trash',
          pinned: filter === 'pinned' ? true : undefined,
          limit: 60,
          cursor,
        });

        if (!canUpdateList()) {
          return;
        }

        setArtifacts((previous) =>
          cursor ? appendPage(previous, result.artifacts) : result.artifacts,
        );
        setNextCursor(result.nextCursor);
        setLibraryLoaded(true);
      } catch (cause) {
        if (canUpdateList()) {
          reportError(cause, () => {
            void loadPage(cursor).catch(reportError);
          });
        }
      } finally {
        if (canUpdateList()) {
          setLibraryLoading(false);
        }
      }
    },
    [client, filter, query, reportError, scope],
  );

  useEffect(() => {
    if (activeId || !canManage) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        void loadLibrary().catch(reportError);
      },
      query ? 180 : 0,
    );

    return () => {
      window.clearTimeout(timer);
      listSequence.current += 1;
    };
  }, [activeId, canManage, loadLibrary, query, reportError]);

  const visibleArtifacts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return artifacts
      .filter(
        (item) =>
          (!search || item.title.toLowerCase().includes(search)) &&
          (filter !== 'pinned' || item.pinned),
      )
      .sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [artifacts, filter, query]);

  function loadNextPage() {
    if (nextCursor) {
      void loadLibrary(nextCursor).catch(reportError);
    }
  }

  function removeArtifacts(ids: ReadonlySet<string>) {
    setArtifacts((previous) => previous.filter((item) => !ids.has(item.id)));
  }

  return {
    artifacts,
    filter,
    query,
    libraryLoaded,
    libraryLoading,
    hasNextPage: Boolean(nextCursor),
    loadLibrary,
    loadNextPage,
    removeArtifacts,
    setFilter,
    setQuery,
    visibleArtifacts,
  };
}
