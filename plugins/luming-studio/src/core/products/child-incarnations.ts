import type { BoardElement, Operation } from '../../contracts/studio.js';
import { flattenDocumentBlocks, type DocumentBlockOperation } from '../../contracts/document.js';
import { normalizeTodoItems, type TodoOperation } from '../../contracts/todo.js';
import { object } from '../shared/common.js';
import type { ChildIncarnations, UnitClock } from '../shared/model.js';

export function nativeChildIds(element: BoardElement): string[] {
  if (element.type === 'document') {
    return flattenDocumentBlocks(element.document?.blocks ?? []).map((block) => block.id);
  }
  if (element.type === 'todo') {
    return normalizeTodoItems(element.data?.items).map((item) => item.id);
  }

  return [];
}

export function documentInsertedIds(operations: readonly DocumentBlockOperation[]): string[] {
  return operations.flatMap((operation) =>
    operation.op === 'insert'
      ? flattenDocumentBlocks([operation.block]).map((block) => block.id)
      : [],
  );
}

function insertedIds(operation: Operation) {
  if (operation.op === 'document') {
    return documentInsertedIds(operation.data?.operations as DocumentBlockOperation[]);
  }

  return (operation.data?.operations as TodoOperation[]).flatMap((item) =>
    item.op === 'insert' ? [item.item.id] : [],
  );
}

function resetIncarnations(version: number): ChildIncarnations {
  return { sinceVersion: version, throughVersion: version, inserted: {} };
}

function wholeContentReplacement(element: BoardElement, operation: Operation) {
  return (
    element.type === 'document' &&
    operation.op === 'update' &&
    Object.hasOwn(operation.changes ?? {}, 'document')
  );
}

function currentLineage(clock: UnitClock | undefined, previousVersion: number) {
  const children = clock?.children;
  if (children?.throughVersion === previousVersion && object(children.inserted)) {
    return children;
  }

  return resetIncarnations(previousVersion);
}

export function advanceChildIncarnations(
  element: BoardElement,
  previous: BoardElement | undefined,
  clock: UnitClock | undefined,
  operation: Operation | undefined,
): ChildIncarnations | undefined {
  if (element.type !== 'document' && element.type !== 'todo') {
    return;
  }
  if (!operation) {
    return;
  }

  const version = element.version;
  const sameRegion = previous?.type === element.type;
  const resetsContent = operation.op === 'restore' || wholeContentReplacement(element, operation);
  if (!sameRegion || resetsContent) {
    return resetIncarnations(version);
  }

  const lineage = currentLineage(clock, previous.version);
  if (operation.id !== element.id || operation.op !== element.type) {
    return { ...lineage, throughVersion: version };
  }

  const nextIds = new Set(nativeChildIds(element));
  const surviving = Object.entries(lineage.inserted).filter(([id]) => nextIds.has(id));
  const inserted = Object.fromEntries(surviving);
  for (const id of insertedIds(operation)) {
    if (nextIds.has(id)) {
      inserted[id] = version;
    }
  }

  return { ...lineage, throughVersion: version, inserted };
}
