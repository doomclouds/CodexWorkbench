import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Dialog, StatusText } from '../../../base/index.js';
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
import { isTodoOverview, TodoObject } from './TodoObject.js';
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

function todoPayload(id: string, payload: CanvasObjectPayload | undefined) {
  if (payload && isTodoSnapshot(payload.value, id, payload.version)) {
    return payload.value;
  }
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
}: CanvasObjectViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expandedEditing, setExpandedEditing] = useState(false);
  const value = useMemo(() => (id ? todoPayload(id, payload) : undefined), [id, payload]);
  const keepExpanded = expanded || expandedEditing;
  const nativeExpanded = expandedOnBoard || focusedReading;
  const retain = value !== undefined && (nativeExpanded || editing || keepExpanded);
  const publishRetention = useEffectEvent((retain: boolean) => onRetentionChange?.(retain));
  useEffect(() => {
    publishRetention(retain);
  }, [retain]);
  useEffect(() => () => publishRetention(false), []);

  if (!value) {
    return content ?? (id ? <StatusText message="任务清单正文尚未加载" /> : null);
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

  const appearance = { paper: object.fill ?? todoPaper, uiScale: focusedReading ? 1 : 1 / zoom };
  const overview = isTodoOverview(geometry.width * zoom, geometry.height * zoom);
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
        readOnly={readOnly}
        editRequest={editRequest}
        focusedReading={focusedReading}
        expanded={nativeExpanded}
        movable={!nativeExpanded && !readOnly}
        locked={locked}
        appearance={appearance}
        overview={overview}
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
              readOnly={readOnly}
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
  capabilities: { move: true, resize: true, rotate: false, connect: true, content: 'native' },
  View: TodoCanvasBody,
};
