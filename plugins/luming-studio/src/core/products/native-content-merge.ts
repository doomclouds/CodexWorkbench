import {
  applyDocumentOperations,
  flattenDocumentBlocks,
  type DocumentBlock,
  type DocumentBlockOperation,
  type DocumentContent,
} from '../../contracts/document.js';
import type { BoardElement, Operation } from '../../contracts/studio.js';
import {
  applyTodoOperations,
  normalizeTodoItems,
  type TodoItem,
  type TodoOperation,
} from '../../contracts/todo.js';
import { jsonEqual, mergeConflictDetails } from '../../shared/safe-merge.js';
import { object, StudioError } from '../shared/common.js';
import type { StructuredMergeEvidence } from '../shared/model.js';
import { nativeChildIds } from './child-incarnations.js';

interface Slot {
  previous: string | null;
  next: string | null;
}

interface Position {
  parentId: string | null;
  slot: Slot;
}

interface DocumentLocation {
  block: DocumentBlock;
  parent: string | null;
  siblings: readonly DocumentBlock[];
  index: number;
}

interface DocumentWitness {
  target?: DocumentLocation;
  targetSlot?: Slot;
  destination?: Position;
}

interface TodoWitness {
  item?: TodoItem;
  source?: Slot;
  destination?: Slot;
}

type VerifyIds = (ids: readonly (string | null | undefined)[]) => void;

function conflict(path: string, base: unknown, local: unknown, current: unknown): never {
  throw new StudioError(
    'CONFLICT',
    '原生内容的代际、位置或内容已变化，请保留本地修改并比较最新内容。',
    mergeConflictDetails(base, local, current, [path]),
  );
}

function sameGeneration(evidence: StructuredMergeEvidence, path: string): VerifyIds {
  const originalIds = new Set(nativeChildIds(evidence.original as BoardElement));
  const births = evidence.incarnations.inserted;
  return (ids) => {
    const replaced = ids.find(
      (id) =>
        typeof id === 'string' &&
        originalIds.has(id) &&
        (Object.hasOwn(births, id) ? births[id]! : 0) > evidence.expectedVersion,
    );

    if (replaced !== undefined) {
      conflict(path + '.' + replaced, null, null, null);
    }
  };
}

function slotAt(items: readonly { id: string }[], index: number, skip = 0): Slot {
  return {
    previous: items[index - 1]?.id ?? null,
    next: items[index + skip]?.id ?? null,
  };
}

function afterSlot(items: readonly { id: string }[], anchor: string | null | undefined) {
  if (anchor === undefined) {
    return slotAt(items, items.length);
  }
  if (anchor === null) {
    return slotAt(items, 0);
  }

  const index = items.findIndex((item) => item.id === anchor);
  return index < 0 ? undefined : slotAt(items, index + 1);
}

function verifySlot(
  base: Slot | undefined,
  current: Slot | undefined,
  verifyIds: VerifyIds,
  path: string,
) {
  if (!base || !current || !jsonEqual(base, current)) {
    conflict(path, base, null, current);
  }

  verifyIds([base.previous, base.next]);
}

function locateDocumentBlock(
  siblings: readonly DocumentBlock[],
  id: string,
  parent: string | null = null,
): DocumentLocation | undefined {
  for (const [index, block] of siblings.entries()) {
    if (block.id === id) {
      return { block, parent, siblings, index };
    }

    if (block.children?.length) {
      const match = locateDocumentBlock(block.children, id, block.id);
      if (match) {
        return match;
      }
    }
  }
}

function documentDestination(
  blocks: readonly DocumentBlock[],
  operation: Extract<DocumentBlockOperation, { op: 'insert' | 'move' }>,
): Position | undefined {
  const parentId = operation.parentId ?? null;
  const parent = parentId ? locateDocumentBlock(blocks, parentId) : undefined;
  if (parentId && !parent) {
    return;
  }

  const siblings = parent ? (parent.block.children ?? []) : blocks;
  const destination =
    operation.op === 'move' ? siblings.filter((block) => block.id !== operation.id) : siblings;
  const slot = afterSlot(destination, operation.afterId);
  return slot && { parentId, slot };
}

function documentWitness(
  draft: DocumentContent,
  operation: DocumentBlockOperation,
): DocumentWitness {
  if (operation.op === 'insert') {
    return { destination: documentDestination(draft.blocks, operation) };
  }

  const location = locateDocumentBlock(draft.blocks, operation.id);
  if (operation.op === 'move') {
    return {
      target: location,
      targetSlot: location && slotAt(location.siblings, location.index, 1),
      destination: documentDestination(draft.blocks, operation),
    };
  }

  return { target: location };
}

function ownBlockContent({ type, props, content }: DocumentBlock) {
  return { type, props, content };
}

function verifyDocumentTarget(
  operation: Exclude<DocumentBlockOperation, { op: 'insert' }>,
  base: DocumentWitness,
  current: DocumentWitness,
  verifyIds: VerifyIds,
) {
  const a = base.target;
  const b = current.target;
  const path = 'document.blocks.' + operation.id;
  if (!a || !b || a.parent !== b.parent) {
    conflict(path, a?.block, null, b?.block);
  }

  verifyIds([operation.id, a.parent]);
  if (operation.op === 'move') {
    verifySlot(base.targetSlot, current.targetSlot, verifyIds, path + '.position');
  }
  if (operation.op === 'delete') {
    verifyIds(flattenDocumentBlocks([a.block]).map((block) => block.id));
    if (!jsonEqual(a.block, b.block)) {
      conflict(path, a.block, null, b.block);
    }
  }
  if (operation.op === 'update') {
    const before = ownBlockContent(a.block);
    const after = ownBlockContent(b.block);
    const requested = { ...before, ...operation.changes };
    if (!jsonEqual(before, after) && !jsonEqual(requested, after)) {
      conflict(path, before, requested, after);
    }
  }
}

