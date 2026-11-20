import type { BoardElement } from '../../contracts/studio.js';
import { contains } from './canvas-model.js';

type Size = { w: number; h: number };
export type TableDetail = 'full' | 'preview' | 'outline';
type SectionTitleDetail = { mode: 'full' } | { mode: 'overview'; width: number };

export const overviewSectionTitle = { fontSize: 12, height: 16, gap: 4 };

export function projectedSize(size: Size, zoom: number): Size {
  return { w: size.w * zoom, h: size.h * zoom };
}

export function canReadCanvasText(size: Size, fontSize: number, zoom: number): boolean {
  return size.w >= 32 && size.h >= 12 && fontSize * zoom >= 8;
}

export function showHtmlCaption(element: BoardElement, zoom: number): boolean {
  return element.type === 'html' && zoom >= .5 && element.w * zoom >= 96;
}

export function sectionTitleDetails(elements: readonly BoardElement[], zoom: number): Map<string, SectionTitleDetail> {
  const details = new Map<string, SectionTitleDetail>();
  const sections = elements.filter(element => element.type === 'container');
  const { fontSize: minimumFont, height, gap } = overviewSectionTitle;
  const minimumWidth = minimumFont * 2.5;
  // Include the visible HTML caption line and its gap above the region at overview zooms.
  const occupied = zoom < 1 ? elements.filter(element => ['container', 'html', 'diagram', 'document', 'todo'].includes(element.type))
    .map(element => showHtmlCaption(element, zoom) ? { ...element, y: element.y - 28, h: element.h + 28 } : element) : [];
  for (const section of sections) {
    const size = projectedSize(section, zoom), fontSize = section.fontSize ?? 17;
    if (canReadCanvasText(size, fontSize, zoom) && (zoom >= 1 || fontSize * zoom >= minimumFont)) {
      details.set(section.id, { mode: 'full' });
      continue;
    }
    if (zoom >= 1 || size.w < minimumWidth || size.h < 12 || !section.text?.trim()) continue;
    const caption = { x: section.x, y: section.y - (height + gap) / zoom, w: section.w, h: height / zoom };
    // A compact heading needs an external lane. A containing section's background can
    // host a nested heading. A region on the right shortens the available lane.
    for (const region of occupied) {
      // Snapped neighbors can touch the lane edge without occupying any of it.
      const overlaps = region.x < caption.x + caption.w && region.x + region.w > caption.x
        && region.y < caption.y + caption.h && region.y + region.h > caption.y;
      if (region.id === section.id || !overlaps
        || (region.type === 'container' && contains(region, section) && contains(region, caption))) continue;
      caption.w = Math.max(0, region.x - section.x - gap / zoom);
      if (caption.w * zoom < minimumWidth) break;
    }
    if (caption.w * zoom >= minimumWidth) details.set(section.id, { mode: 'overview', width: caption.w });
  }
  return details;
}

export function tableDetail(size: Size, fontSize: number, zoom: number): TableDetail {
  if (size.w < 96 || size.h < 44) return 'outline';
  if (size.w < 240 || size.h < 96 || fontSize * zoom < 8) return 'preview';
  return 'full';
}

export function mediaControlsFit(size: Size): boolean {
  return size.w >= 128 && size.h >= 72;
}

export function overviewStrokeWidth(width: number, zoom: number): number {
  return zoom < .5 ? Math.max(width, .7 / zoom) : width;
}

export function canvasGridSpacing(zoom: number): number {
  const spacing = 24 * zoom;
  return spacing >= 8 ? spacing : spacing * 2 ** Math.ceil(Math.log2(8 / spacing));
}
