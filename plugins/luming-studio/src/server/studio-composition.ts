import { userInfo } from 'node:os';
import { debuglog } from 'node:util';
import { studioProducts } from '../core/products/index.js';
import type { SvgPngRenderer } from '../core/ports/png-renderer.js';
import { StudioService } from '../core/service.js';
import { initializeVersionClocks } from '../core/shared/history.js';
import type { ProductRegistry } from '../core/shared/products.js';
import { FileArchiveStorage } from '../infrastructure/archive-storage.js';
import { ArtifactStore } from '../infrastructure/artifact-store.js';
import { FileAssetStore } from '../infrastructure/asset-file-store.js';
import { FileExportCopyStore } from '../infrastructure/export-copy-store.js';
import { loadOrCreateGuestSecret } from '../infrastructure/guest-identity-store.js';
import { FileRoomTimerStore } from '../infrastructure/room-timer-store.js';
import { createGuestSessions } from './guest-session.js';

export { createAppTransferSpool } from '../infrastructure/filesystem/app-transfer-spool.js';

export type ComposedStudioService = StudioService<ArtifactStore<unknown>>;

const debug = debuglog('luming-studio');

function localOwnerName(): string {
  try {
    return userInfo().username;
  } catch (error) {
    debug(
      'Cannot read the local owner name (%s).',
      error instanceof Error ? error.name : typeof error,
    );

    return 'You';
  }
}

const renderSvgPng: SvgPngRenderer = async (svg, options, maxPixels) => {
  const { renderSvgPng: render } = await import('../infrastructure/png-renderer.js');

  return render(svg, options, maxPixels);
};

export function createStudioService(
  options: { dataRoot?: string; products?: ProductRegistry; ownerName?: string } = {},
): ComposedStudioService {
  const products = options.products ?? studioProducts();
  const store = new ArtifactStore<unknown>(
    options.dataRoot,
    (value) => products.decode(value),
    (state) => {
      products.validate(state);
      initializeVersionClocks(state, products.get(state.artifact.type).adapter);
    },
  );

  const assetFiles = new FileAssetStore(store);

  return new StudioService({
    store,
    products,
    archiveStorage: new FileArchiveStorage(store, assetFiles),
    assetFiles,
    exportCopies: new FileExportCopyStore(store.root),
    renderSvgPng,
    roomTimerStore: new FileRoomTimerStore(store.root),
    ownerName: options.ownerName === undefined ? localOwnerName() : options.ownerName,
  });
}

export async function createStudioGuestSessions(dataRoot: string) {
  return createGuestSessions(await loadOrCreateGuestSecret(dataRoot));
}
