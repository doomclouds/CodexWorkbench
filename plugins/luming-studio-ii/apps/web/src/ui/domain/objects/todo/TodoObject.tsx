import { useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, RefObject } from 'react';
import { Button, Progress, StatusText } from '../../../base/index.js';
import type { TodoObjectAppearance, TodoObjectProps } from './contracts.js';
import { TodoControlIcon } from './TodoControlIcon.js';
import { TodoRows } from './TodoRows.js';
import { TodoTextEditor } from './TodoTextEditor.js';
import { defaultTodoTitle } from './todo-edit.js';
import { useTodoEditor } from './useTodoEditor.js';
import type { TodoEditorSession } from './useTodoEditor.js';
import './todo-object.css';

const maxOverviewScale = 1.8;
const paperPattern = /^#[0-9a-f]{6}$/iu;
const darknessThreshold = 128;
const overviewWidth = 228;
const overviewHeight = 110;

export function isTodoOverview(width: number, height: number) {
  return width < overviewWidth || height < overviewHeight;
}

function TodoHeadingIcons({
  movable,
  locked,
  expanded,
  annotationActive,
}: {
  readonly movable: boolean;
  readonly locked: boolean;
  readonly expanded?: boolean;
  readonly annotationActive?: boolean;
}) {
  const showMove = movable && !(expanded || annotationActive);

  return (
    <span className="studio-object-todo__heading-icons">
      {showMove && (
        <button
          className="studio-object-todo__move"
          data-canvas-drag-surface="title"
          type="button"
          aria-label="移动任务清单"
          title="移动任务清单"
          disabled={locked}
        >
          <TodoControlIcon icon="grip" size={18} />
        </button>
      )}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="5" height="5" rx="1" />
        <path d="M13 6h8M13 12h8M13 18h8M3 17l2 2 4-4" />
      </svg>
    </span>
  );
}

function paperScheme(paper?: string) {
  if (!paper || !paperPattern.test(paper)) {
    return undefined;
  }

  const red = Number.parseInt(paper.slice(1, 3), 16);
  const green = Number.parseInt(paper.slice(3, 5), 16);
  const blue = Number.parseInt(paper.slice(5, 7), 16);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

  return luminance < darknessThreshold ? 'dark' : 'light';
}

function todoStyle(appearance: TodoObjectAppearance | undefined, overview: boolean) {
  const paper = appearance?.paper;
  const scheme = paperScheme(paper);
  const proposedScale = appearance?.uiScale;
  const scaled =
    proposedScale && proposedScale > 0 && Number.isFinite(proposedScale)
      ? Math.min(proposedScale, maxOverviewScale)
      : 1;
  const style: CSSProperties & { '--todo-paper'?: string; '--todo-ui-scale': number } = {
    colorScheme: scheme,
    '--todo-paper': paper,
    '--todo-ui-scale': overview ? scaled : 1,
  };

  return { style, scheme };
}

function titleContent(title: string, editable: boolean, session: TodoEditorSession) {
  if (session.draft?.target.kind === 'title') {
    return <TodoTextEditor label="任务清单标题" session={session} />;
  }
  if (editable) {
    return (
      <Button
        label={'编辑清单标题：' + title}
        icon={title}
        iconOnly
        variant="ghost"
        disabled={!session.writable}
        onActivate={() => session.start({ kind: 'title' }, title)}
      />
    );
  }

  return <h3 title={title}>{title}</h3>;
}

function saveStatus(session: TodoEditorSession, editable: boolean) {
  if (session.busy) {
    return <StatusText message="正在保存" busy announcement="polite" />;
  }
  if (!session.error) {
    return null;
  }

  return (
    <div className="studio-object-todo__status">
      <StatusText message={session.error} tone="error" announcement="assertive" />
      {session.pending && !session.conflicted && (
        <Button label="重试保存" variant="ghost" onActivate={session.retry} disabled={!editable} />
      )}
      {session.conflicted && (
        <Button label="放弃本次修改" variant="ghost" onActivate={session.discardConflict} />
      )}
    </div>
  );
}

