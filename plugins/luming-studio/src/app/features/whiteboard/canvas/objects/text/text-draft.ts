import type { BoardElement, Operation } from '../../../../../../contracts/studio.js';
import { mergeJson } from '../../../../../../shared/safe-merge.js';
import type { TextDraft } from '../../sync/canvas-drafts.js';
import type { ContentTask } from '../../sync/content-queue.js';

export interface EmptyTextDelete {
  elementId: string;
  operationId: string;
}

function elementText(element?: BoardElement) {
  return (element?.type === 'arrow' ? element.label : element?.text) ?? '';
}

export function createTextDraft(element: BoardElement): TextDraft {
  let text = elementText(element);
  if (element.bold) {
    text = `**${text}**`;
  }
  if (element.italic) {
    text = `_${text}_`;
  }

  return { id: element.id, text, base: element, initialText: text };
}

export function refreshTextDraft(
  editing: TextDraft | null,
  elements: readonly BoardElement[],
  tasks: readonly ContentTask[],
) {
  if (!editing || editing.text !== editing.initialText) {
    return editing;
  }
  if (tasks.some((task) => task.keys.includes(editing.id))) {
    return editing;
  }

  const remote = elements.find(
    (element) => element.id === editing.id && element.type === editing.base?.type,
  );

  if (!remote || remote.version === editing.base?.version) {
    return editing;
  }

  return { ...editing, ...createTextDraft(remote) };
}

export function acceptTextDraft(
  editing: TextDraft | null,
  task: ContentTask,
  elements: readonly BoardElement[],
) {
  if (!editing) {
    return editing;
  }

  const operations = (task.args?.operations as Operation[] | undefined) ?? task.operations;
  const savedOperation = operations.find((operation) => updatesText(operation, editing.id));
  const next = elements.find((element) => element.id === editing.id);
  if (!savedOperation || !next) {
    return editing;
  }

  const acceptedText = String(elementText(next));
  const submitted = savedOperation.changes?.[next.type === 'arrow' ? 'label' : 'text'];
  const merged = mergeJson(String(submitted ?? ''), editing.text, acceptedText);

  return merged.conflicts.length
    ? editing
    : { ...editing, base: next, text: String(merged.result), initialText: acceptedText };
}

function updatesText(operation: Operation, id: string) {
  const changesText =
    typeof operation.changes?.text === 'string' || typeof operation.changes?.label === 'string';

  return operation.op === 'update' && operation.id === id && changesText;
}

export function textDraftChanged(editing: TextDraft, base?: BoardElement) {
  return editing.text !== (editing.initialText ?? elementText(base));
}

export function linksToText(element: BoardElement, id: string) {
  return element.type === 'arrow' && (element.from === id || element.to === id);
}

function hasPendingTextChange(editing: TextDraft, tasks: readonly ContentTask[]) {
  return tasks.some(
    (task) =>
      task.keys.includes(editing.id) &&
      task.operations.some((operation) => {
        const { text, label } = operation.changes ?? {};
        const changesText = typeof text === 'string' && text !== editing.text;
        const changesLabel = typeof label === 'string' && label !== editing.text;
        return operation.op === 'update' && (changesText || changesLabel);
      }),
  );
}

interface TextDraftDescriptionOptions {
  editing: TextDraft | null;
  elements: readonly BoardElement[];
  projectedElements: readonly BoardElement[];
  tasks: readonly ContentTask[];
  taskView: readonly ContentTask[];
  pendingDelete?: EmptyTextDelete;
}

export function describeCanvasTextDraft({
  editing,
  elements,
  projectedElements,
  tasks,
  taskView,
  pendingDelete,
}: TextDraftDescriptionOptions) {
  if (!editing) {
    return {
      emptyTextBlocked: false,
      failedEmptyTextDelete: undefined,
      pendingTextDiffers: false,
      textDirty: false,
    };
  }

  const base = editing.base ?? elements.find((element) => element.id === editing.id);
  const emptyText = base?.type === 'text' && !editing.text.trim();
  const emptyTextBlocked =
    emptyText &&
    projectedElements.some(
      (element) =>
        element.locked && (element.id === editing.id || linksToText(element, editing.id)),
    );
  const failedEmptyTextDelete =
    pendingDelete?.elementId === editing.id
      ? taskView.find((task) => task.id === pendingDelete.operationId && task.state === 'failed')
      : undefined;
  const pendingTextDiffers = hasPendingTextChange(editing, tasks);

  return {
    emptyTextBlocked,
    failedEmptyTextDelete,
    pendingTextDiffers,
    textDirty: pendingTextDiffers || textDraftChanged(editing, base),
  };
}
