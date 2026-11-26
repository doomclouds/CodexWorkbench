import type { BoardExportAsset } from './export-types.js';
import type { BoardObject, JsonObject, JsonValue, PayloadRecord } from './model.js';
import { svgColor, svgStrokeWidth } from './export-svg-shapes.js';

const rasterMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);
const embeddedRaster = /^data:(image\/[A-Za-z]+);base64,([A-Za-z0-9+/]+={0,2})$/u;
const maxRows = 12;
const rowHeight = 20;
const xmlWhitespace = new Set(['\t', '\n', '\r']);

export function escapeXml(value: string): string {
  return value
    .replace(/\p{Cc}/gu, (character) =>
      character >= ' ' || xmlWhitespace.has(character) ? character : '',
    )
    .replace(/[\p{Cs}\ufffe\uffff]/gu, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function record(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function stringValue(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function bounded(value: JsonValue | undefined, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function lineText(value: JsonValue | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return stringValue(record(value)?.text);
  }

  return value.map((run) => stringValue(record(run)?.text) || stringValue(run)).join('');
}

function documentRows(data: JsonObject, count: number): string[] {
  const queue = Array.isArray(data.blocks) ? [...data.blocks] : [];
  const rows: string[] = [];

  for (let cursor = 0; cursor < queue.length && rows.length < count; cursor += 1) {
    const block = record(queue[cursor]);
    if (!block) {
      continue;
    }

    const text = lineText(block.content) || stringValue(record(block.props)?.caption);
    if (text) {
      rows.push(text);
    }
    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        queue.push(child);
      }
    }
  }

  return rows;
}

function todoRows(data: JsonObject, count: number): string[] {
  const items = Array.isArray(data.items) ? data.items : [];

  return items.slice(0, count).map((item) => {
    const row = record(item);
    const checked = row?.checked === true ? '✓' : '□';

    return checked + ' ' + stringValue(row?.text);
  });
}

function cellValue(cell: JsonValue): string {
  const data = record(cell);
  if (typeof data?.number === 'number') {
    return String(data.number);
  }
  if (typeof data?.boolValue === 'boolean') {
    return String(data.boolValue);
  }

  return stringValue(data?.text);
}

function tableRows(data: JsonObject, count: number): string[] {
  const rows = record(data.grid)?.rows;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.slice(0, count).map((row) => {
    const cells = record(row)?.cells;

    return Array.isArray(cells) ? cells.map(cellValue).join('  |  ') : '';
  });
}

function compactLines(label: string, width: number, fontSize: number, count: number) {
  const columns = Math.max(1, Math.floor(width / (fontSize * 0.67)));

  return label
    .split(/\r?\n/u)
    .slice(0, count)
    .map((line) => (line.length > columns ? line.slice(0, columns) + '…' : line));
}

export function svgLabel(
  label: string,
  width: number,
  height: number,
  data: JsonObject,
  centered: boolean,
): string {
  const fontSize = bounded(data.fontSize, 8, 72, 14);
  const fill = svgColor(stringValue(data.color), '#2d3142');
  const count = Math.max(1, Math.min(maxRows, Math.floor(height / rowHeight)));
  const lines = compactLines(label, width, fontSize, count);
  const right = data.align === 'TEXT_ALIGNMENT_RIGHT';
  const center = centered || data.align === 'TEXT_ALIGNMENT_CENTER';
  const alignedX = center ? width / 2 : 0;
  const x = right ? width : alignedX;
  const y = centered
    ? Math.max(fontSize, (height - lines.length * rowHeight) / 2 + fontSize)
    : fontSize;
  const alignedAnchor = center ? 'middle' : 'start';
  const anchor = right ? 'end' : alignedAnchor;
  const body = lines
    .map((line) => `<tspan x="${x}" dy="${rowHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<text y="${y - rowHeight}" font-size="${fontSize}" text-anchor="${anchor}" fill="${fill}">${body}</text>`;
}

function nativeCard(object: BoardObject, payload: PayloadRecord | undefined): string {
  const { width, height } = object.geometry;
  const data = payload?.data ?? {};
  const count = Math.max(0, Math.min(maxRows, Math.floor((height - 40) / rowHeight)));
  let rows: string[] = [];

  if (object.kind === 'document') {
    rows = documentRows(data, count);
  } else if (object.kind === 'todo') {
    rows = todoRows(data, count);
  } else if (object.kind === 'table') {
    rows = tableRows(data, count);
  }

  const text = [stringValue(data.title) || object.label, ...rows].join('\n');
  const fill = svgColor(object.appearance?.fill, object.kind === 'note' ? '#f6e39c' : '#ffffff');
  const stroke = svgColor(object.appearance?.stroke, '#bfc0c0');
  const caption = svgLabel(text, Math.max(0, width - 20), height, data, false);

  return `<rect width="${width}" height="${height}" rx="4" fill="${fill}" stroke="${stroke}"/><g transform="translate(10 8)">${caption}</g>`;
}

function rasterUri(source: JsonValue | undefined, assets: ReadonlyMap<string, BoardExportAsset>) {
  if (typeof source !== 'string') {
    return undefined;
  }

  const captured = assets.get(source);
  if (captured && rasterMimeTypes.has(captured.mimeType)) {
    return `data:${captured.mimeType};base64,${captured.base64}`;
  }

  const match = embeddedRaster.exec(source);

  return match?.[1] && rasterMimeTypes.has(match[1].toLowerCase()) ? source : undefined;
}

function imageExtent(width: number, height: number, data: JsonObject) {
  const crop = record(data.crop);
  if (!crop) {
    return { x: 0, y: 0, width, height, aspect: 'xMidYMid meet' };
  }

  const zoom = bounded(crop.zoom, 1, 10, 1);
  const x = bounded(crop.x, 0, 1, 0.5);
  const y = bounded(crop.y, 0, 1, 0.5);
  const naturalSize = record(data.naturalSize);
  const naturalWidth = bounded(naturalSize?.width, 0, 0xffffffff, 0);
  const naturalHeight = bounded(naturalSize?.height, 0, 0xffffffff, 0);
  if (naturalWidth === 0 || naturalHeight === 0) {
    return {
      x: (1 - zoom) * width * x,
      y: (1 - zoom) * height * y,
      width: width * zoom,
      height: height * zoom,
      aspect: 'xMidYMid slice',
    };
  }

  const scale = Math.max(width / naturalWidth, height / naturalHeight) * zoom;
  const scaledWidth = naturalWidth * scale;
  const scaledHeight = naturalHeight * scale;

  return {
    x: (width - scaledWidth) * x,
    y: (height - scaledHeight) * y,
    width: scaledWidth,
    height: scaledHeight,
    aspect: 'none',
  };
}

function svgImage(
  object: BoardObject,
  data: JsonObject,
  assets: ReadonlyMap<string, BoardExportAsset>,
) {
  const source = object.kind === 'video' ? data.poster : data.src;
  if (!source) {
    return object.kind === 'video' ? nativeCard(object, undefined) : undefined;
  }

  const uri = rasterUri(source, assets);
  if (!uri) {
    return undefined;
  }

  const { width, height } = object.geometry;
  const rect = imageExtent(width, height, data);

  return `<image x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="${rect.aspect}" href="${uri}"/>`;
}

function svgInk(object: BoardObject, data: JsonObject): string | undefined {
  if (!Array.isArray(data.points)) {
    return undefined;
  }

  const { width, height } = object.geometry;
  const points = data.points.map((point) => {
    const entry = record(point);
    if (typeof entry?.x !== 'number' || typeof entry.y !== 'number') {
      return undefined;
    }

    return `${entry.x * width},${entry.y * height}`;
  });

  if (points.includes(undefined)) {
    return undefined;
  }

  const color = svgColor(object.appearance?.stroke, '#2d3142');
  const inkWidth = object.detail?.kind === 'ink' ? object.detail.width : undefined;
  const strokeWidth = svgStrokeWidth(inkWidth ?? object.appearance?.strokeWidth, 3);

  return `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function svgContent(
  object: BoardObject,
  payload: PayloadRecord | undefined,
  assets: ReadonlyMap<string, BoardExportAsset>,
): string | undefined {
  const data = payload?.data ?? {};
  const { width, height } = object.geometry;

  switch (object.kind) {
    case 'image':
    case 'video':
      return svgImage(object, data, assets);
    case 'ink':
      return svgInk(object, data);
    case 'text':
    case 'sticker':
      return svgLabel(stringValue(data.text) || object.label, width, height, data, false);
    case 'document':
    case 'todo':
    case 'table':
    case 'note':
    case 'link':
      return nativeCard(object, payload);
    default:
      return undefined;
  }
}