function todoAccess({
  interactive = true,
  readOnly = false,
  expanded = false,
  annotationActive = false,
  onEdit,
  onRequestExpand,
  onAnnotateContent,
  onAnnotateItem,
}: TodoObjectProps) {
  const active = (interactive || expanded) && !annotationActive;
  const canSave = !readOnly && !annotationActive && onEdit !== undefined;

  return {
    active,
    canSave,
    editable: active && canSave,
    canExpand: !expanded && !annotationActive && onRequestExpand !== undefined,
    annotating: annotationActive && Boolean(onAnnotateContent || onAnnotateItem),
  };
}

function useTodoOverview(ref: RefObject<HTMLElement | null>) {
  const [small, setSmall] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    const Observer = element?.ownerDocument.defaultView?.ResizeObserver;
    if (!element || !Observer) {
      return;
    }

    const observer = new Observer(([entry]) => {
      if (entry) {
        const { width, height } = entry.contentRect;
        setSmall(isTodoOverview(width, height));
      }
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return small;
}

function TodoSession(props: TodoObjectProps) {
  const {
    value,
    onEdit,
    expanded,
    focusedReading,
    annotationActive,
    movable = false,
    locked = false,
    overview,
    editRequest,
    onEditingChange,
    onRequestExpand,
    appearance,
    renderOutsideRows,
    onOpenSource,
    sourceLabel,
    sourceRequest,
    onAnnotateContent,
    onAnnotateItem,
    renderItemAdornment,
  } = props;
  const [dragging, setDragging] = useState(false);
  const region = useRef<HTMLElement>(null);
  const small = useTodoOverview(region);
  const { active, canSave, editable, canExpand, annotating } = todoAccess(props);
  const session = useTodoEditor({
    value,
    onEdit,
    canSave,
    editable,
    dragging,
    editRequest,
    onEditingChange,
  });
  const inProgress = Boolean(session.draft || session.pending || dragging);
  const compact = (overview ?? small) && !expanded && !inProgress;
  const title = session.projection.title.trim() || defaultTodoTitle;
  const { items } = session.projection;
  const complete = items.filter(({ checked }) => checked).length;
  const { style, scheme } = todoStyle(appearance, compact);
  const outside = renderOutsideRows?.(compact ? [] : items.map(({ id }) => id));

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (!compact && session.paste(event.clipboardData.getData('text/plain'))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <section
      ref={region}
      className="studio-object-todo"
      data-todo-id={value.id}
      data-todo-layout={compact ? 'overview' : 'full'}
      data-todo-focused-reading={focusedReading || undefined}
      data-todo-expanded={expanded || undefined}
      data-todo-annotating={annotating || undefined}
      data-todo-scheme={scheme}
      style={style}
      aria-label={title}
      aria-busy={session.busy || undefined}
      onPaste={handlePaste}
    >
      <header className="studio-object-todo__heading" data-canvas-native="">
        <TodoHeadingIcons
          movable={movable}
          locked={locked || inProgress}
          expanded={expanded}
          annotationActive={annotationActive}
        />
        <div className="studio-object-todo__title">{titleContent(title, editable, session)}</div>
        <span className="studio-object-todo__count" aria-live="polite">
          {complete}/{items.length} 完成
        </span>
        {canExpand && (
          <Button
            label="展开任务清单"
            icon={<TodoControlIcon icon="expand" size={19} />}
            iconOnly
            variant="ghost"
            onActivate={onRequestExpand}
          />
        )}
      </header>
      {compact ? (
        <Progress label="任务完成进度" value={complete} max={Math.max(1, items.length)} />
      ) : (
        <TodoRows
          session={session}
          active={active}
          editable={editable}
          annotating={annotating}
          onOpenSource={onOpenSource}
          sourceLabel={sourceLabel}
          sourceRequest={sourceRequest}
          onAnnotateContent={onAnnotateContent}
          onAnnotateItem={onAnnotateItem}
          renderItemAdornment={renderItemAdornment}
          onDraggingChange={setDragging}
        />
      )}
      {saveStatus(session, editable)}
      {outside && <div className="studio-object-todo__outside-rows">{outside}</div>}
    </section>
  );
}

export function TodoObject(props: TodoObjectProps) {
  return (
    <TodoSession
      key={props.value.id}
      {...props}
      expanded={props.expanded || props.focusedReading}
      readOnly={props.readOnly || props.focusedReading}
      editRequest={props.focusedReading ? undefined : props.editRequest}
    />
  );
}
