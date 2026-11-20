import type { Board, BoardElement } from '../../contracts/studio.js';
import { renderSvgPng } from '../export.js';
import { boardBounds, buildBoardSvg, ExportError, filenameFor, isHtmlRegionElement, selectedElements } from '../serialization.js';
import { workspaceElementBounds } from '../shared/agent-workspaces.js';
import { safeId } from '../shared/common.js';

export interface CaptureRect { x: number; y: number; w: number; h: number }
export type SavedRegionTarget = { ids: string[]; rect?: never } | { rect: CaptureRect; ids?: never };
export interface SavedRegionCapture {
  mimeType: 'image/png';
  filename: string;
  data: string;
  encoding: 'base64';
  source: 'saved-render';
  artifactId: string;
  revision: number;
  bounds: CaptureRect;
  width: number;
  height: number;
  ids: string[];
}

const MAX_PIXELS = 1_000_000;
const MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_RENDER_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_RECT_ELEMENTS = 20;

function captureRegion(board: Board, target: SavedRegionTarget): { elements: BoardElement[]; bounds: CaptureRect } {
  if ((target.ids === undefined) === (target.rect === undefined)) {
    throw new ExportError('INVALID_ARGUMENT', '局部图像需要指定对象 ID 或世界坐标范围，两者择一。');
  }
  if (target.ids !== undefined) {
    if (!Array.isArray(target.ids) || !target.ids.length || target.ids.length > 10 || new Set(target.ids).size !== target.ids.length) {
      throw new ExportError('INVALID_ARGUMENT', '请指定 1 至 10 个不重复的对象 ID。');
    }
    const elements = selectedElements(board, { ids: target.ids.map(id => safeId(id, '对象 ID')) });
    const { x, y, width, height } = boardBounds(elements, 8, board.elements);
    return { elements, bounds: { x, y, w: width, h: height } };
  }

  const rect = target.rect!;
  if (!rect || ![rect.x, rect.y, rect.w, rect.h, rect.x + rect.w, rect.y + rect.h, rect.w * rect.h].every(Number.isFinite)
    || rect.w <= 0 || rect.h <= 0 || rect.x + rect.w <= rect.x || rect.y + rect.h <= rect.y) {
    throw new ExportError('INVALID_ARGUMENT', '局部图像范围须使用有限坐标和正宽高。');
  }
  const elements: BoardElement[] = [];
  for (const element of board.elements) {
    const box = workspaceElementBounds(element, board.elements);
    if (box.x >= rect.x + rect.w || box.x + box.w <= rect.x || box.y >= rect.y + rect.h || box.y + box.h <= rect.y) continue;
    elements.push(element);
    if (elements.length > MAX_RECT_ELEMENTS) throw new ExportError('CAPTURE_TOO_MANY_ELEMENTS', '局部图像范围最多包含 20 个对象，请缩小范围。');
  }
  if (!elements.length) throw new ExportError('EMPTY_CAPTURE', '指定范围内没有可绘制的白板对象。');
  return { elements, bounds: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
}

/** Resolve only saved images belonging to this board and present in this capture. */
async function captureImages(board: Board, elements: BoardElement[], resolveLocalAsset: (source: string) => Promise<string>): Promise<Record<string, string>> {
  const images = new Map<string, string>();
  let bytes = 0;
  const assetPrefix = `/assets/${board.artifact.id}/`;
  for (const element of elements) {
    if (element.type !== 'image' || typeof element.src !== 'string') continue;
    const source = element.src;
    let embedded = images.get(source);
    if (embedded === undefined) {
      if (source.startsWith(assetPrefix)) {
        safeId(source.slice(assetPrefix.length), '资源 ID');
        embedded = await resolveLocalAsset(source);
      } else {
        embedded = source;
      }
      if (!/^data:image\//i.test(embedded)) {
        throw new ExportError('ASSET_NOT_EMBEDDED', '后台局部图像仅使用当前白板已保存的图片。');
      }
      images.set(source, embedded);
    }
    bytes += Buffer.byteLength(embedded);
    if (bytes > MAX_RENDER_SOURCE_BYTES) throw new ExportError('EXPORT_TOO_LARGE', '局部图像的图片源超过上限，请缩小范围。');
  }
  return Object.fromEntries(images);
}

/** Render a saved board revision. This does not observe or open a user's active view. */
export async function captureSavedRegion(board: Board, target: SavedRegionTarget, resolveLocalAsset: (source: string) => Promise<string>): Promise<SavedRegionCapture> {
  const { elements, bounds } = captureRegion(board, target);
  if (elements.some(isHtmlRegionElement)) {
    throw new ExportError('EXPORT_BROWSER_REQUIRED', '区域包含需要浏览器排版的 HTML。请在已打开的白板查看，或指定其他对象范围。');
  }
  const ids = elements.map(element => element.id);
  const assets = await captureImages(board, elements, resolveLocalAsset);

  const render = (maxPixels: number) => {
    const scale = Math.min(1, MAX_SIDE / Math.max(bounds.w, bounds.h), Math.sqrt(maxPixels / (bounds.w * bounds.h)));
    const width = Math.max(1, Math.floor(bounds.w * scale)), height = Math.max(1, Math.floor(bounds.h * scale));
    const svg = buildBoardSvg(board, { ids, assets }, { width, height, bounds: { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h } })
      // A hyperlink has no target in a PNG. Keep its text color without retaining the external URL.
      .replace(/<a\b[^>]*>/gi, tag => tag.replace(/\shref="[^"]*"/i, ''));
    if (Buffer.byteLength(svg) > MAX_RENDER_SOURCE_BYTES) throw new ExportError('EXPORT_TOO_LARGE', '局部图像的渲染源超过上限，请缩小范围。');
    return renderSvgPng(svg, {}, maxPixels);
  };

  let image = await render(MAX_PIXELS);
  if (image.bytes.length > MAX_BYTES && image.width * image.height > 240_000) image = await render(240_000);
  if (image.bytes.length > MAX_BYTES) throw new ExportError('EXPORT_TOO_LARGE', '局部 PNG 超过 1 MiB，请缩小范围。');
  return {
    mimeType: 'image/png', filename: filenameFor(`${board.artifact.title} - 局部`, 'png'), data: image.bytes.toString('base64'), encoding: 'base64',
    source: 'saved-render', artifactId: board.artifact.id, revision: board.artifact.revision, bounds, width: image.width, height: image.height, ids,
  };
}
