import { ChevronRight, GripVertical, Link2, ListTodo, Maximize, Plus, Trash2 } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type MouseEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { BoardElement, Operation, StyleProfile } from '../../../../../../contracts/studio.js';
import {
  applyTodoOperations,
  normalizeTodoItems,
  TODO_ITEM_LIMIT,
  TODO_TEXT_BYTES,
  type TodoItem,
  type TodoOperation,
  type TodoSourceRef,
} from '../../../../../../contracts/todo.js';
import { documentSurface } from '../../../../../../shared/document-surface.js';
import { jsonEqual } from '../../../../../../shared/safe-merge.js';
import { newClientId } from '../../../../../shared/client-id.js';
import './todo-region.css';

export interface TodoRegionProps {
  element: BoardElement;
  interactive: boolean;
  canEdit: boolean;
  expanded?: boolean;
  overview?: boolean;
  uiScale?: number;
  annotationActive?: boolean;
  editRequest?: number;
  styleProfile?: StyleProfile;
  onMoveStart?(event: PointerEvent): void;
  onExpand(): void;
  onSave(operations: Operation[], base: BoardElement): Promise<BoardElement | false>;
  onEditingChange?(active: boolean): void;
  onOpenSource?(source: TodoSourceRef): void;
  sourceLabel?(source: TodoSourceRef): string | undefined;
  renderItemAdornment?(itemId: string): ReactNode;
  renderOutsideRows?(shownItemIds: readonly string[]): ReactNode;
  onAnnotateItem?(itemId: string, point?: { x: number; y: number }): void;
}

type EditorTarget = { kind: 'title' } | { kind: 'new' } | { kind: 'item'; id: string };
type Editor = { target: EditorTarget; base: BoardElement; value: string };
type Save = {
  base: BoardElement;
  operations: Operation[];
  items: TodoItem[];
  title: string;
  keepAdding: boolean;
};
type Drag = { id: string; over?: string; before?: boolean };
type RowAdornmentBox = { id: string; left: number; top: number; width: number; height: number };

const utf8 = new TextEncoder();
const titleOf = (element: BoardElement) => element.text?.trim() || '任务清单';
const itemLabel = (item: TodoItem) => item.text || '未命名任务';

function matchesSavedDraft(
  current: BoardElement,
  items: TodoItem[],
  pending: Save | null,
  busy: boolean,
) {
  if (!pending || busy || current.version <= pending.base.version) {
    return false;
  }

  return titleOf(current) === pending.title && jsonEqual(items, pending.items);
}

function visibleAdornments(
  items: TodoItem[],
  overview: boolean,
  render: TodoRegionProps['renderItemAdornment'],
) {
  const adornments = new Map<string, ReactNode>();
  if (overview || !render) {
    return adornments;
  }

  for (const item of items) {
    const content = render(item.id);
    if (content && (!Array.isArray(content) || content.length)) {
      adornments.set(item.id, content);
    }
  }

  return adornments;
}

function sameAdornmentBoxes(current: RowAdornmentBox[], next: RowAdornmentBox[]) {
  return (
    current.length === next.length &&
    current.every((box, index) => {
      const other = next[index]!;

      return (
        box.id === other.id &&
        box.left === other.left &&
        box.top === other.top &&
        box.width === other.width &&
        box.height === other.height
      );
    })
  );
}

