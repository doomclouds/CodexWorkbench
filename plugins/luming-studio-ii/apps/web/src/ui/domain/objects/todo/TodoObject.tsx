import { useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, RefObject } from 'react';
import { Button, Progress, StatusText } from '../../../base/index.js';
import type { TodoObjectAppearance, TodoObjectItem, TodoObjectProps } from './contracts.js';
import { TodoControlIcon } from './TodoControlIcon.js';
import { TodoRows } from './TodoRows.js';
import { TodoTextEditor } from './TodoTextEditor.js';
import { defaultTodoTitle, taskLabel } from './todo-edit.js';
import { useTodoEditor } from './useTodoEditor.js';
import type { TodoEditorSession } from './useTodoEditor.js';
import './todo-object.css';

const maxOverviewScale = 1.8;
const paperPattern = /^#[0-9a-f]{6}$/iu;
const darknessThreshold = 128;
const overviewWidth = 228;
const overviewHeight = 110;
const maxOverviewRows = 4;
const minimumPreviewWidth = 104;
const minimumPreviewZoom = 0.5;
const overviewChromeHeight = 46;
const overviewRowHeight = 18;

export function isTodoOverview(width: number, height: number) {
  return width < overviewWidth || height < overviewHeight;
}

export function todoHeadingLayout(
  width: number,
  height: number,
): TodoObjectAppearance['headingLayout'] {
  if (width < 64 || height < 28) {
    return 'outline';
  }
  if (width < minimumPreviewWidth || height < 56) {
    return 'title';
  }
}

export function visibleTodoOverviewRows(width: number, height: number, zoom: number) {
  if (width * zoom < minimumPreviewWidth || zoom < minimumPreviewZoom) {
    return 0;
  }

  return Math.min(
    maxOverviewRows,
    Math.max(0, Math.floor((height * zoom - overviewChromeHeight) / overviewRowHeight)),
  );
}

function TodoOverviewRows({
  items,
  limit = maxOverviewRows,
}: {
  readonly items: readonly TodoObjectItem[];
  readonly limit?: number;
}) {
  const visible = items.slice(0, limit);
  if (visible.length === 0) {
    return null;
  }

  return (
    <ul className="studio-object-todo__overview-rows" aria-label="任务预览">
      {visible.map((item) => (
        <li key={item.id}>
          <span
            role="img"
            aria-label={item.checked ? '已完成' : '未完成'}
            data-checked={item.checked}
          >
            {item.checked ? '✓' : ''}
          </span>
          <span className="studio-object-todo__overview-text" title={taskLabel(item)}>
            {taskLabel(item)}
          </span>
        </li>
      ))}
    </ul>
  );
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
  const showMove = movable && !expanded;

  return (
    <span className="studio-object-todo__heading-icons">
      {showMove && (
        <button
          className="studio-object-todo__move"
          data-canvas-drag-surface="title"
          type="button"
          aria-label="移动任务清单"
          title="移动任务清单"
          disabled={locked || annotationActive}
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

function todoStyle(
  appearance: TodoObjectAppearance | undefined,
  overview: boolean,
  expanded = false,
  inProgress = false,
) {
  const paper = appearance?.paper;
  const scheme = paperScheme(paper);
  const proposedScale = appearance?.uiScale;
  const uiScale =
    proposedScale && proposedScale > 0 && Number.isFinite(proposedScale) ? proposedScale : 1;
  const scaled = Math.min(uiScale, maxOverviewScale);
  const style: CSSProperties & {
    '--todo-paper'?: string;
    '--todo-title-size'?: string;
    '--todo-ui-scale': number;
  } = {
    colorScheme: scheme,
    '--todo-paper': paper,
    '--todo-title-size':
      proposedScale === undefined || expanded
        ? undefined
        : `${Math.max(17 * scaled, 12 * uiScale)}px`,
    '--todo-ui-scale': overview ? scaled : 1,
  };

  const headingLayout = expanded || inProgress ? undefined : appearance?.headingLayout;

  return { style, scheme, headingLayout };
}

export function TodoContentUnavailable({
  title,
  appearance,
  overview,
  expanded,
  focusedReading,
}: Pick<TodoObjectProps, 'appearance' | 'overview' | 'expanded' | 'focusedReading'> & {
  readonly title: string;
}) {
  const compact = Boolean(overview && !expanded);
  const { style, scheme, headingLayout } = todoStyle(appearance, compact, expanded);
  const label = title.trim() || defaultTodoTitle;

  return (
    <div
      className="studio-object-todo"
      data-todo-layout={compact ? 'overview' : 'full'}
      data-todo-heading-layout={headingLayout}
      data-todo-scheme={scheme}
      data-todo-focused-reading={focusedReading || undefined}
      data-todo-content-unavailable=""
      style={style}
    >
      <header className="studio-object-todo__heading">
        <TodoHeadingIcons movable={false} locked />
        <div className="studio-object-todo__title">
          <h3 title={label}>{label}</h3>
        </div>
      </header>
      <div className="studio-object-todo__unavailable">
        <StatusText message="任务清单正文尚未加载" announcement="polite" />
      </div>
    </div>
  );
}

function titleContent(
  title: string,
  showsEditControls: boolean,
  session: TodoEditorSession,
  paused?: boolean,
) {
  if (session.draft?.target.kind === 'title') {
    return <TodoTextEditor label="任务清单标题" session={session} paused={paused} />;
  }
  if (showsEditControls) {
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
  const active = interactive || expanded;
  const canSave = !readOnly && !annotationActive && onEdit !== undefined;

  return {
    active,
    canSave,
    editable: active && canSave,
    showsEditControls: active && !readOnly && onEdit !== undefined,
    canExpand: !expanded && onRequestExpand !== undefined,
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
    overviewRows,
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
  const { active, canSave, editable, showsEditControls, canExpand, annotating } = todoAccess(props);
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
  const { style, scheme, headingLayout } = todoStyle(appearance, compact, expanded, inProgress);
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
      data-todo-heading-layout={headingLayout}
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
        <div className="studio-object-todo__title">
          {titleContent(title, showsEditControls, session, annotationActive)}
        </div>
        <span className="studio-object-todo__count" aria-live="polite">
          {complete}/{items.length} 完成
        </span>
        {canExpand && (
          <Button
            label="展开任务清单"
            icon={<TodoControlIcon icon="expand" size={19} />}
            iconOnly
            variant="ghost"
            disabled={annotationActive}
            onActivate={onRequestExpand}
          />
        )}
      </header>
      {compact ? (
        <>
          <Progress label="任务完成进度" value={complete} max={Math.max(1, items.length)} />
          <TodoOverviewRows items={items} limit={overviewRows} />
        </>
      ) : (
        <TodoRows
          session={session}
          active={active}
          showsEditControls={showsEditControls}
          annotating={annotating}
          editsPaused={annotationActive}
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
