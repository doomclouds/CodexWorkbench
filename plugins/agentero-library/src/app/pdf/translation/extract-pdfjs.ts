import type { PDFPageProxy } from 'pdfjs-dist';
import { pdfjs } from '../../pdf-runtime';
import { pageGeometry, screenRectToPoints } from '../geometry';
import { fallbackCharacterGroups, rotatedCharacterIndexes } from './coverage';
import { paragraphFromCharacters } from './paragraph';
import { type Box, type Character, type Paragraph, type ReflowPage, unionBoxes } from './types';

export interface LayoutRegion { id: string; pageIndex: number; kind: string; score?: number; bbox?: Box; rect?: Box }
const centerInside = (a: Box, b: Box) => a.x + a.w / 2 >= b.x && a.x + a.w / 2 <= b.x + b.w && a.y + a.h / 2 >= b.y && a.y + a.h / 2 <= b.y + b.h;
export function layoutRegions(value: unknown): LayoutRegion[] {
  if (!value || typeof value !== 'object' || !('regions' in value) || !Array.isArray(value.regions)) return [];
  return value.regions.filter((item): item is LayoutRegion => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && Number.isInteger(item.pageIndex) && typeof item.kind === 'string'));
}
function regionBox(region: LayoutRegion, width: number, height: number): Box | null {
  const b = region.bbox;
  if (b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.01 && b.y + b.h <= 1.01) return { x: b.x * width, y: b.y * height, w: b.w * width, h: b.h * height };
  const r = region.rect;
  return r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 ? r : null;
}

