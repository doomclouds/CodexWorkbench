import { useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';

import { Button, Checkbox, ScrollRegion } from '../../../base/index.js';
import type { TodoObjectItem, TodoObjectProps } from './contracts.js';
import { TodoTextEditor } from './TodoTextEditor.js';
import { maxTodoItems, taskLabel } from './todo-edit.js';
import { useTodoAdornments } from './useTodoAdornments.js';
import type { TodoEditorSession } from './useTodoEditor.js';

interface TodoRowsProps extends Pick<
  TodoObjectProps,
  'onOpenSource' | 'sourceLabel' | 'onAnnotateItem' | 'renderItemAdornment'
> {
  session: TodoEditorSession;
  active: boolean;
  editable: boolean;
  annotating: boolean;
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

function sourceBadge(item: TodoObjectItem, props: TodoRowsProps) {
  const source = item.sourceRef;
  if (!source) {
    return null;
  }

  const label = props.sourceLabel?.(source) ?? '查看来源';
  const onOpen = props.active ? props.onOpenSource : undefined;

  return onOpen ? (
    <Button
      label={'打开任务来源：' + label}
      variant="ghost"
      icon={<span className="studio-object-todo__source">↗ {label}</span>}
      iconOnly
      onActivate={() => onOpen(source)}
    />
  ) : (
    <span className="studio-object-todo__source" title={label}>
      {label}
    </span>
  );
}

function taskText(item: TodoObjectItem, props: TodoRowsProps) {
  const { session, editable, annotating } = props;
  const title = taskLabel(item);
  if (session.draft?.target.kind === 'item' && session.draft.target.id === item.id) {
    return <TodoTextEditor label="任务文字" session={session} />;
  }
  if (editable) {
    return (
      <Button
        label={'编辑任务：' + title}
        icon={title}
        iconOnly
        variant="ghost"
        disabled={!session.writable}
        onActivate={() => session.start({ kind: 'item', id: item.id }, item.text)}
      />
    );
  }
  if (annotating) {
    return <Button label={'备注任务：' + title} icon={title} iconOnly variant="ghost" />;
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
  const arrow = !hasModifier(event) && event.key.startsWith('Arrow');
  if (deletion || arrow) {
    event.stopPropagation();
  }
}

function handleAnnotationPointerDown(event: PointerEvent<HTMLLIElement>) {
  if (event.button === 0) {
    event.stopPropagation();
  }
}

export function TodoRows(props: TodoRowsProps) {
  const { session, active, editable, annotating, onAnnotateItem, renderItemAdornment } = props;
  const items = session.projection.items;
  const [drag, setDrag] = useState<RowDrag>();
  const wrapper = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
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

  function startDrag(event: DragEvent<HTMLSpanElement>, id: string) {
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

  function annotate(event: MouseEvent<HTMLLIElement>, id: string) {
    event.stopPropagation();
    const point = event.detail ? { x: event.clientX, y: event.clientY } : undefined;
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
        data-todo-drop={position}
        onDragOver={(event) => handleDragOver(event, id)}
        onDrop={(event) => handleDrop(event, id)}
        onPointerDown={annotating ? handleAnnotationPointerDown : undefined}
        onClick={annotating ? (event) => annotate(event, id) : undefined}
      >
        {editable && (
          <span
            draggable={canReorder}
            className="studio-object-todo__grip"
            onDragStart={(event) => startDrag(event, id)}
            onDragEnd={handleDragEnd}
            onKeyDown={(event) => reorderKey(event, id, index)}
          >
            <Button
              label={'调整顺序：' + label}
              icon="⋮⋮"
              iconOnly
              variant="ghost"
              disabled={!canReorder}
            />
          </span>
        )}
        <span className="studio-object-todo__checked">
          {editable ? (
            <Checkbox
              label={'完成任务：' + label}
              checked={checked}
              disabled={!session.writable}
              onCheckedChange={(checked) =>
                session.changeRows([{ op: 'update', id, changes: { checked } }])
              }
            />
          ) : (
            <span aria-label={checked ? '已完成' : '未完成'} data-checked={checked}>
              {checked ? '✓' : '○'}
            </span>
          )}
        </span>
        <div className="studio-object-todo__task" data-completed={checked}>
          {taskText(item, props)}
        </div>
        {sourceBadge(item, props)}
        {editable && (
          <Button
            label={'删除任务：' + label}
            icon="×"
            iconOnly
            variant="ghost"
            disabled={!session.writable}
            onActivate={() => session.changeRows([{ op: 'delete', id }])}
          />
        )}
      </li>
    );
  }

  return (
    <div
      ref={wrapper}
      className="studio-object-todo__body"
      onKeyDown={active ? stopBodyKey : undefined}
      onDoubleClick={active ? (event) => event.stopPropagation() : undefined}
    >
      <ScrollRegion axis="vertical" label="任务列表" contain onScroll={onScroll}>
        <ul ref={list} className="studio-object-todo__list" aria-label="任务">
          {items.map(renderItem)}
        </ul>
        {orphaned && <TodoTextEditor label="任务文字" session={session} />}
        {adding && <TodoTextEditor label="新增任务" session={session} />}
        {editable && !adding && (
          <Button
            label="添加任务"
            icon="+"
            variant="ghost"
            disabled={!session.writable || items.length >= maxTodoItems}
            onActivate={() => session.start({ kind: 'new' }, '')}
          />
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