function plainKey(event: KeyboardEvent) {
  return !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function dropPosition(drag: Drag | null, id: string) {
  if (drag?.over !== id) {
    return undefined;
  }

  return drag.before ? 'before' : 'after';
}

function handleBodyKey(event: KeyboardEvent<HTMLDivElement>) {
  const deletionKey = event.key === 'Delete' || event.key === 'Backspace';
  const directArrow = !event.ctrlKey && !event.metaKey && event.key.startsWith('Arrow');
  if (deletionKey || directArrow) {
    event.stopPropagation();
  }
}

function handleAnnotationPointer(event: PointerEvent<HTMLLIElement>) {
  if (event.button === 0) {
    event.stopPropagation();
  }
}

function displayedTodo(element: BoardElement, saved: BoardElement | null) {
  return saved?.id === element.id && saved.version > element.version ? saved : element;
}

function deriveTodoView(options: {
  interactive: boolean;
  expanded: boolean;
  overview: boolean;
  annotationActive: boolean;
  canEdit: boolean;
  canAnnotate: boolean;
  busy: boolean;
  editor: Editor | null;
  pending: Save | null;
  drag: Drag | null;
  storedItems: TodoItem[];
  current: BoardElement;
}) {
  const { interactive, expanded, annotationActive, editor, pending, drag } = options;
  const displayedDraft = editor ? null : pending;
  const items = displayedDraft?.items ?? options.storedItems;
  const title = displayedDraft?.title ?? titleOf(options.current);
  const needsDraftLayout = expanded || editor || pending;
  const active = (interactive || expanded) && !annotationActive;
  const editable = active && options.canEdit;

  return {
    active,
    editable,
    items,
    title,
    isOverview: options.overview && !needsDraftLayout,
    annotatingRows: annotationActive && options.canAnnotate,
    writable: editable && !options.busy && !pending,
    isEditing: Boolean(editor || pending || drag),
  };
}

function outsideTodoRows(
  render: TodoRegionProps['renderOutsideRows'],
  overview: boolean,
  items: TodoItem[],
) {
  return render?.(overview ? [] : items.map((item) => item.id));
}

function todoSurfaceStyle(
  surface: ReturnType<typeof documentSurface>,
  overview: boolean,
  uiScale: number,
) {
  return {
    '--todo-paper': surface.paper,
    '--todo-backdrop': surface.backdrop,
    '--todo-ink': surface.ink,
    '--todo-muted': surface.muted,
    '--todo-rule': surface.rule,
    '--todo-link': surface.link,
    '--todo-ui-scale': overview ? uiScale : 1,
    colorScheme: surface.scheme,
  } as CSSProperties;
}

export default function TodoRegion({
  element,
  interactive,
  canEdit,
  expanded = false,
  overview = false,
  uiScale = 1,
  annotationActive = false,
  editRequest,
  styleProfile,
  onMoveStart,
  onExpand,
  onSave,
  onEditingChange,
  onOpenSource,
  sourceLabel,
  renderItemAdornment,
  renderOutsideRows,
  onAnnotateItem,
}: TodoRegionProps) {
  const [saved, setSaved] = useState<BoardElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState<Save | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adornmentBoxes, setAdornmentBoxes] = useState<RowAdornmentBox[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const request = useRef<number | undefined>(undefined);
  const activity = useRef(onEditingChange);
  useLayoutEffect(() => {
    activity.current = onEditingChange;
  }, [onEditingChange]);

  const current = displayedTodo(element, saved);
  const storedItems = useMemo(() => normalizeTodoItems(current.data?.items), [current.data?.items]);
  if (matchesSavedDraft(current, storedItems, pending, busy)) {
    setPending(null);
    setEditor(null);
    setError('');
  }

  const { items, title, isOverview, active, editable, annotatingRows, writable, isEditing } =
    deriveTodoView({
      interactive,
      expanded,
      overview,
      annotationActive,
      canEdit,
      canAnnotate: Boolean(onAnnotateItem),
      busy,
      editor,
      pending,
      drag,
      storedItems,
      current,
    });
  const checked = items.filter((item) => item.checked).length;
  const outsideRows = outsideTodoRows(renderOutsideRows, isOverview, items);
  const adornments = visibleAdornments(items, isOverview, renderItemAdornment);
  const adornedIds = Array.from(adornments.keys()).join(',');
  const surface = documentSurface(element, styleProfile);
  const style = todoSurfaceStyle(surface, isOverview, uiScale);

  useEffect(() => {
    activity.current?.(isEditing);
  }, [isEditing]);
  useEffect(() => () => activity.current?.(false), []);

  useEffect(() => {
    if (!writable || editRequest === undefined || request.current === editRequest) {
      return;
    }

    request.current = editRequest;
    const first = storedItems[0];
    setError('');
    setEditor({
      target: first ? { kind: 'item', id: first.id } : { kind: 'new' },
      base: current,
      value: first?.text ?? '',
    });
  }, [current, editRequest, storedItems, writable]);

  useLayoutEffect(() => {
    if (!editor?.target || !input.current) {
      return;
    }

    input.current.focus({ preventScroll: true });
    input.current.select();
  }, [editor?.target]);

  useLayoutEffect(() => {
    const scroller = body.current;
    if (!scroller || !adornedIds) {
      setAdornmentBoxes((previous) => (previous.length ? [] : previous));

      return;
    }

    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-todo-item-id]'));
    const wanted = new Set(adornedIds.split(','));
    const adornedRows = rows.filter((row) => wanted.has(row.dataset.todoItemId!));
    const measure = () => {
      const top = scroller.offsetTop;
      const bottom = top + scroller.clientHeight;
      const boxes: RowAdornmentBox[] = [];
      for (const row of adornedRows) {
        const y = row.offsetTop - scroller.scrollTop;
        if (y >= bottom || y + row.offsetHeight <= top) {
          continue;
        }

        boxes.push({
          id: row.dataset.todoItemId!,
          left: row.offsetLeft + row.clientLeft - scroller.scrollLeft,
          top: y + row.clientTop,
          width: row.clientWidth,
          height: row.clientHeight,
        });
      }

      setAdornmentBoxes((previous) => (sameAdornmentBoxes(previous, boxes) ? previous : boxes));
    };

    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(scroller);

    for (const row of rows) {
      observer?.observe(row);
    }

    return () => {
      scroller.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [active, adornedIds, element.h, element.w, expanded, items]);

  const startEdit = (target: EditorTarget, value: string) => {
    if (!writable || (target.kind === 'new' && items.length >= TODO_ITEM_LIMIT)) {
      return;
    }

    setError('');
    setEditor({ target, base: current, value });
  };

  const save = async (change: Save) => {
    if (!canEdit || busyRef.current) {
      return;
    }

    busyRef.current = true;
    setPending(change);
    setBusy(true);
    setError('');
    try {
      const result = await onSave(change.operations, change.base);
      if (!result) {
        throw new Error('清单草稿未保存。');
      }

      setSaved(result);
      setPending(null);
      const continueAdding = change.keepAdding && input.current === document.activeElement;
      setEditor((previous) =>
        continueAdding && previous ? { target: previous.target, base: result, value: '' } : null,
      );
    } catch (failure) {
      handleSaveFailure(failure);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  function handleSaveFailure(failure: unknown) {
    setError(failure instanceof Error ? failure.message : '清单草稿未保存。');
  }

  function submitSave(change: Save) {
    save(change).catch(handleSaveFailure);
  }

  const saveRows = (operations: TodoOperation[], base = current, keepAdding = false) => {
    let next: TodoItem[];
    try {
      next = applyTodoOperations(normalizeTodoItems(base.data?.items), operations);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '任务更改无效。');

      return;
    }

    submitSave({
      base,
      operations: [{ op: 'todo', id: base.id, data: { operations } }],
      items: next,
      title: titleOf(base),
      keepAdding,
    });
  };

  const appendRows = (values: string[], base: BoardElement, keepAdding: boolean) => {
    const count = normalizeTodoItems(base.data?.items).length;
    if (count + values.length > TODO_ITEM_LIMIT) {
      setError('清单最多可保存 200 行。');

      return;
    }

    const operations: TodoOperation[] = values.map((text) => ({
      op: 'insert',
      item: { id: newClientId('task'), text, checked: false },
    }));
    saveRows(operations, base, keepAdding && count + values.length < TODO_ITEM_LIMIT);
  };

  const commitEditor = (keepAdding = false) => {
    const canCommit = canEdit && !pending && !busyRef.current;
    if (!editor || !canCommit) {
      return;
    }

    const { target, base } = editor;
    const value = editor.value.trim();
    if (target.kind === 'title') {
      const title = value || '任务清单';
      if (title === titleOf(base)) {
        setEditor(null);

        return;
      }

      submitSave({
        base,
        operations: [{ op: 'update', id: base.id, changes: { text: title } }],
        items: normalizeTodoItems(base.data?.items),
        title,
        keepAdding: false,
      });
    } else if (target.kind === 'new') {
      if (!value) {
        if (!keepAdding) {
          setEditor(null);
        }

        return;
      }

      appendRows([value], base, keepAdding);
    } else {
      const original = normalizeTodoItems(base.data?.items).find((item) => item.id === target.id);
      if (value === original?.text) {
        setEditor(null);

        return;
      }

      saveRows([{ op: 'update', id: target.id, changes: { text: value } }], base);
    }
  };

  const handleEditorKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') {
      return;
    }

    if (event.key === 'Enter' && plainKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      commitEditor(true);
    } else if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      event.stopPropagation();
      setEditor(null);
      setError('');
    }
  };

  const handlePasteRows = (event: ClipboardEvent) => {
    if (!writable || (editor && editor.target.kind !== 'new')) {
      return;
    }
    if (isOverview) {
      return;
    }

    let content = event.clipboardData.getData('text/plain');
    if (!/[\r\n]/.test(content)) {
      return;
    }

    const field = input.current;
    if (editor?.target.kind === 'new' && field && event.target === field) {
      content =
        field.value.slice(0, field.selectionStart ?? 0) +
        content +
        field.value.slice(field.selectionEnd ?? field.value.length);
    }
    if (content.length > TODO_ITEM_LIMIT * (TODO_TEXT_BYTES + 2)) {
      event.preventDefault();
      event.stopPropagation();
      setError('粘贴的任务过多，请分批添加。');

      return;
    }

    const values = content
      .split(/\r\n?|\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (values.length < 2) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    appendRows(values, editor?.base ?? current, true);
  };

  const moveRow = (id: string, afterId: string | null) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0 || (items[index - 1]?.id ?? null) === afterId) {
      return;
    }

    saveRows([{ op: 'move', id, afterId }]);
  };

  const reorderKey = (event: KeyboardEvent, id: string, index: number) => {
    if (!writable || !plainKey(event) || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowUp' && index > 0) {
      moveRow(id, items[index - 2]?.id ?? null);
    }
    if (event.key === 'ArrowDown' && index + 1 < items.length) {
      moveRow(id, items[index + 1]!.id);
    }
  };

  const dragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!writable || !drag || drag.id === id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2;
    if (drag.over !== id || drag.before !== before) {
      setDrag({ id: drag.id, over: id, before });
    }
  };

  const dropRow = (event: DragEvent<HTMLElement>, id: string) => {
    if (!writable || !drag) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDrag(null);
    if (drag.id === id) {
      return;
    }

    const remaining = items.filter((item) => item.id !== drag.id);
    const index = remaining.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    moveRow(
      drag.id,
      event.clientY < box.top + box.height / 2 ? (remaining[index - 1]?.id ?? null) : id,
    );
  };

  function handleTextChange(event: ChangeEvent<HTMLInputElement>, titleInput: boolean) {
    const value = event.currentTarget.value;
    setEditor((previous) => previous && { ...previous, value });
    const withinLimit = titleInput || utf8.encode(value).byteLength <= TODO_TEXT_BYTES;
    setError(withinLimit ? '' : '任务文字须在 2,000 UTF-8 字节以内。');
  }

  function handleMoveStart(event: PointerEvent<HTMLButtonElement>) {
    if (event.button === 0 && !element.locked && !isEditing) {
      onMoveStart?.(event);
    }
  }

  function handleRowDragStart(event: DragEvent<HTMLButtonElement>, id: string) {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setDrag({ id });
  }

  function handleAnnotateItem(event: MouseEvent<HTMLLIElement>, id: string) {
    event.stopPropagation();
    const point = event.detail ? { x: event.clientX, y: event.clientY } : undefined;
    onAnnotateItem?.(id, point);
  }

  const textInput = (label: string, titleInput = false) =>
    editor && (
      <input
        ref={input}
        className={titleInput ? 'studio-todo-title-input' : 'studio-todo-input'}
        aria-label={label}
        placeholder={editor.target.kind === 'new' ? '输入任务' : undefined}
        maxLength={titleInput ? 200 : TODO_TEXT_BYTES}
        value={editor.value}
        readOnly={!canEdit || busy || Boolean(pending)}
        onChange={(event) => handleTextChange(event, titleInput)}
        onKeyDown={handleEditorKey}
        onBlur={() => commitEditor()}
      />
    );

  function renderTitle() {
    if (editor?.target.kind === 'title') {
      return textInput('任务清单标题', true);
    }
    if (!editable) {
      return (
        <strong className="studio-todo-title" title={title}>
          {title}
        </strong>
      );
    }

    return (
      <button
        type="button"
        className="studio-todo-title-button"
        data-native-interactive="true"
        title="编辑清单标题"
        aria-label={'编辑清单标题：' + title}
        disabled={!writable}
        onClick={() => startEdit({ kind: 'title' }, title)}
      >
        {title}
      </button>
    );
  }

  function renderItemText(item: TodoItem, editingItem: boolean) {
    if (editingItem) {
      return textInput('任务文字');
    }
    if (annotatingRows) {
      return (
        <button
          type="button"
          className="studio-todo-item-text"
          aria-label={'备注任务：' + itemLabel(item)}
        >
          {itemLabel(item)}
        </button>
      );
    }
    if (!editable) {
      return (
        <span className="studio-todo-item-text" title={item.text}>
          {itemLabel(item)}
        </span>
      );
    }

    return (
      <button
        type="button"
        className="studio-todo-item-text"
        disabled={!writable}
        title={item.text}
        aria-label={'编辑任务：' + itemLabel(item)}
        onClick={() => startEdit({ kind: 'item', id: item.id }, item.text)}
      >
        {itemLabel(item)}
      </button>
    );
  }

  function renderItemSource(source?: TodoSourceRef) {
    if (!source) {
      return null;
    }

    const label = sourceLabel?.(source) ?? '查看来源';
    if (!active || !onOpenSource) {
      return (
        <span className="studio-todo-source" title={label}>
          <Link2 size={15} aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    }

    return (
      <button
        type="button"
        className="studio-todo-source"
        title={label}
        aria-label={'打开任务来源：' + label}
        onClick={() => onOpenSource(source)}
      >
        <Link2 size={15} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }

  function renderItem(item: TodoItem, index: number) {
    const editingItem = editor?.target.kind === 'item' && editor.target.id === item.id;

    return (
      <li
        key={item.id}
        className="studio-todo-item"
        data-todo-item-id={item.id}
        data-todo-drop={dropPosition(drag, item.id)}
        onDragOver={(event) => dragOver(event, item.id)}
        onDrop={(event) => dropRow(event, item.id)}
        onPointerDown={annotatingRows ? handleAnnotationPointer : undefined}
        onClick={annotatingRows ? (event) => handleAnnotateItem(event, item.id) : undefined}
      >
        {editable && (
          <button
            type="button"
            className="studio-todo-row-grip"
            aria-label={'调整顺序：' + itemLabel(item)}
            title="调整顺序，可用方向键"
            disabled={!writable || items.length < 2}
            draggable={writable && items.length > 1}
            onDragStart={(event) => handleRowDragStart(event, item.id)}
            onDragEnd={() => setDrag(null)}
            onKeyDown={(event) => reorderKey(event, item.id, index)}
          >
            <GripVertical aria-hidden="true" size={16} />
          </button>
        )}
        {editable ? (
          <input
            className="studio-todo-check"
            type="checkbox"
            aria-label={'完成任务：' + itemLabel(item)}
            checked={item.checked}
            disabled={!writable}
            onChange={(event) =>
              saveRows([
                {
                  op: 'update',
                  id: item.id,
                  changes: { checked: event.currentTarget.checked },
                },
              ])
            }
          />
        ) : (
          <span
            className="studio-todo-check-read"
            data-checked={item.checked || undefined}
            aria-label={item.checked ? '已完成' : '未完成'}
          >
            {item.checked ? '✓' : ''}
          </span>
        )}
        {renderItemText(item, editingItem)}
        {renderItemSource(item.sourceRef)}
        {editable && (
          <button
            type="button"
            className="studio-todo-remove"
            title="删除任务"
            aria-label={'删除任务：' + itemLabel(item)}
            disabled={!writable}
            onClick={() => saveRows([{ op: 'delete', id: item.id }])}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </li>
    );
  }

  function renderHeading() {
    const canMoveInline = !expanded && canEdit;
    const showMoveControl = canMoveInline && onMoveStart && !annotationActive;

    return (
      <header className="studio-todo-heading">
        {showMoveControl && (
          <button
            type="button"
            className="studio-todo-move"
            data-native-interactive="true"
            aria-label="移动任务清单"
            title="移动任务清单"
            disabled={element.locked || isEditing}
            onPointerDown={handleMoveStart}
          >
            <GripVertical aria-hidden="true" size={18} />
          </button>
        )}
        <ListTodo className="studio-todo-icon" size={22} aria-hidden="true" />
        <div className="studio-todo-heading-main">{renderTitle()}</div>
        <span className="studio-todo-count" aria-live="polite">
          {checked}/{items.length} 完成
        </span>
        {!expanded && !annotationActive && (
          <button
            type="button"
            className="studio-todo-action"
            data-native-interactive="true"
            aria-label="展开任务清单"
            title="展开任务清单"
            onClick={onExpand}
          >
            <Maximize aria-hidden="true" size={19} />
          </button>
        )}
      </header>
    );
  }

  function renderBody() {
    return isOverview ? (
      <progress
        className="studio-todo-progress"
        value={checked}
        max={Math.max(items.length, 1)}
        aria-label="任务完成进度"
      />
    ) : (
      <div
        ref={body}
        className="studio-todo-body"
        data-native-interactive={active || undefined}
        onDoubleClick={active ? (event) => event.stopPropagation() : undefined}
        onKeyDown={active ? handleBodyKey : undefined}
      >
        <ul className="studio-todo-items" aria-label="任务">
          {items.map(renderItem)}
        </ul>
        {(editable || editor?.target.kind === 'new') && (
          <div className="studio-todo-add">
            {editor?.target.kind === 'new' ? (
              <>
                <Plus aria-hidden="true" size={18} />
                {textInput('新增任务')}
              </>
            ) : (
              <button
                type="button"
                disabled={!writable || items.length >= TODO_ITEM_LIMIT}
                onClick={() => startEdit({ kind: 'new' }, '')}
              >
                <Plus aria-hidden="true" size={18} />
                添加任务
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderSaveStatus() {
    return (
      <>
        {busy && (
          <div className="studio-todo-status" role="status">
            正在保存
          </div>
        )}
        {error && (
          <div className="studio-todo-status" role="alert">
            <span>{error}</span>
            {pending && (
              <button
                type="button"
                data-native-interactive="true"
                onClick={() => submitSave(pending)}
                disabled={busy || !active || !canEdit}
              >
                重试保存
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  function renderAdornments() {
    return (
      <>
        {!isOverview && adornmentBoxes.length > 0 && (
          <div className="studio-todo-row-adornments">
            {adornmentBoxes.map(({ id, ...position }) => (
              <div
                key={id}
                data-todo-adornment-for={id}
                className="studio-todo-row-adornment"
                style={position}
              >
                {adornments.get(id)}
              </div>
            ))}
          </div>
        )}
        {outsideRows && <div className="studio-todo-outside-rows">{outsideRows}</div>}
      </>
    );
  }

  return (
    <section
      className="studio-todo-region"
      style={style}
      data-todo-id={element.id}
      data-todo-layout={isOverview ? 'overview' : 'full'}
      data-todo-scheme={surface.scheme}
      data-todo-expanded={expanded || undefined}
      data-todo-annotating={annotatingRows || undefined}
      aria-label={title}
      aria-busy={busy || undefined}
      onPaste={handlePasteRows}
    >
      {renderHeading()}
      {renderBody()}
      {renderSaveStatus()}
      {renderAdornments()}
    </section>
  );
}
