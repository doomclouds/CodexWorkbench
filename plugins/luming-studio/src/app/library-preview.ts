import { useState } from 'react';
import type { StudioClient } from '../contracts/studio';

export interface LibraryPreviewFrame {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
}

export interface LibraryPreview {
  readonly paper: string;
  readonly frames: readonly LibraryPreviewFrame[];
}

export const LIBRARY_PREVIEW_LIMIT = 24;
export const LIBRARY_PREVIEW_FRAME_LIMIT = 128;

export type LibraryPreviews = ReadonlyMap<string, LibraryPreview>;

const emptyPreviews: LibraryPreviews = new Map();

export function rememberLibraryPreview(
  previews: LibraryPreviews,
  id: string,
  preview: LibraryPreview,
): LibraryPreviews {
  const next = new Map(previews);
  next.delete(id);
  next.set(id, preview);
  if (next.size > LIBRARY_PREVIEW_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest !== undefined) {
      next.delete(oldest);
    }
  }

  return next;
}

export function forgetLibraryPreviews(
  previews: LibraryPreviews,
  ids: readonly string[],
): LibraryPreviews {
  if (!ids.some((id) => previews.has(id))) {
    return previews;
  }

  const next = new Map(previews);
  for (const id of ids) {
    next.delete(id);
  }

  return next;
}

export function useLibraryPreviews(client: StudioClient, ownerId: string | null) {
  const [cache, setCache] = useState({ client, ownerId, previews: emptyPreviews });
  const authorityChanged = cache.client !== client || cache.ownerId !== ownerId;
  if (authorityChanged) {
    setCache({ client, ownerId, previews: emptyPreviews });
  }

  function rememberPreview(id: string, preview: LibraryPreview) {
    if (!ownerId) {
      return;
    }

    setCache((previous) => {
      if (previous.client !== client || previous.ownerId !== ownerId) {
        return previous;
      }

      return { ...previous, previews: rememberLibraryPreview(previous.previews, id, preview) };
    });
  }

  function forgetPreviews(ids: readonly string[]) {
    setCache((previous) => {
      if (previous.client !== client || previous.ownerId !== ownerId) {
        return previous;
      }

      const previews = forgetLibraryPreviews(previous.previews, ids);

      return previous.previews === previews ? previous : { ...previous, previews };
    });
  }

  return {
    previews: authorityChanged ? emptyPreviews : cache.previews,
    rememberPreview,
    forgetPreviews,
  };
}
