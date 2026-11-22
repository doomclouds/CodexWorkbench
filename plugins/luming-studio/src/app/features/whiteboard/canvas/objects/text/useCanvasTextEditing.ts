import { useEffect, useRef, useState } from 'react';
import type { Board, BoardElement, Operation } from '../../../../../../contracts/studio.js';
import { newClientId } from '../../../../../shared/client-id.js';
import { makeElement } from '../../scene/canvas-model.js';
import type { TextDraft } from '../../sync/canvas-drafts.js';
import type { ContentTask, NativeContentQueue } from '../../sync/content-queue.js';
import { useCommittedRef } from '../../useCommittedRef.js';
import {
  createTextDraft,
  linksToText,
  textDraftChanged,
  type EmptyTextDelete,
} from './text-draft.js';

export function useCanvasTextEditingState() {
  const [editing, setEditing] = useState<TextDraft | null>(null);
  const newTextIds = useRef(new Set<string>());
  const [pendingDelete, setPendingDelete] = useState<EmptyTextDelete>();
  const pendingDeleteRef = useRef<EmptyTextDelete | undefined>(undefined);

  return {
    editing,
    setEditing,
    pendingDelete,
    readPendingDelete: () => pendingDeleteRef.current,
    trackPendingDelete(next: EmptyTextDelete | undefined) {
      pendingDeleteRef.current = next;
      setPendingDelete(next);
    },
    rememberCreatedText(elements: readonly BoardElement[]) {
      for (const element of elements) {
        if (element.type === 'text') {
          newTextIds.current.add(element.id);
        }
      }
    },
    isNewText: (id: string) => newTextIds.current.has(id),
    forgetNewText: (id: string) => newTextIds.current.delete(id),
  };
}

interface TextEditingCommandOptions {
  state: ReturnType<typeof useCanvasTextEditingState>;
  canEdit: boolean;
  canAutosave: boolean;
  textDirty: boolean;
  queueDrafts: readonly ContentTask[];
  reportCanvasFailure: (failure: unknown) => void;
  pendingTextDiffers: boolean;
  isReading: () => boolean;
  onBeginEditing: () => void;
  readBoard: () => Board;
  readIntendedElements: () => BoardElement[];
  readEditorHeight: () => number | undefined;
  focusViewport: () => void;
  queue: Pick<NativeContentQueue, 'tasks' | 'discard'>;
  deselectDeletedText: (id: string) => void;
  setError: (message: string) => void;
  apply: (
    operations: Operation[],
    summary: string,
    sources: BoardElement[],
    remember?: boolean,
    operationId?: string,
  ) => Promise<Board | null>;
  addAdjacentText: (element: BoardElement) => Promise<Board | null>;
}

function changesForTextDraft(
  editing: TextDraft,
  current: BoardElement,
  base: BoardElement,
  editorHeight?: number,
) {
  const padded = ['note', 'shape'].includes(base.type);
  const shouldFit =
    editorHeight !== undefined && !base.locked && ['text', 'note', 'shape'].includes(base.type);
  const fitted = shouldFit ? Math.max(current.h, editorHeight + (padded ? 32 : 0)) : current.h;

  return {
    ...(base.type === 'arrow' ? { label: editing.text } : { text: editing.text }),
    ...(base.bold ? { bold: false } : {}),
    ...(base.italic ? { italic: false } : {}),
    ...(fitted > current.h ? { h: fitted } : {}),
  };
}

function adjacentText(base: BoardElement, current: BoardElement) {
  const below = base.type === 'text';

  return makeElement(
    base.type,
    { x: current.x + (below ? 0 : current.w + 24), y: current.y + (below ? current.h + 24 : 0) },
    {
      w: current.w,
      h: current.h,
      kind: current.kind,
      fill: current.fill,
      color: current.color,
      fontSize: current.fontSize,
      text: '',
    },
  );
}

