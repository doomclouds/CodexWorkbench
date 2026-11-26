import type {
  EditBoardGeometryOperation,
  WhiteboardInitialPayload,
  WhiteboardLayerDirection,
  WhiteboardObjectDraft,
} from '../../data/whiteboard/index.js';
import type {
  CanvasConnectorHead,
  CanvasEditIntent,
  CanvasObject,
  CanvasObjectDraft,
} from '../../ui/domain/canvas/index.js';

export type GeometrySelectionAction =
  | { readonly kind: 'changeLock'; readonly locked: boolean }
  | { readonly kind: 'delete' }
  | { readonly kind: 'reorder'; readonly direction: WhiteboardLayerDirection }
  | { readonly kind: 'duplicate' }
  | {
      readonly kind: 'connectorHead';
      readonly end: 'start' | 'end';
      readonly head: CanvasConnectorHead;
    };

const duplicateOffset = { x: 32, y: 32 };

function outlineFor(draft: CanvasObjectDraft): WhiteboardObjectDraft['detail'] {
  if (draft.kind === 'shape') {
    return { kind: 'shape', outline: draft.shape ?? 'rounded' };
  }
  if (draft.kind === 'section') {
    return { kind: 'section', transparent: draft.transparent ?? false };
  }
  if (draft.kind === 'ink') {
    return { kind: 'ink', width: draft.ink.width };
  }
  if (draft.kind === 'connector') {
    return { kind: 'connector', connection: draft.connection };
  }
}

function payloadFor(draft: CanvasObjectDraft): WhiteboardInitialPayload | undefined {
  if (draft.kind === 'text' || draft.kind === 'note') {
    return { kind: 'text', value: { text: '' } };
  }
  if (draft.kind === 'document') {
    return {
      kind: 'document',
      value: { title: draft.label, document: { schemaVersion: 1, blocks: [] } },
    };
  }
  if (draft.kind === 'todo') {
    return { kind: 'todo', value: { title: draft.label, items: [] } };
  }

  if (draft.kind === 'html') {
    const html = draft.metadata?.html;

    return typeof html === 'string'
      ? { kind: 'embed', value: { title: draft.label, html } }
      : undefined;
  }

  if (draft.kind === 'sticker') {
    const sticker = draft.metadata?.stickerId;

    return typeof sticker === 'string' ? { kind: 'sticker', value: { id: sticker } } : undefined;
  }
  if (draft.kind === 'ink') {
    return { kind: 'ink', points: draft.ink.points };
  }
}

function createOperation(id: string, draft: CanvasObjectDraft): EditBoardGeometryOperation {
  const { kind, label, geometry, fill, stroke, strokeWidth, dashed, hollow } = draft;

  return {
    kind: 'create',
    object: {
      id,
      kind,
      label,
      geometry,
      appearance: { fill, stroke, strokeWidth, dashed: dashed ?? false, hollow: hollow ?? false },
      detail: outlineFor(draft),
    },
    initialPayload: payloadFor(draft),
  };
}

export function geometryOperation(
  intent: Exclude<CanvasEditIntent, { kind: 'move' }>,
  commandId: string,
): EditBoardGeometryOperation | undefined {
  switch (intent.kind) {
    case 'create':
      return intent.link ? undefined : createOperation(commandId, intent.object);
    case 'duplicate':
      return {
        kind: 'duplicate',
        delta: intent.delta,
        targets: intent.sources.map(({ id, expectedVersion }, index) => ({
          source: { id, expectedGeometryVersion: BigInt(expectedVersion) },
          newObjectId: commandId + '-' + (index + 1),
        })),
      };
    case 'resize':
    case 'rotate':
    case 'connect':
      return {
        kind: 'transform',
        transform: intent.kind,
        objects: intent.changes.map(({ id, expectedVersion, geometry, connection, ink }) => ({
          target: { id, expectedGeometryVersion: BigInt(expectedVersion) },
          geometry,
          connection,
          ink: ink?.points,
        })),
      };
  }
}

export function selectionOperation(
  action: GeometrySelectionAction,
  ids: readonly string[],
  objectsById: ReadonlyMap<string, CanvasObject>,
  revision: bigint,
  commandId: string,
): EditBoardGeometryOperation | undefined {
  const targets = [];
  for (const id of new Set(ids)) {
    const object = objectsById.get(id);
    const changesLockedGeometry =
      object?.locked && action.kind !== 'changeLock' && action.kind !== 'duplicate';

    if (!object || changesLockedGeometry) {
      return undefined;
    }

    targets.push({ id, expectedGeometryVersion: BigInt(object.version) });
  }

  if (targets.length === 0) {
    return undefined;
  }

  switch (action.kind) {
    case 'changeLock':
    case 'delete':
      return { ...action, targets };
    case 'reorder':
      return { ...action, targets, expectedBoardRevision: revision };
    case 'duplicate':
      return {
        kind: 'duplicate',
        delta: duplicateOffset,
        targets: targets.map((source, index) => ({
          source,
          newObjectId: commandId + '-' + (index + 1),
        })),
      };
    case 'connectorHead': {
      const [target] = targets;
      const object = target && objectsById.get(target.id);
      if (targets.length !== 1 || !target || object?.kind !== 'connector') {
        return undefined;
      }

      const endpoint = action.end === 'start' ? 'startHead' : 'endHead';

      return {
        kind: 'transform',
        transform: 'connect',
        objects: [
          {
            target,
            geometry: object.geometry,
            connection: { ...object.connection, [endpoint]: action.head },
          },
        ],
      };
    }
  }
}

export function selectionForOperation(
  operation: EditBoardGeometryOperation,
): readonly string[] | undefined {
  if (operation.kind === 'create') {
    return [operation.object.id];
  }
  if (operation.kind === 'duplicate') {
    return operation.targets.map(({ newObjectId }) => newObjectId);
  }
  if (operation.kind === 'delete') {
    return [];
  }
}
