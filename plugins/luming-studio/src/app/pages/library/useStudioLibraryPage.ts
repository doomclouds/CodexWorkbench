import type { Artifact } from '../../../contracts/studio';
import { loadOrStartSharing, type EditorShareState } from '../../features/collaboration';
import { useLibrary } from '../../features/library';
import { createTransferActions } from '../../features/transfer';
import type { StudioDocument } from '../../product-contract';
import { getProduct, products } from '../../products';
import type { StudioViewScope } from '../../shared/studio-view-scope';
import type { StudioLibraryViewProps } from './StudioLibraryView';

type LibraryFeatureOptions = Omit<
  Parameters<typeof useLibrary>[0],
  'copyArtifactLink' | 'resolveProduct'
>;
interface LibraryPageOptions extends LibraryFeatureOptions {
  layout: StudioLibraryViewProps['data']['layout'];
  resolvedTheme: StudioLibraryViewProps['data']['resolvedTheme'];
  changeLayout: StudioLibraryViewProps['actions']['changeLayout'];
  changeTheme: StudioLibraryViewProps['actions']['changeTheme'];
  copyLink: (link: string, scope: StudioViewScope) => Promise<void>;
  revealSharing: (artifactId: string, sharing: EditorShareState) => void;
}

export function useStudioLibraryPage(options: LibraryPageOptions) {
  const { layout, resolvedTheme, changeLayout, changeTheme, copyLink, revealSharing, ...feature } =
    options;
  const { client, scope, setBusy, reportError, isMounted } = feature;
  async function copyArtifactLink(artifact: Artifact) {
    const request = scope.capture();
    setBusy(`copy-link:${artifact.id}`);
    try {
      const state = await loadOrStartSharing(client, artifact.id);
      if (!scope.isCurrent(request)) {
        return;
      }

      if (state.enabled && state.links?.viewer) {
        await copyLink(state.links.viewer, request);
      } else {
        revealSharing(artifact.id, state);
      }
    } catch (cause) {
      if (scope.isCurrent(request)) {
        reportError(cause);
      }
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  const library = useLibrary({
    ...feature,
    resolveProduct: (id = products[0]!.id) => getProduct(id),
    copyArtifactLink,
  });
  const transfer = createTransferActions({ ...feature, resolveProduct: getProduct });

  function rememberDocument(current: StudioDocument | null) {
    if (!feature.canManage || !current || current.artifact.trashedAt) {
      return;
    }

    const preview = getProduct(current.artifact.type)?.projectLibraryPreview?.(current);
    if (preview) {
      library.rememberPreview(current.artifact.id, preview);
    }
  }

  const view: StudioLibraryViewProps = {
    data: { ...library.data, layout, resolvedTheme },
    actions: {
      ...library.actions,
      changeLayout,
      changeTheme,
      importArchive: (file) => void transfer.importArchive(file).catch(reportError),
      openArtifact: (id) => feature.openArtifact(id),
    },
  };

  return {
    view,
    rememberDocument,
    canOpenArtifact: library.canOpenArtifact,
    closeMenu: library.closeMenu,
    setFilter: library.setFilter,
    renameArtifact: library.renameArtifact,
    purgeDialog: library.purgeDialog,
    renameDialog: library.renameDialog,
    exportBoard: transfer.exportBoard,
  };
}
