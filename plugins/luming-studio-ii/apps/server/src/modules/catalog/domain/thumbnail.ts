import { renderThumbnailSticker } from './thumbnail-sticker.js';

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CatalogThumbnailObject extends Point {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly appearance?: string;
  readonly detail?: string;
  readonly content?: JsonRecord;
  readonly html?: string;
  readonly image?: string;
}

export interface CatalogThumbnailScene {
  readonly revision: bigint;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly objects: readonly CatalogThumbnailObject[];
}

export interface CatalogThumbnail {
  readonly revision: bigint;
  readonly mimeType: 'image/svg+xml';
  readonly content: Uint8Array;
}

export interface CatalogThumbnailRequest {
  readonly boardId: string;
  readonly revision: bigint;
  readonly trashed: boolean;
}

export type CatalogThumbnailResult =
  | { readonly kind: 'thumbnail'; readonly thumbnail: CatalogThumbnail }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'forbidden' };

interface Projection {
  readonly byId: ReadonlyMap<string, CatalogThumbnailObject>;
  readonly project: (point: Point) => Point;
  readonly scale: number;
}

interface Frame extends Point {
  readonly width: number;
  readonly height: number;
}

type JsonRecord = Readonly<Record<string, unknown>>;

const imageWidth = 560;
const imageHeight = 320;
const previewPadding = 16;
const previewBytes = 128 * 1024;
const labelLimit = 60;
const paper = '#f3f4f6';
const ink = '#2d3142';
const muted = '#68758a';
const colorLiteral = /^(?:transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/iu;
const inlineImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/]+={0,2}$/iu;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function readRecord(value: string | undefined): JsonRecord | undefined {
  if (value !== undefined) {
    try {
      return record(JSON.parse(value) as unknown);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && colorLiteral.test(value) ? value : fallback;
}

function xml(value: string) {
  return value
    .replace(/\p{Cc}|[\uFFFE\uFFFF]/gu, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function dimensions({ x, y, width, height }: Frame) {
  return `x="${x}" y="${y}" width="${width}" height="${height}"`;
}

function previewShape(frame: Frame, outline: unknown, paint: string) {
  const { x, y, width, height } = frame;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const right = x + width;
  const bottom = y + height;
  const bevel = width / 6;

  switch (outline) {
    case 'ellipse':
      return `<ellipse cx="${centerX}" cy="${centerY}" rx="${width / 2}" ry="${height / 2}" ${paint}/>`;
    case 'diamond':
      return `<polygon points="${centerX},${y} ${right},${centerY} ${centerX},${bottom} ${x},${centerY}" ${paint}/>`;
    case 'hexagon':
      return `<polygon points="${x + bevel},${y} ${right - bevel},${y} ${right},${centerY} ${right - bevel},${bottom} ${x + bevel},${bottom} ${x},${centerY}" ${paint}/>`;
    case 'parallelogram':
      return `<polygon points="${x + bevel},${y} ${right},${y} ${right - bevel},${bottom} ${x},${bottom}" ${paint}/>`;
    case 'pill':
      return `<rect ${dimensions(frame)} rx="${Math.min(width, height) / 2}" ${paint}/>`;
    case 'rect':
      return `<rect ${dimensions(frame)} ${paint}/>`;
    default:
      return `<rect ${dimensions(frame)} rx="${Math.min(5, width / 4, height / 4)}" ${paint}/>`;
  }
}

function previewLabel(label: string, frame: Frame) {
  if (frame.width < 40 || frame.height < 13) {
    return '';
  }

  const count = Math.floor((frame.width - 8) / 8);
  const display = Array.from(label.trim()).slice(0, Math.min(count, labelLimit)).join('');
  if (!display) {
    return '';
  }

  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2 + 3;

  return `<text x="${centerX}" y="${centerY}" text-anchor="middle" fill="${ink}" font-family="sans-serif" font-size="9">${xml(display)}</text>`;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function blockText(value: unknown): string {
  if (!Array.isArray(value)) {
    return textValue(value);
  }

  return value
    .slice(0, 120)
    .map((run: unknown) => {
      const entry = record(run);
      const children = entry?.content;

      return entry?.type === 'link' && Array.isArray(children)
        ? children
            .slice(0, 24)
            .map((item: unknown) => textValue(record(item)?.text))
            .join('')
        : textValue(entry?.text ?? run);
    })
    .join('');
}

function documentLines(content: JsonRecord, count: number) {
  const pending: unknown[] = Array.isArray(content.blocks)
    ? content.blocks.slice(0, 48).reverse()
    : [];
  const lines: string[] = [];
  for (let visited = 0; visited < 48 && pending.length && lines.length < count; visited += 1) {
    const block = record(pending.pop());
    const text = blockText(block?.content) || textValue(record(block?.props)?.caption);
    if (text.trim()) {
      lines.push(text);
    }
    if (Array.isArray(block?.children)) {
      pending.push(...block.children.slice(0, 48).reverse());
    }
  }

  return lines;
}

function todoLines(content: JsonRecord, count: number) {
  const items: unknown[] = Array.isArray(content.items) ? content.items : [];

  return items.slice(0, count).map((raw) => {
    const item = record(raw);

    return (item?.checked === true ? '✓ ' : '□ ') + textValue(item?.text);
  });
}

function truncateLine(text: string, width: number, fontSize: number) {
  const end = width / fontSize;
  let extent = 0;
  let result = '';
  for (const character of text.trim().replace(/\s+/gu, ' ').slice(0, 360)) {
    extent += character.codePointAt(0)! > 255 ? 1 : 0.58;
    if (extent > end) {
      return result + '…';
    }

    result += character;
  }

  return result;
}

function previewTextContent(object: CatalogThumbnailObject, frame: Frame, scale: number) {
  const { content, kind, label } = object;
  if (!content || frame.width < 27 || frame.height < 12) {
    return undefined;
  }

  const isCard = kind === 'document' || kind === 'todo';
  const plain = textValue(content.text);
  if (!isCard && !plain.trim()) {
    return undefined;
  }

  const textSize = typeof content.fontSize === 'number' ? content.fontSize : 15;
  const fontSize = Math.min(16, Math.max(5, textSize * scale));
  const pad = Math.max(2, fontSize * 0.5);
  const step = fontSize * 1.35;
  const count = Math.min(12, Math.floor((frame.height - pad * 2) / step));
  if (count < 1) {
    return undefined;
  }

  const title = textValue(content.title) || label;
  const lines =
    kind === 'document' ? documentLines(content, count - 1) : todoLines(content, count - 1);
  const text = isCard ? [title, ...lines] : plain.split('\n', count);
  const x = frame.x + pad;
  const y = frame.y + pad + fontSize;
  const rows = text
    .map((line, index) => {
      const display = truncateLine(line, frame.width - pad * 2, fontSize);
      const weight = isCard && index === 0 ? ' font-weight="bold"' : '';

      return `<tspan x="${x}" y="${y + index * step}"${weight}>${xml(display)}</tspan>`;
    })
    .join('');

  return rows
    ? `<text fill="${color(content.color, ink)}" font-family="sans-serif" font-size="${fontSize}">${rows}</text>`
    : undefined;
}

function detailedContent(
  object: CatalogThumbnailObject,
  frame: Frame,
  scale: number,
  shape: string,
) {
  if (object.kind === 'sticker') {
    const graphic = renderThumbnailSticker(object.content?.stickerId, dimensions(frame));

    return graphic ?? previewLabel(textValue(object.content?.fallback) || object.label, frame);
  }
  if (object.html) {
    const { x, y } = frame;
    const size = `width="${object.width}" height="${object.height}"`;

    return `${shape}<g transform="translate(${x} ${y}) scale(${scale})"><foreignObject ${size} style="overflow:hidden">${object.html}</foreignObject></g>`;
  }
  if (object.image && inlineImage.test(object.image)) {
    return shape + previewImage(object.image, object.content, frame);
  }

  const text = previewTextContent(object, frame, scale);

  return text === undefined ? undefined : shape + text;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function previewImage(image: string, data: JsonRecord | undefined, frame: Frame) {
  const crop = record(data?.crop);
  const natural = record(data?.naturalSize);
  const naturalWidth = finiteNumber(natural?.width, 0);
  const naturalHeight = finiteNumber(natural?.height, 0);
  const usableSize = [naturalWidth, naturalHeight].every(
    (value) => Number.isInteger(value) && value > 0 && value <= 0xffffffff,
  );

  if (!crop || !usableSize) {
    return `<image ${dimensions(frame)} preserveAspectRatio="xMidYMid meet" href="${image}"/>`;
  }

  const { width, height } = frame;
  const zoom = Math.max(1, Math.min(10, finiteNumber(crop.zoom, 1)));
  const scale = Math.max(width / naturalWidth, height / naturalHeight) * zoom;
  const imageWidth = naturalWidth * scale;
  const imageHeight = naturalHeight * scale;
  const x = (width - imageWidth) * Math.max(0, Math.min(1, finiteNumber(crop.x, 0.5)));
  const y = (height - imageHeight) * Math.max(0, Math.min(1, finiteNumber(crop.y, 0.5)));

  return `<svg ${dimensions(frame)} viewBox="0 0 ${width} ${height}" overflow="hidden"><image x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" href="${image}"/></svg>`;
}

function point(input: unknown): Point | undefined {
  const value = record(input);
  const x = value?.x;
  const y = value?.y;
  const isNumeric = typeof x === 'number' && typeof y === 'number';

  return isNumeric && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function attachedPoint(object: CatalogThumbnailObject, port: unknown): Point {
  const { x, y, width, height } = object;
  switch (port) {
    case 'top':
      return { x: x + width / 2, y };
    case 'bottom':
      return { x: x + width / 2, y: y + height };
    case 'left':
      return { x, y: y + height / 2 };
    case 'right':
      return { x: x + width, y: y + height / 2 };
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

function previewEndpoint(endpoint: unknown, byId: Projection['byId'], fallback: Point): Point {
  const value = record(endpoint);
  const attachment = record(value?.attachment);
  const object =
    typeof attachment?.objectId === 'string' ? byId.get(attachment.objectId) : undefined;

  return object ? attachedPoint(object, attachment?.port) : (point(value?.point) ?? fallback);
}

function previewConnector(object: CatalogThumbnailObject, projection: Projection, stroke: string) {
  const info = readRecord(object.detail);
  const start = previewEndpoint(info?.start, projection.byId, object);
  const stop = previewEndpoint(info?.end, projection.byId, {
    x: object.x + object.width,
    y: object.y + object.height,
  });
  const bends = Array.isArray(info?.bends)
    ? info.bends.slice(0, 16).flatMap((bend) => point(bend) ?? [])
    : [];
  const points = [start, ...bends, stop]
    .map(projection.project)
    .map(({ x, y }) => `${x},${y}`)
    .join(' ');

  return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.1"/>`;
}

function appearance(object: CatalogThumbnailObject) {
  const style = readRecord(object.appearance);
  const defaultFill = object.kind === 'note' ? '#f9e391' : '#ffffff';
  const transparent = object.kind === 'section' || object.kind === 'text';
  const fill = color(style?.fill, transparent ? 'transparent' : defaultFill);
  const stroke = color(style?.stroke, object.kind === 'text' ? 'transparent' : muted);
  const dash = style?.dashed === true ? ' stroke-dasharray="3 2"' : '';

  return { fill, stroke, dash };
}

function previewObject(object: CatalogThumbnailObject, projection: Projection, detailed: boolean) {
  const { fill, stroke, dash } = appearance(object);
  if (object.kind === 'connector' || object.kind === 'arrow') {
    return previewConnector(object, projection, stroke);
  }

  const position = projection.project(object);
  const width = Math.max(1, Math.round(object.width * projection.scale * 10) / 10);
  const height = Math.max(1, Math.round(object.height * projection.scale * 10) / 10);
  const frame = { ...position, width, height };
  const info = readRecord(object.detail);
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="1"${dash}`;
  const shape = previewShape(frame, info?.outline, paint);
  const details = detailed ? detailedContent(object, frame, projection.scale, shape) : undefined;
  const content = details ?? shape + previewLabel(object.label, frame);

  if (object.rotation === 0) {
    return content;
  }

  return `<g transform="rotate(${object.rotation} ${frame.x + width / 2} ${frame.y + height / 2})">${content}</g>`;
}

function projectScene({ objects, left, top, right, bottom }: CatalogThumbnailScene): Projection {
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const scale = Math.min(
    (imageWidth - 2 * previewPadding) / width,
    (imageHeight - 2 * previewPadding) / height,
  );
  const offsetX = (imageWidth - width * scale) / 2;
  const offsetY = (imageHeight - height * scale) / 2;

  return {
    byId: new Map(objects.map((object) => [object.id, object])),
    scale,
    project: ({ x, y }) => ({
      x: Math.round((offsetX + (x - left) * scale) * 10) / 10,
      y: Math.round((offsetY + (y - top) * scale) * 10) / 10,
    }),
  };
}

function renderOverview(scene: CatalogThumbnailScene, projection: Projection, detailed: boolean) {
  const content = scene.objects
    .map((object) => previewObject(object, projection, detailed))
    .join('');

  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}"><rect width="100%" height="100%" fill="${paper}"/>${content}</svg>`,
  );
}

export function renderCatalogThumbnail(scene: CatalogThumbnailScene): CatalogThumbnail | undefined {
  if (scene.objects.length === 0) {
    return undefined;
  }

  const projection = projectScene(scene);
  const detailed = renderOverview(scene, projection, true);
  const content =
    detailed.byteLength > previewBytes ? renderOverview(scene, projection, false) : detailed;

  return content.byteLength <= previewBytes
    ? { revision: scene.revision, mimeType: 'image/svg+xml', content }
    : undefined;
}
