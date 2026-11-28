import {
  connectionPathData,
  connectorArrowPoints,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/connector-route';
import { exportConnector, finitePoint, geometryCorners } from './export-geometry.js';
import {
  boardTableCss,
  boardTableMarkup,
  documentAssetsAvailable,
  documentMarkup,
  embedMarkup,
  offlineAsset,
} from './export-html-content.js';
import { escapeXml, svgCaption, svgContent, svgLabel } from './export-svg-content.js';
import { svgColor, svgShape, svgStrokeWidth } from './export-svg-shapes.js';
import {
  maxExportFileBytes,
  type BoardExportPngRegion,
  type BoardExportRejection,
  type BoardExportSnapshot,
  type PngExportOptions,
} from './export-types.js';
import type { BoardObject, ConnectorHead, PayloadRecord, Point } from './model.js';

interface Markup {
  readonly value: string;
  readonly bounds: readonly Point[];
}

export interface ExportFrame {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const pad = 32;

function frameFrom(points: readonly Point[]): ExportFrame {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  return { left, top, right, bottom };
}

export function expandFrame(frame: ExportFrame | undefined, points: readonly Point[]): ExportFrame {
  const bounds = frameFrom(points);
  if (!frame) {
    return bounds;
  }

  return {
    left: Math.min(frame.left, bounds.left),
    top: Math.min(frame.top, bounds.top),
    right: Math.max(frame.right, bounds.right),
    bottom: Math.max(frame.bottom, bounds.bottom),
  };
}

function arrowHead(
  head: ConnectorHead | undefined,
  points: readonly Point[],
  atStart: boolean,
  stroke: string,
  width: number,
): string {
  if (!head || head === 'none' || points.length < 2) {
    return '';
  }

  if (head === 'circle') {
    const tip = atStart ? points[0]! : points.at(-1)!;
    return `<circle cx="${tip.x}" cy="${tip.y}" r="${2 * width}" fill="${stroke}"/>`;
  }

  const arrow = connectorArrowPoints(points, atStart, width);
  if (!arrow) {
    return '';
  }

  const [left, tip, right] = arrow;

  return `<path d="M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z" fill="${stroke}"/>`;
}

function connectorMarkup(
  object: BoardObject,
  geometry: BoardExportSnapshot['geometry'],
): Markup | undefined {
  const detail = object.detail;
  if (detail?.kind !== 'connector') {
    return undefined;
  }

  const route = exportConnector(detail, geometry);
  if (!route) {
    return undefined;
  }

  const { points, label } = route;
  const stroke = svgColor(object.appearance?.stroke, '#4f5d75');
  const width = svgStrokeWidth(object.appearance?.strokeWidth, 2);
  const dash = object.appearance?.dashed ? ' stroke-dasharray="6 5"' : '';
  const start = arrowHead(detail.startHead, points, true, stroke, width);
  const end = arrowHead(detail.endHead ?? 'arrow', points, false, stroke, width);
  const caption = svgCaption(object.label, 200, 13);
  const text = caption
    ? `<text x="${label.x}" y="${label.y - 4}" text-anchor="middle" font-size="13" fill="#2d3142">${caption}</text>`
    : '';
  const line = `<path d="${connectionPathData(points)}" fill="none" stroke-linecap="round" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${dash}/>`;

  return { value: line + start + end + text, bounds: [...points, label] };
}

function sectionMarkup(object: BoardObject): string {
  const transparent = object.detail?.kind === 'section' && object.detail.transparent;
  const fill = transparent ? 'none' : svgColor(object.appearance?.fill, '#ececec');
  const stroke = svgColor(object.appearance?.stroke, '#bfc0c0');
  const { width, height } = object.geometry;
  const caption = svgCaption(object.label, Math.max(0, width - 16), 13);

  return `<rect width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-dasharray="6 5"/><text x="8" y="17" font-size="13" fill="#4f5d75">${caption}</text>`;
}

function objectMarkup(
  object: BoardObject,
  payload: PayloadRecord | undefined,
  assets: BoardExportSnapshot['assets'],
): string | undefined {
  if (object.kind === 'section') {
    return sectionMarkup(object);
  }

  if (object.kind === 'shape') {
    const { width, height } = object.geometry;
    const outline = object.detail?.kind === 'shape' ? object.detail.outline : 'rounded';
    const shape = svgShape(outline, width, height, object.appearance);
    const data = payload?.data ?? {};
    const label = typeof data.text === 'string' ? data.text : object.label;
    const text = svgLabel(label, width, height, data, true);

    return shape === undefined ? undefined : shape + text;
  }

  return svgContent(object, payload, assets);
}

export function positionedSvgMarkup(
  object: BoardObject,
  index: number,
  snapshot: BoardExportSnapshot,
  payload: PayloadRecord | undefined,
  richMarkup?: string,
): Markup | undefined {
  if (object.kind === 'connector') {
    return connectorMarkup(object, snapshot.geometry);
  }

  const points = geometryCorners(object.geometry);

  if (!points.every(finitePoint)) {
    return undefined;
  }

  const markup = richMarkup ?? objectMarkup(object, payload, snapshot.assets);
  if (markup === undefined) {
    return undefined;
  }

  const { x, y, width, height, rotation } = object.geometry;
  const transform = `translate(${x} ${y}) rotate(${rotation % 360} ${width / 2} ${height / 2})`;
  const id = 'board-object-' + index;
  const clip =
    object.kind === 'image' || object.kind === 'video'
      ? `<clipPath id="${id}"><rect width="${width}" height="${height}" rx="4"/></clipPath>`
      : `<clipPath id="${id}"><rect width="${width}" height="${height}"/></clipPath>`;
  const body = `<g clip-path="url(#${id})">${markup}</g>`;

  return { value: `<g transform="${transform}">${clip}${body}</g>`, bounds: points };
}

export function exportViewport(frame: ExportFrame | undefined) {
  const x = (frame?.left ?? 0) - pad;
  const y = (frame?.top ?? 0) - pad;
  const width = (frame ? frame.right - frame.left : 1) + pad * 2;
  const height = (frame ? frame.bottom - frame.top : 1) + pad * 2;

  return { x, y, width, height };
}

function svgDocument(
  snapshot: BoardExportSnapshot,
  viewBox: ReturnType<typeof exportViewport>,
  viewport: Pick<ReturnType<typeof exportViewport>, 'width' | 'height'>,
  body: string,
  exactCrop: boolean,
): string {
  const { x, y, width, height } = viewBox;
  const title = escapeXml(snapshot.board.title);
  const revision = snapshot.board.revision.toString();
  const description = `白板版本 ${revision}，包含 ${snapshot.objects.length} 个对象。`;
  const aspectRatio = exactCrop ? ' preserveAspectRatio="none"' : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}" viewBox="${x} ${y} ${width} ${height}"${aspectRatio} role="img" font-family="sans-serif"><title>${title}</title><desc>${description}</desc><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f5f5f5"/>${body}</svg>\n`;
}

function richRegion(
  object: BoardObject,
  index: number,
  payload: PayloadRecord | undefined,
  snapshot: BoardExportSnapshot,
) {
  const { width, height } = object.geometry;
  if (!payload || !(width > 0 && height > 0)) {
    return undefined;
  }

  const { bodyKind, data } = payload;
  if (bodyKind === 'embed') {
    const scripted = typeof data.html === 'string' && /<script(?:\s|>)/iu.test(data.html);
    const html = embedMarkup(data, snapshot.assets, scripted);

    return { index, width, height, html, ...(scripted && { scripted }) };
  }

  if (bodyKind === 'document') {
    if (!documentAssetsAvailable(data.blocks, snapshot.assets)) {
      return undefined;
    }

    const title = typeof data.title === 'string' ? data.title : object.label;
    const content = documentMarkup(data.blocks, snapshot.assets);
    const html =
      '<style>body{margin:0;background:#fff;color:#2d3142;font:14px/1.5 system-ui,sans-serif}header,main{box-sizing:border-box;padding:10px 14px;overflow-wrap:anywhere}header{font-weight:600;border-bottom:1px solid #dedee3}main :first-child{margin-top:0}h1,h2,h3,p,blockquote,pre,figure{margin:.6em 0}pre{white-space:pre-wrap}blockquote{padding-left:8px;border-left:3px solid #bfc0c0}.list-item{display:list-item;margin-left:1.25em}.numbered{list-style:decimal}table{border-collapse:collapse}th,td{border:1px solid #dedee3;padding:3px 5px}img{display:block;max-width:100%;height:auto}figcaption{font-size:.85em}</style>' +
      `<header>${escapeXml(title)}</header><main>${content}</main>`;

    return { index, width, height, html };
  }

  if (bodyKind === 'table') {
    const table = boardTableMarkup(data, object.appearance?.fill);
    const html = `<style>body{margin:0;overflow:hidden}${boardTableCss}</style>${table}`;

    return { index, width, height, html };
  }

  const source = bodyKind === 'video' && !data.poster && offlineAsset(data.src, snapshot.assets);
  if (source && source.startsWith('data:video/')) {
    const html =
      '<style>body{margin:0}video,img{display:block;width:100vw;height:100vh;object-fit:contain;background:#111}</style>' +
      `<video data-studio-export-video src="${escapeXml(source)}" preload="none" playsinline></video>`;

    return { index, width, height, html };
  }
}

function richMarkup({ index, width, height, scripted }: BoardExportPngRegion) {
  if (scripted) {
    return `<g data-studio-png-region="${index}"></g>`;
  }

  return `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" data-studio-png-region="${index}"></div></foreignObject>`;
}

export function renderExportSvg(snapshot: BoardExportSnapshot, options?: PngExportOptions) {
  const payloads = new Map(snapshot.payloads.map((payload) => [payload.objectId, payload]));
  const layers: string[] = [];
  const regions: BoardExportPngRegion[] = [];
  const utf8 = new TextEncoder();
  let length = 0;
  let frame: ExportFrame | undefined;

  for (const [index, object] of snapshot.objects.entries()) {
    const payload = payloads.get(object.objectId);
    const region = richRegion(object, index, payload, snapshot);
    const markup = positionedSvgMarkup(
      object,
      index,
      snapshot,
      payload,
      region && richMarkup(region),
    );

    if (!markup) {
      return { kind: 'rejected', reason: 'unsupported' } satisfies BoardExportRejection;
    }

    length += utf8.encode(markup.value).byteLength;
    if (region) {
      regions.push(region);
      length += utf8.encode(region.html).byteLength;
    }
    if (length > maxExportFileBytes) {
      return { kind: 'rejected', reason: 'tooLarge' } satisfies BoardExportRejection;
    }

    layers.push(markup.value);
    if (!options?.rectangle) {
      frame = expandFrame(frame, markup.bounds);
    }
  }

  const viewBox = options?.rectangle ?? exportViewport(frame);
  const scale = options?.scale ?? 1;
  const exactCrop = options?.rectangle !== undefined;
  const viewport =
    exactCrop || scale !== 1
      ? {
          width: Math.max(1, Math.floor(viewBox.width * scale)),
          height: Math.max(1, Math.floor(viewBox.height * scale)),
        }
      : viewBox;

  return {
    svg: svgDocument(snapshot, viewBox, viewport, layers.join(''), exactCrop),
    regions,
    viewport,
  };
}
