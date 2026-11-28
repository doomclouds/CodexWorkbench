import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';

import { Button, ScrollRegion } from '../../../base/index.js';
import type { TodoObjectItem, TodoObjectProps, TodoPoint } from './contracts.js';
import { TodoControlIcon } from './TodoControlIcon.js';
import { TodoTextEditor } from './TodoTextEditor.js';
import { maxTodoItems, taskLabel } from './todo-edit.js';
import { useTodoAdornments } from './useTodoAdornments.js';
import type { TodoEditorSession } from './useTodoEditor.js';

interface TodoRowsProps extends Pick<
  TodoObjectProps,
  | 'onOpenSource'
  | 'sourceLabel'
  | 'sourceRequest'
  | 'onAnnotateContent'
  | 'onAnnotateItem'
  | 'renderItemAdornment'
> {
  session: TodoEditorSession;
  active: boolean;
  showsEditControls: boolean;
  annotating: boolean;
  editsPaused?: boolean;
  onDraggingChange: (dragging: boolean) => void;
}

interface RowDrag {
  id: string;
  overId?: string;
  position?: 'before' | 'after';
}

function dropPosition(event: DragEvent<HTMLLIElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();

  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

function hasModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

function rowPosition(bounds: DOMRect, point: TodoPoint | undefined) {
  if (!(bounds.width > 0 && bounds.height > 0)) {
    return undefined;
  }

  const x = point?.x ?? bounds.right - 8;
  const y = point?.y ?? bounds.bottom - 4;
  const u = Math.min(1, Math.max(0, (x - bounds.left) / bounds.width));
  const v = Math.min(1, Math.max(0, (y - bounds.top) / bounds.height));

  return { u, v };
}

function sourceBadge(item: TodoObjectItem, props: TodoRowsProps) {
  const source = item.sourceRef;
  if (!source) {
    return null;
  }

  const label = props.sourceLabel?.(source) ?? '查看来源';
  const onOpen = props.active ? props.onOpenSource : undefined;

  return onOpen ? (
    <button
      className="studio-object-todo__source"
      type="button"
      title={label}
      aria-label={'打开任务来源：' + label}
      disabled={props.annotating}
      onClick={() => onOpen(source)}
    >
      <TodoControlIcon icon="link" size={15} />
      <span>{label}</span>
    </button>
  ) : (
    <span className="studio-object-todo__source" title={label}>
      <TodoControlIcon icon="link" size={15} />
      <span>{label}</span>
    </span>
  );
}

function taskText(item: TodoObjectItem, props: TodoRowsProps) {
  const { session, showsEditControls, annotating } = props;
  const title = taskLabel(item);
  if (session.draft?.target.kind === 'item' && session.draft.target.id === item.id) {
    return <TodoTextEditor label="任务文字" session={session} paused={props.editsPaused} />;
  }
  if (showsEditControls) {
    return (
      <Button
        label={(annotating ? '备注任务：' : '编辑任务：') + title}
        icon={title}
        iconOnly
        variant="ghost"
        disabled={!annotating && !session.writable}
        onActivate={
          annotating ? undefined : () => session.start({ kind: 'item', id: item.id }, item.text)
        }
      />
    );
  }
  if (annotating) {
    return (
      <button
        type="button"
        className="studio-object-todo__note-target"
        aria-label={'备注任务：' + title}
      >
        <span>{title}</span>
      </button>
    );
  }

  return <span title={title}>{title}</span>;
}

function rowAdornments(
  items: readonly TodoObjectItem[],
  render: TodoObjectProps['renderItemAdornment'],
) {
  const entries = new Map<string, ReactNode>();
  if (render) {
    for (const { id } of items) {
      const content = render(id);
      if (content != null) {
        entries.set(id, content);
      }
    }
  }

  return entries;
}

function stopBodyKey(event: KeyboardEvent<HTMLDivElement>) {
  const deletion = event.key === 'Delete' || event.key === 'Backspace';
  const arrow = !event.ctrlKey && !event.metaKey && event.key.startsWith('Arrow');
  if (deletion || arrow) {
    event.stopPropagation();
  }
}

function handleAnnotationPointerDown(event: PointerEvent<HTMLLIElement>) {
  if (event.button === 0) {
    event.stopPropagation();
  }
}

function useSourceRow(
  list: { current: HTMLUListElement | null },
  active: boolean,
  sourceRequest: TodoObjectProps['sourceRequest'],
  objectId: string,
  items: readonly TodoObjectItem[],
) {
  const lastSequence = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!active || !sourceRequest || sourceRequest.sequence === lastSequence.current) {
      return;
    }

    const { elementId, itemId } = sourceRequest.source;
    if (elementId !== objectId || !itemId) {
      return;
    }

    const rows = list.current?.querySelectorAll<HTMLElement>('[data-todo-item-id]') ?? [];
    const row = Array.from(rows).find(({ dataset }) => dataset.todoItemId === itemId);
    if (row) {
      lastSequence.current = sourceRequest.sequence;
      row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, [active, sourceRequest, objectId, items, list]);
}

