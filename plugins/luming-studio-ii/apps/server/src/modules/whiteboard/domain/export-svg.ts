import { exportConnector, finitePoint, geometryCorners } from './export-geometry.js';
import { escapeXml, svgContent, svgLabel } from './export-svg-content.js';
import { svgColor, svgShape, svgStrokeWidth } from './export-svg-shapes.js';
import {
  maxExportFileBytes,
  type BoardExportRejection,
  type BoardExportSnapshot,
} from './export-types.js';
import type { BoardObject, ConnectorHead, PayloadRecord, Point } from './model.js';

interface Markup {
  readonly value: string;
  readonly bounds: readonly Point[];
}

interface ExportFrame {
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

function expandFrame(frame: ExportFrame | undefined, points: readonly Point[]): ExportFrame {
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
  tip: Point | undefined,
  previous: Point | undefined,
  stroke: string,
  width: number,
): string {
  if (!tip || !previous) {
    return '';
  }
  if (!head || head === 'none') {
    return '';
  }
  if (head === 'circle') {
    return `<circle cx="${tip.x}" cy="${tip.y}" r="${2 * width}" fill="${stroke}"/>`;
  }

  const distance = Math.hypot(tip.x - previous.x, tip.y - previous.y);
  if (distance === 0) {
    return '';
  }

  const dx = (tip.x - previous.x) / distance;
  const dy = (tip.y - previous.y) / distance;
  const back = Math.min(distance, 5 * width);
  const side = 2.5 * width;
  const left = { x: tip.x - dx * back - dy * side, y: tip.y - dy * back + dx * side };
  const right = { x: tip.x - dx * back + dy * side, y: tip.y - dy * back - dx * side };

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
  const coordinates = points.map(({ x, y }) => `${x},${y}`).join(' ');
  const stroke = svgColor(object.appearance?.stroke, '#4f5d75');
  const width = svgStrokeWidth(object.appearance?.strokeWidth, 2);
  const dash = object.appearance?.dashed ? ' stroke-dasharray="6 5"' : '';
  const start = arrowHead(detail.startHead, points[0], points[1], stroke, width);
  const end = arrowHead(detail.endHead ?? 'arrow', points.at(-1), points.at(-2), stroke, width);
  const caption = escapeXml(object.label);
  const text = caption
    ? `<text x="${label.x}" y="${label.y - 4}" text-anchor="middle" font-size="13" fill="#2d3142">${caption}</text>`
    : '';
  const line = `<polyline points="${coordinates}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${dash}/>`;

  return { value: line + start + end + text, bounds: [...points, label] };
}

function sectionMarkup(object: BoardObject): string {
  const transparent = object.detail?.kind === 'section' && object.detail.transparent;
  const fill = transparent ? 'none' : svgColor(object.appearance?.fill, '#ececec');
  const stroke = svgColor(object.appearance?.stroke, '#bfc0c0');
  const { width, height } = object.geometry;
  const caption = escapeXml(object.label);

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
    const text = svgLabel(object.label, width, height, payload?.data ?? {}, true);

    return shape === undefined ? undefined : shape + text;
  }

  return svgContent(object, payload, assets);
}

function positionedMarkup(
  object: BoardObject,
  index: number,
  snapshot: BoardExportSnapshot,
  payload: PayloadRecord | undefined,
): Markup | undefined {
  if (object.kind === 'connector') {
    return connectorMarkup(object, snapshot.geometry);
  }

  const points = geometryCorners(object.geometry);

  if (!points.every(finitePoint)) {
    return undefined;
  }

  const markup = objectMarkup(object, payload, snapshot.assets);
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

function svgDocument(
  snapshot: BoardExportSnapshot,
  frame: ExportFrame | undefined,
  body: string,
): string {
  const x = (frame?.left ?? 0) - pad;
  const y = (frame?.top ?? 0) - pad;
  const width = (frame ? frame.right - frame.left : 1) + pad * 2;
  const height = (frame ? frame.bottom - frame.top : 1) + pad * 2;
  const title = escapeXml(snapshot.board.title);
  const revision = snapshot.board.revision.toString();
  const description = `白板版本 ${revision}，包含 ${snapshot.objects.length} 个对象。`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" role="img" font-family="sans-serif"><title>${title}</title><desc>${description}</desc><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f5f5f5"/>${body}</svg>\n`;
}

export function renderExportSvg(snapshot: BoardExportSnapshot): string | BoardExportRejection {
  const payloads = new Map(snapshot.payloads.map((payload) => [payload.objectId, payload]));
  const layers: string[] = [];
  let length = 0;
  let frame: ExportFrame | undefined;

  for (const [index, object] of snapshot.objects.entries()) {
    const markup = positionedMarkup(object, index, snapshot, payloads.get(object.objectId));
    if (!markup) {
      return { kind: 'rejected', reason: 'unsupported' };
    }

    length += markup.value.length;
    if (length > maxExportFileBytes) {
      return { kind: 'rejected', reason: 'tooLarge' };
    }

    layers.push(markup.value);
    frame = expandFrame(frame, markup.bounds);
  }

  return svgDocument(snapshot, frame, layers.join(''));
}
