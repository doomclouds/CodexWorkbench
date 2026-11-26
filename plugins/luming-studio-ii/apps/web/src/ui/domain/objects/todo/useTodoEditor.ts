import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  TodoObjectChange,
  TodoObjectEdit,
  TodoObjectProps,
  TodoObjectSnapshot,
} from './contracts.js';
import {
  applyTodoObjectEdit,
  defaultTodoTitle,
  maxTodoItems,
  maxTodoTextBytes,
  sameTodoContent,
} from './todo-edit.js';

export type TodoDraftTarget = { kind: 'title' } | { kind: 'new' } | { kind: 'item'; id: string };

interface TodoDraft {
  target: TodoDraftTarget;
  base: TodoObjectSnapshot;
  text: string;
}

interface PendingTodoEdit {
  edit: TodoObjectEdit;
  preview: TodoObjectSnapshot;
  keepAdding: boolean;
}

export class TodoContentConflict extends Error {
  constructor(
    message: string,
    readonly current?: TodoObjectSnapshot,
  ) {
    super(message);
    this.name = 'TodoContentConflict';
  }
}

const saveError = '清单草稿未保存。';
const invalidEdit = '任务更改无效。';
const tooManyLines = '粘贴的任务过多，请分批添加。';

function newestSnapshot(value: TodoObjectSnapshot, receipt?: TodoObjectSnapshot) {
  return receipt && receipt.revision > value.revision ? receipt : value;
}

function canReconcile(value: TodoObjectSnapshot, pending?: PendingTodoEdit) {
  if (!pending || value.revision <= pending.edit.expectedRevision) {
    return false;
  }

  return sameTodoContent(value, pending.preview);
}

function insertedItem(text: string): TodoObjectChange {
  return { op: 'insert', item: { id: 'task-' + crypto.randomUUID(), text, checked: false } };
}

function editOf(base: TodoObjectSnapshot, changes: readonly TodoObjectChange[]): TodoObjectEdit {
  return { objectId: base.id, expectedRevision: base.revision, changes };
}

function validReceipt(receipt: TodoObjectSnapshot | false, edit: TodoObjectEdit) {
  return receipt && receipt.id === edit.objectId && receipt.revision > edit.expectedRevision;
}

