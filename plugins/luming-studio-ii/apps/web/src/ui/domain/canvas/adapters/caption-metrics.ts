import type { CanvasObjectKind } from '../contracts.js';

const sectionCaptionFontSize = 17;

export const sectionOverview = { fontSize: 14, height: 18, gap: 4, minimumWidth: 35 };
export const embedCaptionGap = 8;

export type EmbedCaptionPlacement = 'above' | 'inside';

export function hasEmbedCaption(kind: CanvasObjectKind) {
  return kind === 'html' || kind === 'diagram' || kind === 'chart';
}

export function usesSectionOverview(zoom: number) {
  return zoom < 1 && sectionCaptionFontSize * zoom < sectionOverview.fontSize;
}

export function embedCaptionFont(zoom: number) {
  return Math.max(12, Math.min(14, 14 * zoom));
}

export function embedCaptionHeight(zoom: number) {
  return embedCaptionFont(zoom) * 1.4;
}
