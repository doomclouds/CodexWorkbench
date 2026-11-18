import type { BoardElement, StyleProfile } from '../../contracts/studio.js';
import { contrastRatio, parseColor, readableText, semanticColor } from '../theme.js';

export function nativeFill(element: BoardElement, style: StyleProfile, value: unknown = element.fill): string {
  if (element.hollow || element.type === 'text') return 'transparent';
  const fallback = element.type === 'note' ? '#fff0b5'
    : element.type === 'shape' || element.type === 'table' ? style['paper-2'] ?? style.paper
      : element.type === 'link' ? '#ffffff' : 'transparent';
  const color = semanticColor(value, style, fallback);
  return color === 'none' ? 'transparent' : color;
}

function contrastInk(ink: string, fill: string, backdrop: string): string {
  try {
    return contrastRatio(ink, fill, backdrop) < 4.5 ? readableText(fill, backdrop) : ink;
  } catch {
    return ink;
  }
}

/** Literal paints keep their stored meaning; automatic ink follows the visible surface. */
export function nativeTextInk(value: unknown, style: StyleProfile, fill: string, backdrop = style.paper): string {
  const ink = semanticColor(value, style, style.ink);
  if (typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d., /]+\))$/i.test(value)) return ink;
  return contrastInk(ink, fill, backdrop);
}

/** Header and body surfaces can differ while sharing one stored table color. */
export function nativeTableInk(value: unknown, style: StyleProfile, fill: string): string {
  return contrastInk(semanticColor(value, style, style.ink), fill, style.paper);
}

interface NativeSurface { order: number; left: number; top: number; right: number; bottom: number; inset: number; fill?: string }
export interface NativeSurfaceScene { paper: string; order: ReadonlyMap<string, number>; surfaces: readonly NativeSurface[] }

/** Build once per scene so text-only layers never enter individual backdrop scans. */
export function nativeSurfaces(elements: readonly BoardElement[], style: StyleProfile, fillOf: (value: BoardElement) => string = value => nativeFill(value, style)): NativeSurfaceScene {
  const order = new Map<string, number>(), surfaces: NativeSurface[] = [];
  elements.forEach((candidate, index) => {
    order.set(candidate.id, index);
    if (['text', 'stroke', 'arrow', 'sticker'].includes(candidate.type)) return;
    const radius = candidate.rotation ? Math.hypot(candidate.w, candidate.h) / 2 : 0;
    const left = radius ? candidate.x + candidate.w / 2 - radius : candidate.x;
    const top = radius ? candidate.y + candidate.h / 2 - radius : candidate.y;
    const right = radius ? candidate.x + candidate.w / 2 + radius : candidate.x + candidate.w;
    const bottom = radius ? candidate.y + candidate.h / 2 + radius : candidate.y + candidate.h;
    const inset = candidate.type === 'shape' && candidate.kind === 'rect' || candidate.type === 'note' ? 0 : 8;
    const surface: NativeSurface = { order: index, left, top, right, bottom, inset };
    if (['container', 'shape', 'note', 'link'].includes(candidate.type) && !candidate.rotation) {
      try {
        const fill = fillOf(candidate), alpha = parseColor(fill)[3];
        if (alpha === 0) return;
        if (alpha === 1 && (candidate.type !== 'shape' || ['rect', 'rounded'].includes(candidate.kind ?? 'rounded'))) surface.fill = fill;
      } catch { /* An unrecognized surface still prevents looking through it. */ }
    }
    surfaces.push(surface);
  });
  return { paper: style.paper, order, surfaces };
}

/** Only a fully covering, opaque native rectangle establishes a reliable backdrop. */
export function nativeBackdrop(element: BoardElement, scene: NativeSurfaceScene, fill: string): string {
  const { paper, order, surfaces } = scene;
  if (!surfaces.length || element.rotation || !['text', 'shape', 'note', 'link'].includes(element.type)) return paper;
  if (typeof element.color === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d., /]+\))$/i.test(element.color)) return paper;
  try {
    if (fill !== 'transparent' && parseColor(fill)[3] === 1) return paper;
  } catch {
    return paper;
  }
  const index = order.get(element.id) ?? -1;
  for (let at = surfaces.length - 1; at >= 0; at--) {
    const surface = surfaces[at]!;
    if (surface.order >= index) continue;
    const overlaps = surface.left < element.x + element.w && surface.right > element.x && surface.top < element.y + element.h && surface.bottom > element.y;
    if (!overlaps) continue;
    if (!surface.fill) return paper;
    const covers = surface.left + surface.inset <= element.x && surface.top + surface.inset <= element.y && surface.right - surface.inset >= element.x + element.w && surface.bottom - surface.inset >= element.y + element.h;
    return covers ? surface.fill : paper;
  }
  return paper;
}
