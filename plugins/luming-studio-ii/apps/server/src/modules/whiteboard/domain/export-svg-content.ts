import {
  parseRichText,
  type RichTextLine,
  type RichTextSegment,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/rich-text';
import { stickerSvgContent } from '@codexworkbench/luming-studio-ii-whiteboard-shared/stickers';
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

function compactLines(label: string, width: number, fontSize: number, count: number) {
  const columns = Math.max(1, Math.floor(width / (fontSize * 0.67)));

  return label
    .split(/\r?\n/u)
    .slice(0, count)
    .map((line) => (line.length > columns ? line.slice(0, columns) + '…' : line));
}

function svgTextRun(segment: RichTextSegment, text: string) {
  const bold = segment.bold || segment.type === 'bold' ? ' font-weight="700"' : '';
  const italic = segment.italic || segment.type === 'italic' ? ' font-style="italic"' : '';
  const code = segment.code || segment.type === 'code' ? ' font-family="monospace"' : '';
  const link = segment.href ? ' fill="#385f9d" text-decoration="underline"' : '';
  const style = bold + italic + code + link;
  const value = escapeXml(text);

  return style ? `<tspan${style}>${value}</tspan>` : value;
}

function svgTextLine(line: RichTextLine, width: number, fontSize: number) {
  const marker = line.marker ? line.marker + ' ' : '';
  const columns = Math.max(1, Math.floor(width / (fontSize * 0.67)));
  const indent = Math.min(line.indent ?? 0, Math.floor(columns / 4));
  let remaining = Math.max(1, columns - marker.length - indent * 2);
  let output = escapeXml(' '.repeat(indent * 2) + marker);
  for (const segment of line.segments) {
    const text = Array.from(segment.text);
    if (text.length > remaining) {
      const part = remaining ? svgTextRun(segment, text.slice(0, remaining).join('')) : '';

      return output + part + '…';
    }

    output += svgTextRun(segment, segment.text);
    remaining -= text.length;
  }

  return output;
}

export function svgCaption(value: string, width: number, fontSize: number) {
  const [line] = parseRichText(value.split(/\r?\n/u, 1)[0] ?? '');

  return line ? svgTextLine(line, width, fontSize) : '';
}

export function svgLabel(
  label: string,
  width: number,
  height: number,
  data: JsonObject,
  centered: boolean,
  mode: 'rich' | 'literal' = 'rich',
): string {
  const fontSize = bounded(data.fontSize, 8, 72, 14);
  const fill = svgColor(stringValue(data.color), '#2d3142');
  const count = Math.max(1, Math.min(maxRows, Math.floor(height / rowHeight)));
  const lines =
    mode === 'rich'
      ? parseRichText(label)
          .slice(0, count)
          .map((line) => svgTextLine(line, width, fontSize))
      : compactLines(label, width, fontSize, count).map(escapeXml);
  const right = data.align === 'TEXT_ALIGNMENT_RIGHT';
  const center = centered || data.align === 'TEXT_ALIGNMENT_CENTER';
  const alignedX = center ? width / 2 : 0;
  const x = right ? width : alignedX;
  const y = centered
    ? Math.max(fontSize, (height - lines.length * rowHeight) / 2 + fontSize)
    : fontSize;
  const alignedAnchor = center ? 'middle' : 'start';
  const anchor = right ? 'end' : alignedAnchor;
  const body = lines.map((line) => `<tspan x="${x}" dy="${rowHeight}">${line}</tspan>`).join('');

  const fontFamily =
    typeof data.fontFamily === 'string' ? ` font-family="${escapeXml(data.fontFamily)}"` : '';
  const weight = data.bold === true ? ' font-weight="700"' : '';
  const italic = data.italic === true ? ' font-style="italic"' : '';

  return `<text y="${y - rowHeight}" font-size="${fontSize}" text-anchor="${anchor}" fill="${fill}" xml:space="preserve"${fontFamily}${weight}${italic}>${body}</text>`;
}

function todoSourceAttribute(source: JsonObject | undefined): string {
  if (!source || typeof source.objectId !== 'string') {
    return '';
  }

  const { objectId, boardId, blockId, itemId, version } = source;
  const numericVersion = typeof version === 'string' ? Number(version) : version;
  const exportedVersion = Number.isSafeInteger(numericVersion) ? numericVersion : version;
  const reference = {
    elementId: objectId,
    artifactId: boardId,
    blockId,
    itemId,
    version: exportedVersion,
  };

  return ` data-source-ref="${escapeXml(JSON.stringify(reference))}"`;
}

function todoCard(object: BoardObject, data: JsonObject): string {
  const { width, height } = object.geometry;
  const items = Array.isArray(data.items) ? data.items : [];
  const rows = items.map(record).filter((row) => row !== undefined);
  const count = rows.filter(({ checked }) => checked === true).length;
  const paper = svgColor(object.appearance?.fill, '#ffffff');
  const line = svgColor(object.appearance?.stroke, '#bfc0c0');
  const ink = svgColor(stringValue(data.color), '#2d3142');
  const muted = '#4f5d75';
  const accent = '#7657c6';
  const title = stringValue(data.title) || object.label || '任务清单';
  const progress = rows.length ? (Math.max(width - 24, 0) * count) / rows.length : 0;
  const heading = `<svg x="12" width="${Math.max(1, width - 72)}" height="36" overflow="hidden"><text y="25" fill="${ink}" font-size="17" font-weight="600">${escapeXml(title)}</text></svg><text x="${width - 12}" y="25" fill="${muted}" font-size="12" text-anchor="end">${count}/${rows.length}</text>`;
  const bar = `<rect x="12" y="32" width="${Math.max(width - 24, 0)}" height="3" rx="1.5" fill="${line}"/><rect x="12" y="32" width="${progress}" height="3" rx="1.5" fill="${accent}"/>`;
  const content = rows.map((row, index) => {
    const checked = row.checked === true;
    const taskId = escapeXml(stringValue(row.itemId));
    const source = todoSourceAttribute(record(row.sourceRef));
    const check = checked
      ? `<path d="M17 16l3 3 5-6" fill="none" stroke="${paper}" stroke-width="1.5"/>`
      : '';
    const text = stringValue(row.text).replace(/\s+/gu, ' ');
    const caption = svgCaption(text, Math.max(0, width - (source ? 72 : 48)), 14);
    const sourceIcon = source
      ? `<g transform="translate(${width - 24} 10)" fill="none" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"><title>任务来源</title><path d="M5 8l4-4M4 5l-2 2a2.8 2.8 0 0 0 4 4l2-2M6 4l2-2a2.8 2.8 0 0 1 4 4l-2 2"/></g>`
      : '';

    return `<g transform="translate(0 ${40 + index * 32})" data-studio-task-id="${taskId}" data-checked="${checked}"${source}><title>${escapeXml(text)}</title><path d="M0 0H${width}" stroke="${line}"/><rect x="14" y="9" width="14" height="14" rx="3" fill="${checked ? accent : paper}" stroke="${checked ? accent : line}"/>${check}<text x="38" y="21" fill="${checked ? muted : ink}" font-size="14">${caption}</text>${sourceIcon}</g>`;
  });

  return `<rect width="${width}" height="${height}" rx="7" fill="${paper}" stroke="${line}"/>${heading}${bar}${content.join('')}`;
}

function svgNote(object: BoardObject, data: JsonObject): string {
  const { width, height } = object.geometry;
  const text = stringValue(data.text ?? data.title) || object.label;
  const fill = svgColor(object.appearance?.fill, '#f6e39c');
  const stroke = svgColor(object.appearance?.stroke, '#bfc0c0');
  const caption = svgLabel(text, Math.max(0, width - 20), height, data, false);

  return `<rect width="${width}" height="${height}" rx="4" fill="${fill}" stroke="${stroke}"/><g transform="translate(10 8)">${caption}</g>`;
}

function svgSticker(object: BoardObject, data: JsonObject) {
  const { width, height } = object.geometry;
  const graphic = stickerSvgContent(stringValue(data.stickerId));
  if (graphic) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 24 24" overflow="visible">${graphic}</svg>`;
  }

  const fallback = stringValue(data.fallback) || object.label;

  return svgLabel(
    fallback,
    width,
    height,
    { fontSize: Math.min(width, height) * 0.8 },
    true,
    'literal',
  );
}

