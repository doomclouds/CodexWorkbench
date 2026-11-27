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
  boardId: string,
  thumbnail: CatalogThumbnail,
): void {
  cache.delete(boardId);
  cache.set(boardId, thumbnail);
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
    const { boardId } = request;
    const result = repository.readThumbnail({ ...request, actorId }, cache.get(boardId));
    if (result.kind !== 'scene') {
      if (result.kind === 'thumbnail') {
        keep(cache, boardId, result.thumbnail);
      }

      return result;
    }

    const thumbnail = renderCatalogThumbnail(result.scene);
    if (!thumbnail) {
      return { kind: 'unavailable' };
    }

    keep(cache, boardId, thumbnail);

    return { kind: 'thumbnail', thumbnail };
  };
}
