import { STUDIO_HOME_TITLE } from '../../../contracts/branding.js';
import { useEffect, useState } from 'react';
import { STUDIO_TOOLS, type Artifact } from '../../../contracts/studio';
import { useLibraryPreviews } from '../../library-preview';
import type { StudioDocument } from '../../product-contract';
import type { StudioViewScope } from '../../shared/studio-view-scope';
import type { LibraryArtifactAction, LibraryFilter, LibraryOptions } from './library-contract';
import { useLibraryList } from './useLibraryList';
import { useTrash } from './useTrash';

interface ManageResult {
  artifact: Artifact;
  board?: StudioDocument;
}

interface ArtifactRename {
  artifact: Artifact;
  title: string;
}

export type LibraryData = ReturnType<typeof useLibrary>['data'];
export type LibraryActions = ReturnType<typeof useLibrary>['actions'];

export function useLibrary(options: LibraryOptions) {
  const {
    busy,
    canManage,
    client,
    previewClient,
    ownerId,
    setBusy,
    clearError,
    reportError,
    inform,
    scope,
    isMounted,
    getDocument,
    acceptDocument,
    resolveProduct,
    openArtifact,
    goHome,
    navigateHome,
    copyArtifactLink,
  } = options;
  const list = useLibraryList(options);
  const { previews, rememberPreview, forgetPreviews } = useLibraryPreviews(previewClient, ownerId);
  const trash = useTrash({
    ...options,
    artifacts: list.artifacts,
    filter: list.filter,
    query: list.query,
    loadLibrary: list.loadLibrary,
    removeArtifacts: list.removeArtifacts,
    forgetPreviews,
  });
  const [menuId, setMenuId] = useState('');
  const [rename, setRename] = useState<ArtifactRename | null>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        !(event.target as Element | null)?.closest(
          '.studio-menu-anchor, .studio-library-floating-menu',
        )
      ) {
        setMenuId('');
      }
    };

    document.addEventListener('pointerdown', close);

    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, []);

  function closeMenu() {
    setMenuId('');
  }

  function changeArtifactMenu(id: string, open: boolean) {
    setMenuId(open ? id : '');
  }

  function canOpenArtifact(id: string) {
    return !list.artifacts.some((item) => item.id === id && item.storageStatus === 'unsupported');
  }

  function changeFilter(value: LibraryFilter) {
    list.setFilter(value);
    closeMenu();
    navigateHome(value === 'trash' ? 'trash' : 'library');
  }

  function showRecent() {
    changeFilter('recent');
    list.setQuery('');
  }

  async function createBoard(productId?: string) {
    const product = resolveProduct(productId);
    if (!product || busy) {
      return;
    }

    const route = scope.capture();
    setBusy('create');
    clearError();
    try {
      const result = await client.call<ManageResult>(STUDIO_TOOLS.manage, {
        action: 'create',
        type: product.id,
        title: product.defaultTitle,
      });

      if (!isMounted()) {
        return;
      }

      if (scope.isCurrent(route)) {
        openArtifact(result.artifact.id, result.board);
      } else {
        inform(`作品已创建，可从 ${STUDIO_HOME_TITLE} 打开。`);
      }
    } catch (cause) {
      reportError(cause, () => {
        void createBoard().catch(reportError);
      });
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  function finishDuplicate(result: ManageResult, route: StudioViewScope) {
    if (!isMounted()) {
      return;
    }

    if (scope.isCurrent(route)) {
      openArtifact(result.artifact.id, result.board);
      return;
    }

    inform(`作品已复制，可从 ${STUDIO_HOME_TITLE} 打开。`);
  }

  function applyManageResult(result: ManageResult, artifact: Artifact) {
    if (result.board) {
      acceptDocument(result.board);
      return;
    }

    const current = getDocument();
    if (
      current?.artifact.id === artifact.id &&
      result.artifact.revision >= current.artifact.revision
    ) {
      acceptDocument({ ...current, artifact: result.artifact });
    }
  }

  async function manageArtifact(
    action: Exclude<LibraryArtifactAction, 'copyLink'> | 'rename',
    artifact: Artifact,
    extra: Record<string, unknown> = {},
  ) {
    if (busy) {
      return;
    }

    const route = scope.capture();
    setBusy(`${action}:${artifact.id}`);
    clearError();
    closeMenu();
    try {
      const result = await client.call<ManageResult>(STUDIO_TOOLS.manage, {
        action,
        artifactId: artifact.id,
        ...extra,
      });

      applyManageResult(result, artifact);
      if (action === 'duplicate') {
        finishDuplicate(result, route);

        return;
      }

      if (action === 'trash') {
        if (scope.capture().artifactId === artifact.id) {
          goHome();
        }
        forgetPreviews([artifact.id]);
      }
      if (scope.capture().artifactId === '') {
        await list.loadLibrary();
      }
      if (action === 'trash') {
        inform(
          artifact.storageStatus === 'unsupported'
            ? '已移入回收站。'
            : '已移入回收站，可以随时恢复。',
        );
      }
      if (action === 'restore') {
        inform('作品已恢复。');
      }
      if (action === 'rename') {
        setRename(null);
      }
    } catch (cause) {
      reportError(cause, () => {
        void manageArtifact(action, artifact, extra).catch(reportError);
      });
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  function startRename(artifact: Artifact) {
    setRename({ artifact, title: artifact.title });
    closeMenu();
  }

  function renameArtifact(artifact: Artifact, title: string) {
    void manageArtifact('rename', artifact, { title }).catch(reportError);
  }

  function submitRename() {
    const title = rename?.title.trim();
    if (rename && title) {
      renameArtifact(rename.artifact, title);
    }
  }

  function runArtifactAction(action: LibraryArtifactAction, artifact: Artifact) {
    if (action === 'pin') {
      void manageArtifact('pin', artifact, { pinned: !artifact.pinned }).catch(reportError);
      return;
    }
    if (action === 'copyLink') {
      if (!busy) {
        closeMenu();
        void copyArtifactLink(artifact).catch(reportError);
      }
      return;
    }

    void manageArtifact(action, artifact).catch(reportError);
  }

  const renameDialog = rename && {
    busy: Boolean(busy),
    title: rename.title,
    onChange: (title: string) =>
      setRename((previous) => (previous ? { ...previous, title } : null)),
    onClose: () => setRename(null),
    onSubmit: submitRename,
  };

  return {
    data: {
      busy,
      canManage,
      client,
      filter: list.filter,
      query: list.query,
      visibleArtifacts: list.visibleArtifacts,
      previews,
      libraryLoaded: list.libraryLoaded,
      libraryLoading: list.libraryLoading,
      hasNextPage: list.hasNextPage,
      menuId,
      ...trash.data,
    },
    actions: {
      showRecent,
      changeFilter,
      changeQuery: (query: string) => list.setQuery(query),
      createBoard: (productId?: string) => void createBoard(productId).catch(reportError),
      loadNextPage: list.loadNextPage,
      selectTrashPage: (selected: boolean) =>
        trash.selectTrashItems(
          list.visibleArtifacts.map((item) => item.id),
          selected,
        ),
      selectTrashItem: (id: string, selected: boolean) => trash.selectTrashItems([id], selected),
      changeArtifactMenu,
      startRename,
      runArtifactAction,
      ...trash.actions,
    },
    closeMenu,
    canOpenArtifact,
    setFilter: list.setFilter,
    renameArtifact,
    rememberPreview,
    renameDialog,
    purgeDialog: trash.purgeDialog,
  };
}