export function useCanvasTextEditingCommands({
  state,
  canEdit,
  canAutosave,
  textDirty,
  queueDrafts,
  reportCanvasFailure,
  pendingTextDiffers,
  isReading,
  onBeginEditing,
  readBoard,
  readIntendedElements,
  readEditorHeight,
  focusViewport,
  queue,
  deselectDeletedText,
  setError,
  apply,
  addAdjacentText,
}: TextEditingCommandOptions) {
  const { editing, setEditing } = state;

  function beginEditing(element: BoardElement) {
    const separateEditor = [
      'html',
      'document',
      'image',
      'table',
      'todo',
      'stroke',
      'diagram',
      'chart',
    ].includes(element.type);

    if (isReading() || separateEditor) {
      return;
    }

    onBeginEditing();
    setEditing(createTextDraft(element));
  }

  async function commitEmptyText(
    draft: TextDraft,
    current: BoardElement,
    base: BoardElement,
    close: boolean,
  ) {
    if (!close) {
      return readBoard();
    }

    const cleanup = state.isNewText(current.id) || !!(draft.initialText ?? base.text ?? '').trim();
    if (!cleanup) {
      setEditing(null);

      return readBoard();
    }

    const linked = readBoard().elements.filter((element) => linksToText(element, current.id));
    const intended = readIntendedElements();
    const locked = (element: BoardElement) =>
      (intended.find((value) => value.id === element.id) ?? element).locked;

    if (locked(current) || linked.some(locked)) {
      setError('此文字或关联连线已锁定，不能通过清空删除。请先解锁；原内容和本地草稿已保留。');

      return null;
    }

    const previous = state.readPendingDelete();
    const operationId =
      previous?.elementId === current.id &&
      queue.tasks.some((task) => task.id === previous.operationId)
        ? previous.operationId
        : newClientId('op');
    state.trackPendingDelete({ elementId: current.id, operationId });
    const saved = await apply(
      [{ op: 'delete', id: current.id }],
      '删除空文字',
      [base, ...linked],
      true,
      operationId,
    );

    if (saved) {
      state.trackPendingDelete(undefined);
      state.forgetNewText(current.id);
      setEditing(null);
      deselectDeletedText(current.id);
    }

    return saved;
  }

  async function commitEditing(adjacent = false, close = true) {
    if (!canEdit || !editing) {
      return;
    }

    const current = readBoard().elements.find((element) => element.id === editing.id);
    if (!current) {
      setError('此对象已被删除。文字草稿仍保留，可复制后使用。');

      return;
    }

    const base = editing.base ?? current;
    const emptyText = current.type === 'text' && base.type === 'text' && !editing.text.trim();
    if (emptyText) {
      return commitEmptyText(editing, current, base, close);
    }

    const changed = pendingTextDiffers || textDraftChanged(editing, base);
    const changes = changesForTextDraft(editing, current, base, readEditorHeight());
    const saved = changed
      ? await apply([{ op: 'update', id: editing.id, changes }], '编辑文字', [base])
      : readBoard();

    if (!saved) {
      return saved;
    }

    if (close) {
      setEditing((value) =>
        value?.id === editing.id && value.text === editing.text ? null : value,
      );
    }
    if (adjacent && ['text', 'note', 'shape', 'container'].includes(base.type)) {
      await addAdjacentText(adjacentText(base, current));
    }

    return saved;
  }

  const handleCancelEmptyText = () => {
    const pending = state.readPendingDelete();
    if (editing && pending?.elementId === editing.id) {
      const task = queue.tasks.find(
        (item) => item.id === pending.operationId && item.state === 'failed',
      );

      if (task) {
        queue.discard(task.id);
      }
      state.trackPendingDelete(undefined);
    }
    setEditing(null);
    setError('');
    requestAnimationFrame(focusViewport);
  };

  useCanvasTextAutosave({
    editing,
    canSave: canAutosave,
    textDirty,
    queueDrafts,
    commit: () => {
      commitEditing(false, false).catch(reportCanvasFailure);
    },
  });

  return { beginEditing, commitEditing, handleCancelEmptyText };
}

interface TextAutosaveOptions {
  editing: TextDraft | null;
  canSave: boolean;
  textDirty: boolean;
  queueDrafts: readonly ContentTask[];
  commit: () => void;
}

function useCanvasTextAutosave({
  editing,
  canSave,
  textDirty,
  queueDrafts,
  commit,
}: TextAutosaveOptions) {
  const liveCommit = useCommittedRef(commit);
  const textWaitStarted = useRef<number | null>(null);
  const editingId = editing?.id;
  const failedTextDraft = queueDrafts.some(
    (task) => task.state === 'failed' && task.keys.includes(editingId ?? ''),
  );
  useEffect(() => {
    if (!canSave || !textDirty || failedTextDraft) {
      textWaitStarted.current = null;
      return;
    }
    textWaitStarted.current ??= Date.now();
    const timeout = setTimeout(
      () => {
        textWaitStarted.current = null;
        liveCommit.current();
      },
      Math.max(0, Math.min(250, 1000 - (Date.now() - textWaitStarted.current))),
    );

    return () => clearTimeout(timeout);
  }, [editing?.text, editingId, textDirty, canSave, failedTextDraft, liveCommit]);
}
