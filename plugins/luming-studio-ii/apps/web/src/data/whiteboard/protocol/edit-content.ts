import {
  fromJson,
  type JsonObject,
  type JsonValue,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import { NullValue, ValueSchema } from '@bufbuild/protobuf/wkt';
import type {
  EditObjectContentRequestSchema,
  TodoEditSchema,
  TodoPlacementSchema,
  UpdateTodoItemSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  TextAlignment,
  type DocumentBlockSchema,
  type DocumentPayloadSchema,
  type ObjectPayloadSchema,
  type TableCellSchema,
  type TablePayloadSchema,
  type TextPayloadSchema,
  type TodoItemSchema,
  type TodoSourceRefSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import type {
  EditObjectContentCommand,
  EditObjectContentOperation,
  WhiteboardDocumentBlock,
  WhiteboardDocumentContent,
  WhiteboardInitialPayload,
  WhiteboardJson,
  WhiteboardTableCell,
  WhiteboardTableContent,
  WhiteboardTextContent,
  WhiteboardTodoChange,
  WhiteboardTodoItem,
  WhiteboardTodoSource,
} from '../edits-types.js';

type AssetResolver = (source: string) => string;
type WireEdit = MessageInitShape<typeof EditObjectContentRequestSchema>['edit'];
type WireSourceChange = MessageInitShape<typeof UpdateTodoItemSchema>['sourceChange'];

const archiveAssetPrefix = '/studio-archive-assets/';
const archiveAssetPath = /^\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/u;
const alignments = {
  left: TextAlignment.LEFT,
  center: TextAlignment.CENTER,
  right: TextAlignment.RIGHT,
};

function isJsonArray(value: WhiteboardJson): value is readonly WhiteboardJson[] {
  return Array.isArray(value);
}

function writeJsonObject(fields: Readonly<Record<string, WhiteboardJson>>): JsonObject {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, writeJson(value)]));
}

function writeJson(value: WhiteboardJson): JsonValue {
  if (isJsonArray(value)) {
    return value.map(writeJson);
  }
  if (value !== null && typeof value === 'object') {
    return writeJsonObject(value);
  }

  return value;
}

function stableImageSource(source: string, resolveAsset: AssetResolver): string {
  const offset = source.indexOf(archiveAssetPrefix);
  if (offset <= 0) {
    return source;
  }

  const path = source.slice(offset);

  return archiveAssetPath.test(path) && resolveAsset(path) === source ? path : source;
}

function writeBlock(
  { id, type, props, content, children }: WhiteboardDocumentBlock,
  resolveAsset: AssetResolver,
): MessageInitShape<typeof DocumentBlockSchema> {
  const fields = writeJsonObject(props);
  if (type === 'image' && typeof fields.url === 'string') {
    fields.url = stableImageSource(fields.url, resolveAsset);
  }

  return {
    blockId: id,
    type,
    props: fields,
    content: content === undefined ? undefined : fromJson(ValueSchema, writeJson(content)),
    children: children?.map((child) => writeBlock(child, resolveAsset)),
  };
}

function writeDocument(
  { title, document }: WhiteboardDocumentContent,
  resolveAsset: AssetResolver,
): MessageInitShape<typeof DocumentPayloadSchema> {
  return {
    title,
    schemaVersion: document.schemaVersion,
    blocks: document.blocks.map((block) => writeBlock(block, resolveAsset)),
  };
}

function writeText({
  text,
  color,
  fontFamily,
  fontSize,
  align,
}: WhiteboardTextContent): MessageInitShape<typeof TextPayloadSchema> {
  return { text, color, fontFamily, fontSize, align: align && alignments[align] };
}

function writeTodoSource({
  artifactId,
  elementId,
  blockId,
  itemId,
  version,
}: WhiteboardTodoSource): MessageInitShape<typeof TodoSourceRefSchema> {
  if (typeof version === 'number' && !Number.isSafeInteger(version)) {
    throw new Error('Whiteboard edit has an unsafe todo source version.');
  }

  return {
    boardId: artifactId,
    objectId: elementId,
    blockId,
    itemId,
    version: version === undefined ? undefined : BigInt(version),
  };
}

function writeTodoItem({
  id,
  text,
  checked,
  sourceRef,
}: WhiteboardTodoItem): MessageInitShape<typeof TodoItemSchema> {
  return { itemId: id, text, checked, sourceRef: sourceRef && writeTodoSource(sourceRef) };
}

function writeTodoPlacement(
  afterId: string | null | undefined,
): MessageInitShape<typeof TodoPlacementSchema> {
  if (afterId === null) {
    return { position: { case: 'first', value: true } };
  }
  if (afterId === undefined) {
    return { position: { case: 'append', value: true } };
  }

  return { position: { case: 'afterItemId', value: afterId } };
}

