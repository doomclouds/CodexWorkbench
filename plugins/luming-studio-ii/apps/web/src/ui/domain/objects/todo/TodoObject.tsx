import { useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, RefObject } from 'react';
import { Button, Progress, StatusText } from '../../../base/index.js';
import type { TodoObjectAppearance, TodoObjectProps } from './contracts.js';
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

function TodoHeadingIcons() {
  return (
    <span
      className="studio-object-todo__heading-icons"
      data-canvas-drag-surface="title"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="9" cy="5" r="1" />
        <circle cx="9" cy="12" r="1" />
        <circle cx="9" cy="19" r="1" />
        <circle cx="15" cy="5" r="1" />
        <circle cx="15" cy="12" r="1" />
        <circle cx="15" cy="19" r="1" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
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
    proposedScale && Number.isFinite(proposedScale)
      ? Math.min(Math.max(1, proposedScale), maxOverviewScale)
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
    return <TodoTextEditor label="清单标题" session={session} />;
  }
  if (editable) {
    return (
      <Button
        label="编辑清单标题"
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
      {session.pending && (
        <Button label="重试保存" variant="ghost" onActivate={session.retry} disabled={!editable} />
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
  onAnnotateItem,
}: TodoObjectProps) {
  const active = (interactive || expanded) && !annotationActive;

  return {
    active,
    editable: active && !readOnly && onEdit !== undefined,
    canExpand: !expanded && !annotationActive && onRequestExpand !== undefined,
    annotating: annotationActive && onAnnotateItem !== undefined,
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
    overview,
    editRequest,
    onEditingChange,
    onRequestExpand,
    appearance,
    renderOutsideRows,
    onOpenSource,
    sourceLabel,
    onAnnotateItem,
    renderItemAdornment,
  } = props;
  const [dragging, setDragging] = useState(false);
  const region = useRef<HTMLElement>(null);
  const small = useTodoOverview(region);
  const { active, editable, canExpand, annotating } = todoAccess(props);
  const session = useTodoEditor({
    value,
    onEdit,
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
      data-todo-scheme={scheme}
      style={style}
      aria-label={title}
      aria-busy={session.busy || undefined}
      onPaste={handlePaste}
    >
      <header className="studio-object-todo__heading" data-canvas-native="">
        <TodoHeadingIcons />
        <div className="studio-object-todo__title">{titleContent(title, editable, session)}</div>
        <span className="studio-object-todo__count" aria-live="polite">
          {complete}/{items.length} 完成
        </span>
        {canExpand && (
          <Button
            label="展开任务清单"
            icon="⤢"
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
