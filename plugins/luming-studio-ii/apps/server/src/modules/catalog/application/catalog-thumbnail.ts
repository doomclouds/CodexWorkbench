import {
  renderCatalogThumbnail,
  type CatalogThumbnail,
  type CatalogThumbnailRequest,
  type CatalogThumbnailResult,
} from '../domain/index.js';
import type { CatalogRepository } from '../ports/index.js';

const previewCacheEntries = 24;

function keep(
  cache: Map<string, CatalogThumbnail>,
  key: string,
  thumbnail: CatalogThumbnail,
): void {
  cache.delete(key);
  cache.set(key, thumbnail);
  if (cache.size > previewCacheEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

export function createCatalogThumbnailReader(repository: CatalogRepository) {
  const cache = new Map<string, CatalogThumbnail>();

  return (actorId: string, request: CatalogThumbnailRequest): CatalogThumbnailResult => {
    const { boardId, trashed } = request;
    const key = JSON.stringify([boardId, trashed]);
    const result = repository.readThumbnail({ ...request, actorId }, cache.get(key));
    if (result.kind !== 'scene') {
      if (result.kind === 'thumbnail') {
        keep(cache, key, result.thumbnail);
      }

      return result;
    }

    const thumbnail = renderCatalogThumbnail(result.scene, trashed);
    if (!thumbnail) {
      return { kind: 'unavailable' };
    }

    keep(cache, key, thumbnail);

    return { kind: 'thumbnail', thumbnail };
  };
}
