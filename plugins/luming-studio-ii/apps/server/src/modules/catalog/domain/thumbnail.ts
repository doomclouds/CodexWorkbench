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

function previewObject(
  object: CatalogThumbnailObject,
  projection: Projection,
  includeImages: boolean,
) {
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
  const image =
    includeImages && object.image && inlineImage.test(object.image) ? object.image : undefined;
  const content = image
    ? `${shape}<image ${dimensions(frame)} preserveAspectRatio="xMidYMid meet" href="${image}"/>`
    : shape + previewLabel(object.label, frame);

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

function renderOverview(
  scene: CatalogThumbnailScene,
  projection: Projection,
  includeImages: boolean,
) {
  const content = scene.objects
    .map((object) => previewObject(object, projection, includeImages))
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
