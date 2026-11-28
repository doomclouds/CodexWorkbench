import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Dialog } from '../../../base/index.js';
import type {
  CanvasObjectExtension,
  CanvasObjectPayload,
  CanvasObjectViewProps,
} from '../../canvas/index.js';
import type {
  TodoObjectEdit,
  TodoObjectItem,
  TodoObjectSnapshot,
  TodoSourceRef,
} from './contracts.js';
import {
  isTodoOverview,
  TodoContentUnavailable,
  todoHeadingLayout,
  TodoObject,
  visibleTodoOverviewRows,
} from './TodoObject.js';
import { TodoContentConflict } from './useTodoEditor.js';

const todoPaper = '#EFEFEF';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isSource(value: unknown): value is TodoSourceRef {
  if (!record(value) || typeof value.elementId !== 'string') {
    return false;
  }

  const identifiers = [value.artifactId, value.blockId, value.itemId];
  const version = value.version;
  const validVersion =
    version === undefined || (typeof version === 'number' && Number.isSafeInteger(version));

  return validVersion && identifiers.every(optionalText);
}

function isTodoItem(value: unknown): value is TodoObjectItem {
  if (!record(value) || typeof value.id !== 'string') {
    return false;
  }
  if (typeof value.text !== 'string' || typeof value.checked !== 'boolean') {
    return false;
  }

  return value.sourceRef === undefined || isSource(value.sourceRef);
}

function isTodoSnapshot(value: unknown, id: string, revision: number): value is TodoObjectSnapshot {
  if (!record(value) || value.id !== id || value.revision !== revision) {
    return false;
  }

  return (
    typeof value.title === 'string' && Array.isArray(value.items) && value.items.every(isTodoItem)
  );
}

function todoPayload(id: string | undefined, payload: CanvasObjectPayload | undefined) {
  if (id && payload && isTodoSnapshot(payload.value, id, payload.version)) {
    return payload.value;
  }
}

function useLoadedTodoSnapshot(value: TodoObjectSnapshot | undefined, editing: boolean) {
  const [loaded, setLoaded] = useState(value);
  if (value && value !== loaded) {
    setLoaded(value);
  }

  return value ?? (editing ? loaded : undefined);
}

function TodoPlacementView(props: CanvasObjectViewProps) {
  const { id, object, zoom } = props;
  if (id === undefined) {
    return (
      <div
        className="studio-object-todo__placement-heading"
        style={{ fontSize: Math.max(15, 11 / zoom) }}
        aria-hidden="true"
      >
        <strong>{object.label}</strong>
        <span className="studio-object-todo__placement-count">0/0 完成</span>
      </div>
    );
  }

  return <TodoCanvasBody {...props} />;
}

interface TodoCanvasActivity extends Pick<
  CanvasObjectViewProps,
  'onRetentionChange' | 'onEditingChange'
> {
  readonly hasSnapshot: boolean;
  readonly readOnly: boolean;
  readonly editing: boolean;
  readonly retaining: boolean;
}

function useTodoCanvasActivity({
  hasSnapshot,
  readOnly,
  editing,
  retaining,
  onRetentionChange,
  onEditingChange,
}: TodoCanvasActivity) {
  const active = hasSnapshot && !readOnly && editing;
  const retained = hasSnapshot && retaining;
  const report = useEffectEvent((editing: boolean, retained: boolean) => {
    onEditingChange?.(editing);
    onRetentionChange?.(retained);
  });
  useEffect(() => report(active, retained), [active, retained]);
  useEffect(() => () => report(false, false), []);
}

function TodoCanvasBody({
  id,
  payload,
  content,
  interactive,
  readOnly,
  editRequest,
  focusedReading = false,
  expanded: expandedOnBoard = false,
  locked,
  onOpenPresentation,
  onOpenNativeSource,
  nativeSourceLabel,
  nativeSourceRequest,
  annotationActive,
  onAnnotateContent,
  object,
  geometry,
  zoom,
  request,
  onRetentionChange,
  onEditingChange,
}: CanvasObjectViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expandedEditing, setExpandedEditing] = useState(false);
  const current = useMemo(() => todoPayload(id, payload), [id, payload]);
  const editingContent = editing || expandedEditing;
  const value = useLoadedTodoSnapshot(current, editingContent);
  const keepExpanded = expanded || expandedEditing;
  const nativeExpanded = expandedOnBoard || focusedReading;
  const bodyReadOnly = readOnly || current === undefined;
  useTodoCanvasActivity({
    hasSnapshot: value !== undefined,
    readOnly: bodyReadOnly,
    editing: editingContent,
    retaining: nativeExpanded || editing || keepExpanded,
    onEditingChange,
    onRetentionChange,
  });

  const width = geometry.width * zoom;
  const height = geometry.height * zoom;
  const overview = isTodoOverview(width, height);
  const appearance = {
    paper: object.fill ?? todoPaper,
    uiScale: focusedReading ? 1 : 1 / zoom,
    headingLayout: todoHeadingLayout(width, height),
  };

  if (!value) {
    return (
      content ?? (
        <TodoContentUnavailable
          title={object.label}
          appearance={appearance}
          overview={overview}
          expanded={nativeExpanded}
          focusedReading={focusedReading}
        />
      )
    );
  }

  async function handleEdit(operation: TodoObjectEdit) {
    const receipt = await request({
      name: 'todo.edit',
      expectedVersion: operation.expectedRevision,
      value: operation,
    });

    if (receipt.ok) {
      return todoPayload(operation.objectId, receipt.payload) ?? false;
    }
    if (receipt.conflict) {
      throw new TodoContentConflict(
        receipt.message,
        todoPayload(operation.objectId, receipt.current),
      );
    }
    if (receipt.message) {
      throw new Error(receipt.message);
    }

    return false;
  }

  const open = onOpenPresentation ?? (() => setExpanded(true));
  const nativeControls = {
    onOpenSource: onOpenNativeSource,
    sourceLabel: nativeSourceLabel,
    sourceRequest: nativeSourceRequest,
    annotationActive,
    onAnnotateContent,
  };

  return (
    <>
      <TodoObject
        {...nativeControls}
        value={value}
        interactive={interactive}
        readOnly={bodyReadOnly}
        editRequest={editRequest}
        focusedReading={focusedReading}
        expanded={nativeExpanded}
        movable={!nativeExpanded && !bodyReadOnly}
        locked={locked}
        appearance={appearance}
        overview={overview}
        overviewRows={overview ? visibleTodoOverviewRows(width, height) : undefined}
        onEdit={handleEdit}
        onEditingChange={setEditing}
        onRequestExpand={open}
      />
      {!nativeExpanded && !onOpenPresentation && (
        <Dialog
          title={value.title}
          open={expanded}
          closeLabel="关闭待办"
          onRequestClose={() => setExpanded(false)}
        >
          {keepExpanded && (
            <TodoObject
              {...nativeControls}
              value={value}
              readOnly={bodyReadOnly}
              appearance={appearance}
              expanded
              onEdit={handleEdit}
              onEditingChange={setExpandedEditing}
            />
          )}
        </Dialog>
      )}
    </>
  );
}

export const todoExtension: CanvasObjectExtension = {
  kind: 'todo',
  placement: { kind: 'todo', label: '任务清单', width: 540, height: 420, fill: todoPaper },
  capabilities: {
    move: true,
    resize: true,
    rotate: false,
    connect: true,
    content: 'native',
    managesAnnotationEditing: true,
  },
  View: TodoPlacementView,
};