export function TodoRows(props: TodoRowsProps) {
  const {
    session,
    active,
    showsEditControls,
    annotating,
    onAnnotateContent,
    onAnnotateItem,
    renderItemAdornment,
  } = props;
  const items = session.projection.items;
  const [drag, setDrag] = useState<RowDrag>();
  const wrapper = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useSourceRow(list, active, props.sourceRequest, session.projection.id, items);
  const adornments = useMemo(
    () => rowAdornments(items, renderItemAdornment),
    [items, renderItemAdornment],
  );
  const { onScroll, boxes } = useTodoAdornments(wrapper, list, adornments);
  const canReorder = session.writable && items.length > 1;
  const adding = session.draft?.target.kind === 'new';
  const editingId = session.draft?.target.kind === 'item' ? session.draft.target.id : undefined;
  const orphaned = editingId !== undefined && !items.some(({ id }) => id === editingId);

  function move(id: string, afterId: string | null) {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0 && (items[index - 1]?.id ?? null) !== afterId) {
      session.changeRows([{ op: 'move', id, afterId }]);
    }
  }

  function reorderKey(event: KeyboardEvent, id: string, index: number) {
    const arrows = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!arrows || hasModifier(event) || !canReorder) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowUp' && index > 0) {
      move(id, items[index - 2]?.id ?? null);
    }

    const next = items[index + 1];
    if (event.key === 'ArrowDown' && next) {
      move(id, next.id);
    }
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, id: string) {
    if (!canReorder) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setDrag({ id });
    props.onDraggingChange(true);
  }

  function handleDragEnd() {
    setDrag(undefined);
    props.onDraggingChange(false);
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, id: string) {
    if (!drag || !canReorder || drag.id === id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = dropPosition(event);
    if (drag.overId !== id || drag.position !== position) {
      setDrag({ id: drag.id, overId: id, position });
    }
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, id: string) {
    if (!drag || !canReorder) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleDragEnd();

    const rest = items.filter((item) => item.id !== drag.id);
    const index = rest.findIndex((item) => item.id === id);
    if (index >= 0) {
      move(drag.id, dropPosition(event) === 'before' ? (rest[index - 1]?.id ?? null) : id);
    }
  }

  function annotate(event: MouseEvent<HTMLLIElement>, { id, text }: TodoObjectItem) {
    event.stopPropagation();
    const point = event.detail ? { x: event.clientX, y: event.clientY } : undefined;
    if (onAnnotateContent) {
      const position = rowPosition(event.currentTarget.getBoundingClientRect(), point);
      if (position) {
        onAnnotateContent({ target: { kind: 'todo', itemId: id }, excerpt: text, ...position });
      }

      return;
    }

    onAnnotateItem?.(id, point);
  }

  function renderItem(item: TodoObjectItem, index: number) {
    const { id, checked } = item;
    const label = taskLabel(item);
    const position = drag?.overId === id ? drag.position : undefined;
    return (
      <li
        key={id}
        className="studio-object-todo__row"
        data-todo-item-id={id}
        data-canvas-content-unit={id}
        data-todo-drop={position}
        onDragOver={(event) => handleDragOver(event, id)}
        onDrop={(event) => handleDrop(event, id)}
        onPointerDown={annotating ? handleAnnotationPointerDown : undefined}
        onClick={annotating ? (event) => annotate(event, item) : undefined}
      >
        {showsEditControls && (
          <button
            type="button"
            draggable={canReorder}
            className="studio-object-todo__grip"
            aria-label={'调整顺序：' + label}
            title="调整顺序，可用方向键"
            disabled={!canReorder}
            onDragStart={(event) => startDrag(event, id)}
            onDragEnd={handleDragEnd}
            onKeyDown={(event) => reorderKey(event, id, index)}
          >
            <TodoControlIcon icon="grip" />
          </button>
        )}
        <span className="studio-object-todo__checked">
          {showsEditControls ? (
            <input
              type="checkbox"
              aria-label={'完成任务：' + label}
              checked={checked}
              disabled={!session.writable}
              onChange={(event) =>
                session.changeRows([
                  { op: 'update', id, changes: { checked: event.currentTarget.checked } },
                ])
              }
            />
          ) : (
            <span aria-label={checked ? '已完成' : '未完成'} data-checked={checked}>
              {checked ? '✓' : null}
            </span>
          )}
        </span>
        <div className="studio-object-todo__task" data-completed={checked}>
          {taskText(item, props)}
        </div>
        {sourceBadge(item, props)}
        {showsEditControls && (
          <button
            type="button"
            className="studio-object-todo__remove"
            aria-label={'删除任务：' + label}
            title="删除任务"
            disabled={!session.writable}
            onClick={() => session.changeRows([{ op: 'delete', id }])}
          >
            <TodoControlIcon icon="remove" />
          </button>
        )}
      </li>
    );
  }

  return (
    <div
      ref={wrapper}
      className="studio-object-todo__body"
      data-todo-active={active || undefined}
      inert={!active && !annotating}
      onKeyDown={active ? stopBodyKey : undefined}
      onDoubleClick={active ? (event) => event.stopPropagation() : undefined}
    >
      <ScrollRegion axis="vertical" label="任务列表" contain onScroll={onScroll}>
        <ul ref={list} className="studio-object-todo__list" aria-label="任务">
          {items.map(renderItem)}
        </ul>
        {orphaned && (
          <TodoTextEditor label="任务文字" session={session} paused={props.editsPaused} />
        )}
        {(adding || showsEditControls) && (
          <div className="studio-object-todo__add">
            {adding ? (
              <>
                <TodoControlIcon icon="add" size={18} />
                <TodoTextEditor label="新增任务" session={session} paused={props.editsPaused} />
              </>
            ) : (
              <Button
                label="添加任务"
                icon={<TodoControlIcon icon="add" size={18} />}
                variant="ghost"
                disabled={!session.writable || items.length >= maxTodoItems}
                onActivate={() => session.start({ kind: 'new' }, '')}
              />
            )}
          </div>
        )}
      </ScrollRegion>
      <div className="studio-object-todo__adornments">
        {boxes.map(
          ({ id, ...box }) =>
            adornments.has(id) && (
              <div
                key={id}
                data-todo-adornment-for={id}
                className="studio-object-todo__pin"
                style={box}
              >
                {adornments.get(id)}
              </div>
            ),
        )}
      </div>
    </div>
  );
}