export function useTodoEditor({
  value,
  onEdit,
  editable,
  dragging,
  editRequest,
  onEditingChange,
}: Pick<TodoObjectProps, 'value' | 'onEdit' | 'editRequest' | 'onEditingChange'> & {
  editable: boolean;
  dragging: boolean;
}) {
  const [receipt, setReceipt] = useState<TodoObjectSnapshot>();
  const [draft, setDraft] = useState<TodoDraft>();
  const [pending, setPending] = useState<PendingTodoEdit>();
  const [error, setError] = useState<string>();
  const [conflicted, setConflicted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastRequest, setLastRequest] = useState<number>();
  const saving = useRef(false);
  const editorFocused = useRef(false);
  const current = newestSnapshot(value, receipt);
  const writable = editable && !busy && !pending;
  const reconciled = !busy && canReconcile(current, pending);
  if (reconciled) {
    setPending(undefined);
    setDraft(undefined);
    setError(undefined);
    setConflicted(false);
  }
  if (editRequest !== undefined && editRequest !== lastRequest && writable) {
    const first = current.items[0];
    const target: TodoDraftTarget = first ? { kind: 'item', id: first.id } : { kind: 'new' };
    setLastRequest(editRequest);
    setError(undefined);
    setDraft({ target, base: current, text: first?.text ?? '' });
  }

  const isEditing = Boolean(draft || pending || dragging);
  const notifyEditing = useEffectEvent((active: boolean) => onEditingChange?.(active));
  useEffect(() => {
    notifyEditing(isEditing);
  }, [isEditing]);
  useEffect(() => () => notifyEditing(false), []);

  function start(target: TodoDraftTarget, text: string) {
    const full = target.kind === 'new' && current.items.length >= maxTodoItems;
    if (!writable || full) {
      return;
    }

    setError(undefined);
    setDraft({ target, base: current, text });
  }

  async function save(change: PendingTodoEdit) {
    if (!editable || !onEdit || saving.current) {
      return;
    }

    saving.current = true;
    setPending(change);
    setBusy(true);
    setError(undefined);
    setConflicted(false);
    try {
      const result = await onEdit(change.edit);
      if (!result || !validReceipt(result, change.edit)) {
        throw new Error(saveError);
      }

      setReceipt(result);
      setPending(undefined);
      const continueEditing = change.keepAdding && editorFocused.current;
      setDraft((previous) =>
        continueEditing && previous ? { ...previous, base: result, text: '' } : undefined,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function submit(change: PendingTodoEdit) {
    save(change).catch((failure: unknown) => {
      if (failure instanceof TodoContentConflict) {
        setConflicted(true);
        const confirmed = failure.current;
        if (confirmed) {
          setReceipt((previous) => newestSnapshot(confirmed, previous));
        }
      }

      setError(failure instanceof Error ? failure.message : saveError);
    });
  }

  function changeRows(changes: readonly TodoObjectChange[], base = current, keepAdding = false) {
    if (!writable || saving.current) {
      return;
    }

    const edit = editOf(base, changes);
    try {
      const preview = applyTodoObjectEdit(base, edit);
      if (preview) {
        submit({ edit, preview, keepAdding });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : invalidEdit);
    }
  }

  function addRows(lines: readonly string[], base: TodoObjectSnapshot, keepAdding: boolean) {
    const size = base.items.length + lines.length;
    if (size > maxTodoItems) {
      setError('清单最多可保存 200 行。');
      return;
    }

    changeRows(lines.map(insertedItem), base, keepAdding && size < maxTodoItems);
  }

  function commit(keepAdding = false) {
    if (!draft || !writable || saving.current) {
      return;
    }

    const { base, target } = draft;
    const text = draft.text.trim();
    if (target.kind === 'new') {
      if (text) {
        addRows([text], base, keepAdding);
      } else if (!keepAdding) {
        setDraft(undefined);
      }

      return;
    }

    const change = changeOfDraft(base, target, text);
    if (!change) {
      setDraft(undefined);
      return;
    }

    changeRows([change], base);
  }

  function paste(text: string) {
    const allowed = !draft || draft.target.kind === 'new';
    if (!writable || !allowed || !/[\r\n]/u.test(text)) {
      return false;
    }

    if (text.length > maxTodoItems * (maxTodoTextBytes + 2)) {
      setError(tooManyLines);
      return true;
    }

    const lines = text
      .split(/\r\n?|\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return false;
    }

    addRows(lines, draft?.base ?? current, true);

    return true;
  }

  function cancel() {
    if (!pending) {
      setDraft(undefined);
      setError(undefined);
    }
  }

  function setText(text: string) {
    setDraft((previous) => (previous ? { ...previous, text } : undefined));
  }

  function trackFocus(focused: boolean) {
    editorFocused.current = focused;
  }

  function retry() {
    if (pending && !conflicted) {
      submit(pending);
    }
  }

  function discardConflict() {
    if (!conflicted || saving.current) {
      return;
    }

    setPending(undefined);
    setDraft(undefined);
    setError(undefined);
    setConflicted(false);
  }

  const projection = draft ? current : (pending?.preview ?? current);

  return {
    draft,
    busy,
    pending: Boolean(pending),
    conflicted,
    error,
    writable,
    projection,
    start,
    changeRows,
    commit,
    paste,
    cancel,
    setText,
    trackFocus,
    retry,
    discardConflict,
  };
}

function changeOfDraft(
  base: TodoObjectSnapshot,
  target: Exclude<TodoDraftTarget, { kind: 'new' }>,
  text: string,
): TodoObjectChange | undefined {
  if (target.kind === 'title') {
    const title = text || defaultTodoTitle;

    return title === base.title ? undefined : { op: 'rename', title };
  }

  const original = base.items.find(({ id }) => id === target.id);

  return original?.text === text ? undefined : { op: 'update', id: target.id, changes: { text } };
}

export type TodoEditorSession = ReturnType<typeof useTodoEditor>;