function verifyDocumentOperation(
  operation: DocumentBlockOperation,
  base: DocumentWitness,
  current: DocumentWitness,
  verifyIds: VerifyIds,
) {
  if (operation.op !== 'insert') {
    verifyDocumentTarget(operation, base, current, verifyIds);
  }
  if (operation.op === 'insert' || operation.op === 'move') {
    const path = 'document.position';
    const a = base.destination;
    const b = current.destination;
    if (!a || !b || a.parentId !== b.parentId) {
      conflict(path, a, null, b);
    }

    verifyIds([a.parentId, operation.afterId]);
    verifySlot(a.slot, b.slot, verifyIds, path);
  }
}

function rebaseDocument(
  operation: Operation,
  base: BoardElement,
  current: BoardElement,
  evidence: StructuredMergeEvidence,
) {
  if (!base.document || !current.document) {
    conflict('document', base.document, null, current.document);
  }

  const operations = operation.data?.operations as DocumentBlockOperation[];
  const verifyIds = sameGeneration(evidence, 'document.blocks');
  const witnesses: DocumentWitness[] = [];
  const document = applyDocumentOperations(base.document, operations, (draft, edit) => {
    witnesses.push(documentWitness(draft, edit));
  });
  let index = 0;
  applyDocumentOperations(current.document, operations, (draft, edit) => {
    verifyDocumentOperation(edit, witnesses[index++]!, documentWitness(draft, edit), verifyIds);
  });

  return { operation, local: { ...base, document } };
}

function todoWitness(items: readonly TodoItem[], operation: TodoOperation): TodoWitness {
  if (operation.op === 'insert') {
    return { destination: afterSlot(items, operation.afterId) };
  }

  const index = items.findIndex((item) => item.id === operation.id);
  const item = items[index];
  if (operation.op === 'move') {
    return {
      item,
      source: item && slotAt(items, index, 1),
      destination: afterSlot(
        items.filter((row) => row.id !== operation.id),
        operation.afterId,
      ),
    };
  }

  return { item };
}

function verifyTodoUpdate(
  operation: Extract<TodoOperation, { op: 'update' }>,
  base: TodoItem,
  current: TodoItem,
  path: string,
) {
  const fields = ['text', 'checked', 'sourceRef'] as const;
  for (const field of fields) {
    const value = operation.changes[field];
    if (value === undefined) {
      continue;
    }

    const requested = value === null ? undefined : value;
    if (!jsonEqual(base[field], current[field]) && !jsonEqual(requested, current[field])) {
      conflict(path + '.' + field, base[field], requested, current[field]);
    }
  }
}

function verifyTodoOperation(
  operation: TodoOperation,
  base: TodoWitness,
  current: TodoWitness,
  verifyIds: VerifyIds,
) {
  if (operation.op === 'insert') {
    verifyIds([operation.afterId]);
    verifySlot(base.destination, current.destination, verifyIds, 'data.items.position');
    return;
  }

  const path = 'data.items.' + operation.id;
  if (!base.item || !current.item) {
    conflict(path, base.item, null, current.item);
  }

  verifyIds([operation.id]);
  if (operation.op === 'update') {
    verifyTodoUpdate(operation, base.item, current.item, path);
  }
  if (operation.op === 'delete' && !jsonEqual(base.item, current.item)) {
    conflict(path, base.item, null, current.item);
  }
  if (operation.op === 'move') {
    verifyIds([operation.afterId]);
    verifySlot(base.source, current.source, verifyIds, path + '.position');
    verifySlot(base.destination, current.destination, verifyIds, path + '.position');
  }
}

function rebaseTodo(
  operation: Operation,
  base: BoardElement,
  current: BoardElement,
  evidence: StructuredMergeEvidence,
) {
  const operations = operation.data?.operations as TodoOperation[];
  const verifyIds = sameGeneration(evidence, 'data.items');
  const witnesses: TodoWitness[] = [];
  const items = applyTodoOperations(
    normalizeTodoItems(base.data?.items),
    operations,
    (rows, edit) => {
      witnesses.push(todoWitness(rows, edit));
    },
  );
  let index = 0;
  applyTodoOperations(normalizeTodoItems(current.data?.items), operations, (rows, edit) => {
    verifyTodoOperation(edit, witnesses[index++]!, todoWitness(rows, edit), verifyIds);
  });

  return { operation, local: { ...base, data: { ...base.data, items } } };
}

export function rebaseNativeContent(
  operation: Operation,
  base: unknown,
  current: unknown,
  evidence: StructuredMergeEvidence,
) {
  if (!object(base) || !object(current) || base.type !== current.type) {
    conflict('.', base, null, current);
  }

  const original = base as unknown as BoardElement;
  const live = current as unknown as BoardElement;
  if (operation.op === 'document' && original.type === 'document') {
    return rebaseDocument(operation, original, live, evidence);
  }
  if (operation.op === 'todo' && original.type === 'todo') {
    return rebaseTodo(operation, original, live, evidence);
  }

  return conflict('.', base, null, current);
}
