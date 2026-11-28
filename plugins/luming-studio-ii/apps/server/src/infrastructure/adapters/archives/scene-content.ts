import { inkPoints, type SceneGeometry } from './scene-geometry.js';
import {
  ArchiveObjectError,
  booleanValue,
  numberValue,
  optionalNumber,
  optionalString,
  record,
  remapContent,
  remapMarkup,
  remapSource,
  requiredId,
  sequence,
  stringValue,
  unsignedInteger,
  type ArchiveData,
  type SourceResolver,
} from './scene-values.js';

export interface ArchiveScenePayload {
  readonly bodyKind: string;
  readonly data: ArchiveData;
}

export interface ArchiveSceneOrigin {
  readonly sourceBoardId: string;
  readonly boardId: string;
}

const textAlignments = new Map([
  ['left', 'TEXT_ALIGNMENT_LEFT'],
  ['center', 'TEXT_ALIGNMENT_CENTER'],
  ['right', 'TEXT_ALIGNMENT_RIGHT'],
]);
const maximumImageDimension = 0xffffffff;

function nullableData(value: unknown): ArchiveData {
  return value === undefined ? {} : record(value, 'object data');
}

function textPayload(element: ArchiveData, label: string): ArchiveData {
  return {
    text: label,
    color: optionalString(element.color, 'text color'),
    fontFamily: optionalString(element.fontFamily, 'font family'),
    fontSize: optionalNumber(element.fontSize, 'font size'),
    bold: element.bold === undefined ? undefined : booleanValue(element.bold, 'text bold'),
    italic: element.italic === undefined ? undefined : booleanValue(element.italic, 'text italic'),
    align: textAlignments.get(optionalString(element.textAlign, 'text alignment') ?? ''),
  };
}

function documentBlock(value: unknown, resolveSource: SourceResolver): ArchiveData {
  const block = record(value, 'document block');
  const children = block.children === undefined ? [] : sequence(block.children, 'child blocks');
  const props = block.props === undefined ? {} : record(block.props, 'document block props');

  return {
    blockId: requiredId(block.id, 'document block identifier'),
    type: stringValue(block.type, 'document block type'),
    props: remapContent(props, resolveSource),
    content: remapContent(block.content, resolveSource),
    children: children.map((child) => documentBlock(child, resolveSource)),
  };
}

function documentPayload(
  value: unknown,
  title: string,
  resolveSource: SourceResolver,
): ArchiveData {
  const document = record(value, 'document');
  if (document.schemaVersion !== 1) {
    throw new ArchiveObjectError('Invalid archived document schema version.');
  }

  const blocks = sequence(document.blocks, 'document blocks');

  return {
    title,
    schemaVersion: 1,
    blocks: blocks.map((block) => documentBlock(block, resolveSource)),
  };
}

function todoSource(
  value: unknown,
  origin: ArchiveSceneOrigin | undefined,
): ArchiveData | undefined {
  if (value === undefined) {
    return;
  }

  const source = record(value, 'todo source');
  const artifactId = optionalString(source.artifactId, 'todo source board');
  const boardId = origin && artifactId === origin.sourceBoardId ? origin.boardId : artifactId;

  return {
    boardId,
    objectId: requiredId(source.elementId, 'todo source object'),
    blockId: optionalString(source.blockId, 'todo source block'),
    itemId: optionalString(source.itemId, 'todo source item'),
    version:
      source.version === undefined
        ? undefined
        : unsignedInteger(source.version, 'todo source version'),
  };
}

function todoPayload(
  value: unknown,
  title: string,
  origin: ArchiveSceneOrigin | undefined,
): ArchiveData {
  const data = nullableData(value);
  const items = data.items === undefined ? [] : sequence(data.items, 'todo items');

  return {
    title,
    items: items.map((value) => {
      const item = record(value, 'todo item');

      return {
        itemId: requiredId(item.id, 'todo item identifier'),
        text: stringValue(item.text, 'todo text'),
        checked: booleanValue(item.checked, 'todo checkbox'),
        sourceRef: todoSource(item.sourceRef, origin),
      };
    }),
  };
}

