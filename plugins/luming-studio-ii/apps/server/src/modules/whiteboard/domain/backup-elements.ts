import type {
  BoardObject,
  ConnectorDetail,
  ConnectorEndpoint,
  JsonObject,
  JsonValue,
  PayloadRecord,
} from './model.js';

type Fields = Readonly<Record<string, unknown>>;
type Source = (value: string) => string;

export class BackupElementError extends Error {
  constructor(readonly reason: 'unsupported' | 'tooLarge') {
    super('The v4 archive cannot represent this object.');
  }
}

const supported = new Set([
  'shape',
  'section',
  'connector',
  'ink',
  'text',
  'note',
  'document',
  'todo',
  'table',
  'image',
  'video',
  'html',
  'diagram',
  'chart',
  'link',
  'sticker',
]);
const legacyType = new Map([
  ['section', 'container'],
  ['connector', 'arrow'],
  ['ink', 'stroke'],
  ['video', 'image'],
]);
const alignments = new Map([
  ['TEXT_ALIGNMENT_LEFT', 'left'],
  ['TEXT_ALIGNMENT_CENTER', 'center'],
  ['TEXT_ALIGNMENT_RIGHT', 'right'],
]);
const attachmentSource =
  /(?<![\w/:.])\/studio-archive-assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?![\w./%-])/gu;

function object(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function rewrite(value: JsonValue | undefined, source: Source) {
  return typeof value === 'string' ? value.replaceAll(attachmentSource, source) : value;
}

function legacyVersion(value: JsonValue | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new BackupElementError('unsupported');
  }

  return revision;
}

function documentBlock(value: JsonValue, source: Source, depth: number): Fields {
  if (depth >= 64) {
    throw new BackupElementError('tooLarge');
  }

  const { blockId, type, props, content, children } = object(value);
  const fields = object(props);

  return {
    id: blockId,
    type,
    props: { ...fields, url: rewrite(fields.url, source) },
    content,
    children: array(children).map((child) => documentBlock(child, source, depth + 1)),
  };
}

function todoItem(value: JsonValue): Fields {
  const { itemId, text, checked, sourceRef } = object(value);
  const source = object(sourceRef);

  return {
    id: itemId,
    text,
    checked,
    sourceRef:
      sourceRef === undefined
        ? undefined
        : {
            artifactId: source.boardId,
            elementId: source.objectId,
            blockId: source.blockId,
            itemId: source.itemId,
            version: legacyVersion(source.version),
          },
  };
}

function tableCell(value: JsonValue) {
  const { text, number, boolValue } = object(value);

  return text ?? number ?? boolValue ?? null;
}

function imageFields(data: JsonObject, source: Source): Fields {
  const size = object(data.naturalSize);

  return {
    src: rewrite(data.src, source),
    href: rewrite(data.href, source),
    crop: data.crop,
    data: { naturalWidth: size.width, naturalHeight: size.height },
  };
}

function contentFields(
  element: BoardObject,
  payload: PayloadRecord | undefined,
  source: Source,
): Fields {
  const data = payload?.data ?? {};
  switch (element.kind) {
    case 'document':
      return {
        document: {
          schemaVersion: 1,
          blocks: array(data.blocks).map((value) => documentBlock(value, source, 0)),
        },
      };
    case 'todo':
      return { data: { items: array(data.items).map(todoItem) } };
    case 'table': {
      const { rows, ...fields } = object(data.grid);

      return {
        data: {
          ...fields,
          rows: array(rows).map((row) => array(object(row).cells).map(tableCell)),
        },
      };
    }
    case 'image':
      return imageFields(data, source);
    case 'video':
      return { video: rewrite(data.src, source), src: rewrite(data.poster, source) };
    case 'html':
    case 'diagram':
    case 'chart':
      return {
        html: rewrite(data.html, source),
        sourceRevision: legacyVersion(data.sourceRevision),
        state: data.state,
      };
    case 'sticker':
      return { data: { stickerIconId: data.stickerId } };
    case 'link':
      return { href: rewrite(data.href, source) };
    case 'ink':
      return {
        points: array(data.points).flatMap((value) => {
          const point = object(value);

          return [
            Number(point.x) * (element.geometry.width || 1),
            Number(point.y) * (element.geometry.height || 1),
          ];
        }),
      };
    default:
      return {
        color: data.color,
        fontFamily: data.fontFamily,
        fontSize: data.fontSize,
        textAlign: typeof data.align === 'string' ? alignments.get(data.align) : undefined,
      };
  }
}

function endPoint({ attachment, point }: ConnectorEndpoint) {
  return attachment?.objectId ?? [point.x, point.y];
}

function connectorFields(detail: ConnectorDetail): Fields {
  const { start, end, bends, relativeBends, startHead, endHead, labelOffset } = detail;

  return {
    from: endPoint(start),
    fromSide: start.attachment?.port,
    to: endPoint(end),
    toSide: end.attachment?.port,
    labelOffset,
    heads: [startHead ?? 'none', endHead ?? 'arrow'],
    bends: relativeBends
      ? [relativeBends.firstAxis === 'horizontal' ? 'h' : 'v', ...relativeBends.offsets]
      : bends.flatMap(({ x, y }) => [x, y]),
  };
}

export function backupElement(
  element: BoardObject,
  payload: PayloadRecord | undefined,
  source: Source,
): Fields | undefined {
  const { objectId, kind, label, geometry, locked, parentId, groupId, appearance, detail } =
    element;

  if (!supported.has(kind)) {
    return undefined;
  }

  const { width, height, x, y, rotation } = geometry;
  const styled = {
    fill: appearance?.fill,
    stroke: appearance?.stroke,
    strokeWidth: detail?.kind === 'ink' ? detail.width : appearance?.strokeWidth,
    dash: appearance?.dashed,
    hollow: detail?.kind === 'section' ? detail.transparent : appearance?.hollow,
  };

  return {
    id: objectId,
    type: legacyType.get(kind) ?? kind,
    x,
    y,
    w: width,
    h: height,
    rotation,
    text: label,
    label: kind === 'connector' ? label : undefined,
    locked,
    parentId,
    groupId,
    kind: detail?.kind === 'shape' ? detail.outline : undefined,
    ...styled,
    ...contentFields(element, payload, source),
    ...(detail?.kind === 'connector' ? connectorFields(detail) : undefined),
  };
}
