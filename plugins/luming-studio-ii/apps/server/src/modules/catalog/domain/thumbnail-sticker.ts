import { stickerSvgContent } from '@codexworkbench/luming-studio-ii-whiteboard-shared/stickers';

export function renderThumbnailSticker(id: unknown, frame: string): string | undefined {
  const markup = typeof id === 'string' ? stickerSvgContent(id) : undefined;

  return markup ? `<svg ${frame} viewBox="0 0 24 24">${markup}</svg>` : undefined;
}