function cell(value: unknown): ArchiveData {
  if (value === null) {
    return { nullValue: 'NULL_VALUE' };
  }
  if (typeof value === 'string') {
    return { text: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  return { number: numberValue(value, 'table cell') };
}

function tablePayload(value: unknown, text: string): ArchiveData {
  const table = nullableData(value);
  const rows = table.rows === undefined ? [] : sequence(table.rows, 'table rows');
  const rowIds = table.rowIds === undefined ? [] : sequence(table.rowIds, 'table row identifiers');
  const columnIds =
    table.columnIds === undefined ? [] : sequence(table.columnIds, 'table column identifiers');
  const widths =
    table.columnWidths === undefined ? [] : sequence(table.columnWidths, 'table column widths');

  return {
    text,
    grid: {
      rows: rows.map((row) => ({ cells: sequence(row, 'table cells').map(cell) })),
      rowIds: rowIds.map((id) => requiredId(id, 'table row identifier')),
      columnIds: columnIds.map((id) => requiredId(id, 'table column identifier')),
      columnWidths: widths.map((width) => numberValue(width, 'table column width')),
      head: table.head === undefined ? undefined : booleanValue(table.head, 'table header'),
    },
  };
}

function naturalSize(value: unknown) {
  const data = nullableData(value);
  if (data.naturalWidth === undefined || data.naturalHeight === undefined) {
    return;
  }

  const width = unsignedInteger(data.naturalWidth, 'image natural width');
  const height = unsignedInteger(data.naturalHeight, 'image natural height');
  if (width > maximumImageDimension || height > maximumImageDimension) {
    throw new ArchiveObjectError('Archived image dimensions exceed the supported range.');
  }

  return { width, height };
}

function cropValue(value: unknown) {
  if (value === undefined) {
    return;
  }

  const crop = record(value, 'image crop');

  return {
    x: numberValue(crop.x, 'image crop x'),
    y: numberValue(crop.y, 'image crop y'),
    zoom: numberValue(crop.zoom, 'image crop zoom'),
  };
}

function embedPayload(element: ArchiveData, title: string, resolveSource: SourceResolver) {
  const html = optionalString(element.html, 'embed markup');

  return {
    title,
    html: html === undefined ? undefined : remapMarkup(html, resolveSource),
    sourceRevision:
      element.sourceRevision === undefined
        ? undefined
        : unsignedInteger(element.sourceRevision, 'embed source revision'),
    state: remapContent(element.state, resolveSource),
  };
}

export interface SceneContentContext {
  readonly geometry: SceneGeometry;
  readonly kind: string;
  readonly label: string;
  readonly resolveSource: SourceResolver;
  readonly origin?: ArchiveSceneOrigin;
}

export function payloadFor(
  element: ArchiveData,
  context: SceneContentContext,
): ArchiveScenePayload | undefined {
  const { kind, label, geometry, resolveSource, origin } = context;
  switch (kind) {
    case 'text':
    case 'note':
    case 'shape':
    case 'section':
    case 'connector':
      return { bodyKind: 'text', data: textPayload(element, label) };
    case 'document':
      return {
        bodyKind: 'document',
        data: documentPayload(element.document, label, resolveSource),
      };
    case 'todo':
      return { bodyKind: 'todo', data: todoPayload(element.data, label, origin) };
    case 'table':
      return { bodyKind: 'table', data: tablePayload(element.data, label) };
    case 'html':
    case 'diagram':
    case 'chart':
      return { bodyKind: 'embed', data: embedPayload(element, label, resolveSource) };
    case 'image':
      return {
        bodyKind: 'image',
        data: {
          src: remapSource(element.src, 'image source', resolveSource),
          href: remapSource(element.href, 'image link', resolveSource),
          crop: cropValue(element.crop),
          naturalSize: naturalSize(element.data),
        },
      };
    case 'video':
      return {
        bodyKind: 'video',
        data: {
          src: remapSource(element.video, 'video source', resolveSource),
          poster: remapSource(element.src, 'video poster', resolveSource),
        },
      };
    case 'link':
      return {
        bodyKind: 'link',
        data: { href: remapSource(element.href, 'link target', resolveSource) },
      };
    case 'sticker': {
      const data = nullableData(element.data);

      return {
        bodyKind: 'sticker',
        data: { stickerId: optionalString(data.stickerIconId, 'sticker icon'), fallback: label },
      };
    }
    case 'ink':
      return { bodyKind: 'ink', data: { points: inkPoints(element, geometry) } };
  }
}