function svgLink(object: BoardObject, data: JsonObject) {
  const { width, height } = object.geometry;
  const textWidth = Math.max(0, width - 54);
  const title = svgLabel(object.label, textWidth, 22, { bold: true }, false, 'literal');
  const address = stringValue(data.href);
  const href = svgLabel(
    address,
    textWidth,
    20,
    { fontSize: 12, color: '#526179' },
    false,
    'literal',
  );
  const centerY = Math.max(0, (height - 42) / 2);
  const icon =
    '<path d="m10 13 4-4m-6 7-1 1a3.5 3.5 0 1 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 7a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 1 0-5-5l-1 1" fill="none" stroke="#526179" stroke-width="2" stroke-linecap="round"/>';
  const fill = svgColor(object.appearance?.fill, '#ffffff');
  const stroke = svgColor(object.appearance?.stroke, '#bfc0c0');

  return `<title>${escapeXml(address || object.label)}</title><rect width="${width}" height="${height}" rx="7" fill="${fill}" stroke="${stroke}"/><g transform="translate(12 ${centerY + 8})">${icon}</g><g transform="translate(43 ${centerY})">${title}<g transform="translate(0 22)">${href}</g></g>`;
}

function imageUri(source: JsonValue | undefined, assets: ReadonlyMap<string, BoardExportAsset>) {
  if (typeof source !== 'string') {
    return undefined;
  }

  const captured = assets.get(source);
  if (
    captured &&
    (rasterMimeTypes.has(captured.mimeType) || captured.mimeType === 'image/svg+xml')
  ) {
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
    return undefined;
  }

  const uri = imageUri(source, assets);
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
      return svgLabel(stringValue(data.text) || object.label, width, height, data, false);
    case 'sticker':
      return svgSticker(object, data);
    case 'link':
      return svgLink(object, data);
    case 'note':
      return svgNote(object, data);
    case 'todo':
      return todoCard(object, data);
    default:
      return undefined;
  }
}
