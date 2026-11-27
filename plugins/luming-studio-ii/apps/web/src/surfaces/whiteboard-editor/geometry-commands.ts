import type {
  EditBoardGeometryOperation,
  WhiteboardArrangePreset,
  WhiteboardInitialPayload,
  WhiteboardLayerDirection,
  WhiteboardObjectDraft,
  WhiteboardStylePatch,
} from '../../data/whiteboard/index.js';
import type {
  CanvasConnectorHead,
  CanvasEditIntent,
  CanvasObject,
  CanvasObjectDraft,
  CanvasPoint,
} from '../../ui/domain/canvas/index.js';

export type GeometrySelectionAction =
  | { readonly kind: 'changeLock'; readonly locked: boolean }
  | { readonly kind: 'delete' }
  | { readonly kind: 'reorder'; readonly direction: WhiteboardLayerDirection }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'group' }
  | { readonly kind: 'ungroup' }
  | { readonly kind: 'createSection' }
  | { readonly kind: 'arrange'; readonly preset: WhiteboardArrangePreset }
  | {
      readonly kind: 'style';
      readonly patch: WhiteboardStylePatch;
      readonly rememberColor?: string;
    }
  | { readonly kind: 'removeCustomColor'; readonly color: string }
  | {
      readonly kind: 'connectorHead';
      readonly end: 'start' | 'end';
      readonly head: CanvasConnectorHead;
    };

const duplicateOffset = { x: 32, y: 32 };
const adjacentGap = 24;
const literalPaint = /^(?:transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/iu;

function persistedPaint(value: string | undefined) {
  return value !== undefined && literalPaint.test(value) ? value : undefined;
}

export interface BoardClipboardSelection {
  readonly sourceBoardId: string;
  readonly sourceRevision: bigint;
  readonly objectIds: readonly string[];
}

export function pasteOperation(source: BoardClipboardSelection, commandId: string) {
  const { sourceBoardId, sourceRevision, objectIds } = source;
  return {
    kind: 'paste',
    sourceBoardId,
    sourceRevision,
    targets: objectIds.map((sourceObjectId, index) => ({
      sourceObjectId,
      newObjectId: commandId + '-' + (index + 1),
    })),
    delta: duplicateOffset,
  } satisfies EditBoardGeometryOperation;
}

export function clipboardTextDraft(text: string, point: CanvasPoint): CanvasObjectDraft {
  const height = Math.max(70, Math.min(600, text.split('\n').length * 30));
  return {
    kind: 'text',
    label: '',
    geometry: { ...point, width: 380, height, rotation: 0 },
    metadata: { text },
  };
}

export function adjacentTextDraft(
  source: CanvasObject,
  style?: WhiteboardStylePatch,
): CanvasObjectDraft {
  const { x, y, width, height } = source.geometry;
  const point =
    source.kind === 'text' ? { x, y: y + height + adjacentGap } : { x: x + width + adjacentGap, y };

  return {
    ...source,
    label: '',
    geometry: { ...point, width, height, rotation: 0 },
    metadata: { text: '', textColor: style?.textColor, fontSize: style?.fontSize },
  };
}

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

function initialText(metadata?: Readonly<Record<string, unknown>>): WhiteboardInitialPayload {
  const { text, textColor, fontSize } = metadata ?? {};
  return {
    kind: 'text',
    value: {
      text: typeof text === 'string' ? text : '',
      color: typeof textColor === 'string' ? textColor : undefined,
      fontSize: typeof fontSize === 'number' ? fontSize : undefined,
    },
  };
}

function payloadFor(draft: CanvasObjectDraft): WhiteboardInitialPayload | undefined {
  const textKind = draft.kind === 'text' || draft.kind === 'note';
  const explicitText = typeof draft.metadata?.text === 'string';
  if (textKind || explicitText) {
    return initialText(draft.metadata);
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
  if (draft.kind === 'link') {
    const href = draft.metadata?.href;
    return typeof href === 'string' ? { kind: 'link', value: { href } } : undefined;
  }
  if (draft.kind === 'ink') {
    return { kind: 'ink', points: draft.ink.points };
  }
}

function createOperation(
  id: string,
  draft: CanvasObjectDraft,
): Extract<EditBoardGeometryOperation, { kind: 'create' }> {
  const { kind, label, geometry, fill, stroke, strokeWidth, dashed, hollow } = draft;

  return {
    kind: 'create',
    object: {
      id,
      kind,
      label,
      geometry,
      appearance: {
        fill: persistedPaint(fill),
        stroke: persistedPaint(stroke),
        strokeWidth,
        dashed: dashed ?? false,
        hollow: hollow ?? false,
      },
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
    case 'create': {
      const operation = createOperation(commandId, intent.object);
      const link = intent.link;
      if (!link) {
        return operation;
      }

      return {
        ...operation,
        attachment: {
          source: {
            id: link.source.objectId,
            expectedGeometryVersion: BigInt(link.source.expectedVersion),
          },
          sourcePort: link.source.port,
          targetPort: link.target.port,
          connectorId: commandId + '-connector',
          stroke: persistedPaint(link.style?.stroke),
          strokeWidth: link.style?.width,
        },
      };
    }
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
  payloadVersion: (objectId: string) => bigint | undefined,
): EditBoardGeometryOperation | undefined {
  if (action.kind === 'removeCustomColor') {
    return action;
  }

  const targets = [];
  for (const id of new Set(ids)) {
    const object = objectsById.get(id);
    const changesLockedGeometry =
      object?.locked &&
      action.kind !== 'changeLock' &&
      action.kind !== 'duplicate' &&
      action.kind !== 'style';

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
    case 'ungroup':
    case 'arrange':
      return { ...action, targets };
    case 'group':
      return { kind: 'group', targets, groupId: commandId };
    case 'createSection':
      return { kind: 'createSection', targets, sectionId: commandId };
    case 'style':
      return {
        ...action,
        targets: targets.map((target) => ({
          target,
          expectedPayloadVersion: payloadVersion(target.id),
        })),
      };
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
  if (operation.kind === 'paste') {
    return operation.targets.map(({ newObjectId }) => newObjectId);
  }
  if (operation.kind === 'createSection') {
    return [operation.sectionId];
  }
  if (operation.kind === 'delete') {
    return [];
  }
}