function writeTodoSourceChange(source: WhiteboardTodoSource | null | undefined): WireSourceChange {
  if (source === null) {
    return { case: 'clearSource', value: true };
  }

  return source && { case: 'sourceRef', value: writeTodoSource(source) };
}

function writeTodoEdit(change: WhiteboardTodoChange): MessageInitShape<typeof TodoEditSchema> {
  switch (change.op) {
    case 'rename':
      return { operation: { case: 'rename', value: change.title } };
    case 'insert':
      return {
        operation: {
          case: 'insert',
          value: {
            item: writeTodoItem(change.item),
            placement: writeTodoPlacement(change.afterId),
          },
        },
      };
    case 'update': {
      const { text, checked, sourceRef } = change.changes;

      return {
        operation: {
          case: 'update',
          value: {
            itemId: change.id,
            text,
            checked,
            sourceChange: writeTodoSourceChange(sourceRef),
          },
        },
      };
    }
    case 'delete':
      return { operation: { case: 'deleteItemId', value: change.id } };
    case 'move':
      return {
        operation: {
          case: 'move',
          value: { itemId: change.id, placement: writeTodoPlacement(change.afterId) },
        },
      };
  }
}

function writeTableCell(value: WhiteboardTableCell): MessageInitShape<typeof TableCellSchema> {
  if (value === null) {
    return { value: { case: 'nullValue', value: NullValue.NULL_VALUE } };
  }
  if (typeof value === 'string') {
    return { value: { case: 'text', value } };
  }
  if (typeof value === 'number') {
    return { value: { case: 'number', value } };
  }

  return { value: { case: 'boolValue', value } };
}

function writeTable({
  text,
  rows,
  rowIds,
  columnIds,
  columnWidths,
  head,
}: WhiteboardTableContent): MessageInitShape<typeof TablePayloadSchema> {
  return {
    text,
    grid: {
      rows: rows.map((row) => ({ cells: row.map(writeTableCell) })),
      rowIds: [...rowIds],
      columnIds: [...columnIds],
      columnWidths: columnWidths && [...columnWidths],
      head,
    },
  };
}

function writeContentEdit(edit: EditObjectContentOperation, resolveAsset: AssetResolver): WireEdit {
  switch (edit.kind) {
    case 'document':
      return { case: 'document', value: writeDocument(edit.value, resolveAsset) };
    case 'todo':
      return { case: 'todo', value: { edits: edit.value.map(writeTodoEdit) } };
    case 'text':
      return { case: 'text', value: writeText(edit.value) };
    case 'table':
      return {
        case: 'table',
        value: { table: writeTable(edit.value), widthChange: edit.widthChange },
      };
    case 'embedSource':
      return { case: 'embedSource', value: edit.value };
    case 'embedState':
      return { case: 'embedState', value: { state: fromJson(ValueSchema, writeJson(edit.value)) } };
    case 'sticker':
      return {
        case: 'sticker',
        value: { stickerId: edit.value.id, fallback: edit.value.fallback },
      };
    case 'crop':
      return { case: 'crop', value: edit.value };
  }
}

export function writeContent(
  { boardId, commandId, objectId, expectedPayloadVersion, edit }: EditObjectContentCommand,
  resolveAsset: AssetResolver,
): MessageInitShape<typeof EditObjectContentRequestSchema> {
  return {
    boardId,
    commandId,
    objectId,
    expectedPayloadVersion,
    edit: writeContentEdit(edit, resolveAsset),
  };
}

export function writeInitialPayload(
  payload: WhiteboardInitialPayload | undefined,
  resolveAsset: AssetResolver,
): MessageInitShape<typeof ObjectPayloadSchema> | undefined {
  if (!payload) {
    return;
  }

  switch (payload.kind) {
    case 'text':
      return { body: { case: 'text', value: writeText(payload.value) } };
    case 'document':
      return { body: { case: 'document', value: writeDocument(payload.value, resolveAsset) } };
    case 'todo': {
      const { title, items } = payload.value;

      return { body: { case: 'todo', value: { title, items: items.map(writeTodoItem) } } };
    }
    case 'sticker': {
      const { id, fallback } = payload.value;

      return { body: { case: 'sticker', value: { stickerId: id, fallback } } };
    }
    case 'embed':
      return { body: { case: 'embed', value: { ...payload.value, sourceRevision: 0n } } };
    case 'ink':
      return { body: { case: 'ink', value: { points: [...payload.points] } } };
  }
}
