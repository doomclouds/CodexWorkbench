import type {
  EditObjectContentOperation,
  WhiteboardDocumentBlock,
  WhiteboardDocumentContent,
  WhiteboardJson,
  WhiteboardTodoChange,
  WhiteboardTodoItem,
  WhiteboardTodoSource,
} from '../../data/whiteboard/index.js';
import type { CanvasObjectIntent, CanvasObjectKind } from '../../ui/domain/canvas/index.js';
import { readNativeContentEdit } from './content-edit-native.js';
import { isJson, list, maxContentTreeDepth, record } from './content-edit-value.js';

const textKinds = new Set<CanvasObjectKind>(['text', 'note', 'shape', 'section', 'connector']);
const writableKinds = new Set<CanvasObjectKind>([
  'document',
  'todo',
  ...textKinds,
  'table',
  'html',
  'diagram',
  'sticker',
  'image',
  'link',
]);

function jsonRecord(value: unknown): value is Record<string, WhiteboardJson> {
  return record(value) && Object.values(value).every((item) => isJson(item));
}

function documentBlocks(values: unknown, depth: number): WhiteboardDocumentBlock[] | undefined {
  if (!list(values)) {
    return undefined;
  }

  const blocks: WhiteboardDocumentBlock[] = [];
  for (const value of values) {
    const block = documentBlock(value, depth);
    if (!block) {
      return undefined;
    }

    blocks.push(block);
  }

  return blocks;
}

function documentBlock(value: unknown, depth: number): WhiteboardDocumentBlock | undefined {
  if (!record(value) || depth >= maxContentTreeDepth) {
    return undefined;
  }

  const { id, type, props, content, children: nested } = value;
  if (typeof id !== 'string' || typeof type !== 'string' || !jsonRecord(props)) {
    return undefined;
  }
  if (content !== undefined && !isJson(content)) {
    return undefined;
  }

  const children = nested === undefined ? undefined : documentBlocks(nested, depth + 1);
  if (nested !== undefined && children === undefined) {
    return undefined;
  }

  return { id, type, props, content, children };
}

function documentContent(value: unknown): WhiteboardDocumentContent | undefined {
  if (!record(value) || typeof value.title !== 'string' || !record(value.document)) {
    return undefined;
  }

  const { schemaVersion, blocks: source } = value.document;
  if (schemaVersion !== 1) {
    return undefined;
  }

  const blocks = documentBlocks(source, 0);

  return blocks && { title: value.title, document: { schemaVersion, blocks } };
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isTodoSource(value: unknown): value is WhiteboardTodoSource {
  if (!record(value) || typeof value.elementId !== 'string') {
    return false;
  }

  const { artifactId, blockId, itemId, version } = value;
  const validVersion =
    version === undefined ||
    (typeof version === 'number' && Number.isSafeInteger(version) && version >= 0);

  return validVersion && [artifactId, blockId, itemId].every(optionalText);
}

function isTodoItem(item: unknown): item is WhiteboardTodoItem {
  if (!record(item)) {
    return false;
  }

  return (
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    typeof item.checked === 'boolean' &&
    (item.sourceRef === undefined || isTodoSource(item.sourceRef))
  );
}

function isTodoItemChanges(
  changes: unknown,
): changes is Extract<WhiteboardTodoChange, { op: 'update' }>['changes'] {
  if (!record(changes)) {
    return false;
  }

  const { text, checked, sourceRef } = changes;

  return (
    optionalText(text) &&
    (checked === undefined || typeof checked === 'boolean') &&
    (sourceRef == null || isTodoSource(sourceRef))
  );
}

function isTodoChange(change: unknown): change is WhiteboardTodoChange {
  if (!record(change)) {
    return false;
  }

  const { op, id, afterId } = change;
  switch (op) {
    case 'rename':
      return typeof change.title === 'string';
    case 'insert':
      return isTodoItem(change.item) && (afterId === null || optionalText(afterId));
    case 'update':
      return typeof id === 'string' && isTodoItemChanges(change.changes);
    case 'delete':
      return typeof id === 'string';
    case 'move':
      return typeof id === 'string' && (afterId === null || typeof afterId === 'string');
    default:
      return false;
  }
}

function todoEdits(intent: CanvasObjectIntent): readonly WhiteboardTodoChange[] | undefined {
  const { value, objectId, expectedVersion } = intent;
  if (!record(value) || value.objectId !== objectId || value.expectedRevision !== expectedVersion) {
    return undefined;
  }

  const { changes } = value;

  return list(changes) && changes.length > 0 && changes.every(isTodoChange) ? changes : undefined;
}

export function isWritableContentKind(kind: CanvasObjectKind): boolean {
  return writableKinds.has(kind);
}

export function readContentEdit(
  intent: CanvasObjectIntent,
): EditObjectContentOperation | undefined {
  const { kind, name, value } = intent;
  if (kind === 'document' && name === 'document.commit') {
    const content = documentContent(value);

    return content && { kind: 'document', value: content };
  }
  if (kind === 'todo' && name === 'todo.edit') {
    const changes = todoEdits(intent);

    return changes && { kind: 'todo', value: changes };
  }
  const textChange = textKinds.has(kind) && name === 'text.commit';
  if (textChange && record(value) && typeof value.text === 'string') {
    return {
      kind: 'text',
      value: { text: value.text },
      ...(value.deleteEmpty === true ? { deleteEmpty: true } : {}),
    };
  }

  return readNativeContentEdit(intent);
}
