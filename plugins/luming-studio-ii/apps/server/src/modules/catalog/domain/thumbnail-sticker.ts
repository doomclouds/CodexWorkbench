import {
  stickerDefinition,
  type StickerPrimitive,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/stickers';

function graphicMarkup(graphic: StickerPrimitive) {
  const { fill } = graphic;
  switch (graphic.kind) {
    case 'path':
      return `<path d="${graphic.d}" fill="${fill}"/>`;
    case 'circle':
      return `<circle cx="${graphic.cx}" cy="${graphic.cy}" r="${graphic.r}" fill="${fill}"/>`;
    case 'rect':
      return `<rect x="${graphic.x}" y="${graphic.y}" width="${graphic.width}" height="${graphic.height}" rx="${graphic.rx}" fill="${fill}"/>`;
  }
}

export function renderThumbnailSticker(id: unknown, frame: string): string | undefined {
  const definition = typeof id === 'string' ? stickerDefinition(id) : undefined;
  if (!definition) {
    return undefined;
  }

  const graphics = definition.graphics.map(graphicMarkup).join('');

  return `<svg ${frame} viewBox="0 0 24 24"><g stroke-linecap="round" stroke-linejoin="round"><g stroke="#ffffff" stroke-width="4">${graphics}</g><g stroke="#273443" stroke-width="1.3">${graphics}</g></g></svg>`;
}