/** Public PDF.js rendering/TextLayer APIs supply the same glyph geometry that the reader selects. */
export async function extractPage(page: PDFPageProxy, regions: LayoutRegion[], signal: AbortSignal): Promise<{ source: ReflowPage; formulas: Map<string, string> }> {
  signal.throwIfAborted();
  const geometry = pageGeometry(page, 1, 0);
  const host = window.document.createElement('div');
  host.className = 'pdf-page pdf-reflow-probe';
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${geometry.viewport.width}px;height:${geometry.viewport.height}px;opacity:0;pointer-events:none;`;
  host.style.setProperty('--scale-factor', '1'); host.style.setProperty('--total-scale-factor', String(page.userUnit));
  const content = window.document.createElement('div'); content.className = 'textLayer'; host.append(content);
  const canvas = window.document.createElement('canvas');
  const rasterScale = Math.min(2, Math.sqrt(8_000_000 / (geometry.viewport.width * geometry.viewport.height)));
  const rasterViewport = page.getViewport({ scale: rasterScale, rotation: 0 });
  canvas.width = Math.ceil(rasterViewport.width); canvas.height = Math.ceil(rasterViewport.height);
  window.document.body.append(host);
  let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
  const render = page.render({ canvas, viewport: rasterViewport, annotationMode: pdfjs.AnnotationMode.DISABLE });
  void render.promise.catch(() => {});
  const cancel = () => { render.cancel(); layer?.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await render.promise;
    signal.throwIfAborted();
    const text = await page.getTextContent();
    layer = new pdfjs.TextLayer({ textContentSource: text, container: content, viewport: geometry.viewport });
    await layer.render();
    signal.throwIfAborted();
    const bounds = host.getBoundingClientRect(); const characters: Character[] = [];
    for (const span of content.querySelectorAll<HTMLSpanElement>('span[role="presentation"]')) {
      const node = span.firstChild;
      if (!(node instanceof Text)) continue;
      const style = getComputedStyle(span); let offset = 0;
      const size = Number.parseFloat(span.style.getPropertyValue('--font-height')) || Number.parseFloat(style.fontSize) || 10;
      const textAngle = (Number.parseFloat(span.style.getPropertyValue('--rotate')) || 0) * Math.PI / 180;
      for (const char of node.data) {
        const range = window.document.createRange(); range.setStart(node, offset); offset += char.length; range.setEnd(node, offset);
        const rect = range.getBoundingClientRect();
        if (rect.height < .1) continue;
        const box = screenRectToPoints(rect, bounds, geometry);
        characters.push({ index: characters.length, text: char, box, visualBox: box, textAngle, style: { font: span.style.fontFamily || style.fontFamily, size, bold: Number.parseInt(style.fontWeight, 10) >= 600, italic: style.fontStyle === 'italic', color: { r: 0, g: 0, b: 0 } } });
        if (characters.length > 100_000) throw new Error('单页文字过多，已保留该页原文。');
      }
    }
    const pageIndex = page.pageNumber - 1;
    const normalized = regions.filter(region => region.pageIndex === pageIndex && (region.score ?? 1) >= .5).flatMap(region => { const box = regionBox(region, geometry.width, geometry.height); return box ? [{ region, box }] : []; });
    const formulas = normalized.filter(item => item.region.kind === 'formula').map(item => item.box);
    const preserve = normalized.filter(item => ['formula', 'figure', 'image', 'algorithm', 'table'].includes(item.region.kind));
    const rotated = rotatedCharacterIndexes(characters);
    const usable = characters.filter(char => !rotated.has(char.index));
    const claimed = new Set<number>(); const paragraphs: Paragraph[] = [];
    for (const { region, box } of normalized.filter(item => ['text', 'abstract', 'header', 'figure_title', 'caption'].includes(item.region.kind))) {
      const owned = usable.filter(char => !claimed.has(char.index) && centerInside(char.box, box));
      if (!owned.length) continue;
      owned.forEach(char => claimed.add(char.index));
      paragraphs.push(paragraphFromCharacters(region.id, pageIndex, box, owned, formulas, region.kind === 'header'));
    }
    // The MIT reading-order core splits separate columns and table cells before grouping prose.
    const fragments = fallbackCharacterGroups(usable.filter(char => !claimed.has(char.index) && !preserve.some(item => centerInside(char.box, item.box))));
    const groups: Character[][] = [];
    for (const fragment of fragments) {
      const b = unionBoxes(fragment.map(char => char.box)); const size = fragment[0]?.style.size ?? 10;
      const previous = [...groups].reverse().find(group => {
        const prior = unionBoxes(group.map(char => char.box)); const gap = b.y - prior.y - prior.h;
        return gap >= -1 && gap < size * 1.1 && Math.abs(prior.x - b.x) < size * 1.5 && Math.abs(prior.w - b.w) < Math.max(prior.w, b.w) * .4 && Math.abs((group[0]?.style.size ?? size) - size) < 1;
      });
      if (previous) previous.push(...fragment); else groups.push([...fragment]);
    }
    for (const [index, group] of groups.entries()) {
      const box = unionBoxes(group.map(char => char.box));
      const paragraph = paragraphFromCharacters(`${pageIndex}:fallback:${index}`, pageIndex, box, group, formulas, false);
      paragraph.fixedBox = true; paragraph.origin = 'fallback'; paragraphs.push(paragraph);
    }
    // Fixed table regions preserve cell boundaries and numeric/math-only content.
    for (const { region, box } of normalized.filter(item => item.region.kind === 'table')) {
      const cells = fallbackCharacterGroups(usable.filter(char => !claimed.has(char.index) && centerInside(char.box, box)));
      for (const [index, cell] of cells.entries()) {
        const cellBox = unionBoxes(cell.map(char => char.box));
        const paragraph = paragraphFromCharacters(`${region.id}:cell:${index}`, pageIndex, cellBox, cell, formulas, false);
        if (!/\p{L}{2}/u.test(paragraph.protectedText.replace(/⟪(?:F|\/?S)\d+⟫/gu, ''))) continue;
        paragraph.fixedBox = true; paragraph.origin = 'table'; paragraphs.push(paragraph);
      }
    }
    const source: ReflowPage = { index: pageIndex, width: geometry.width, height: geometry.height, paragraphs: paragraphs.filter(paragraph => /\p{L}{2}/u.test(paragraph.protectedText.replace(/⟪(?:F|\/?S)\d+⟫/gu, ''))), obstacles: preserve.map(item => item.box) };
    const formulaImages = new Map<string, string>(); const sx = canvas.width / source.width; const sy = canvas.height / source.height;
    for (const paragraph of source.paragraphs) for (const formula of paragraph.formulas) {
      const crop = window.document.createElement('canvas'); crop.width = Math.max(1, Math.ceil(formula.box.w * sx)); crop.height = Math.max(1, Math.ceil(formula.box.h * sy));
      crop.getContext('2d')?.drawImage(canvas, formula.box.x * sx, formula.box.y * sy, formula.box.w * sx, formula.box.h * sy, 0, 0, crop.width, crop.height);
      formulaImages.set(`${paragraph.id}:${formula.id}`, crop.toDataURL('image/png'));
    }
    return { source, formulas: formulaImages };
  } finally { signal.removeEventListener('abort', cancel); layer?.cancel(); host.remove(); canvas.width = 0; canvas.height = 0; }
}
