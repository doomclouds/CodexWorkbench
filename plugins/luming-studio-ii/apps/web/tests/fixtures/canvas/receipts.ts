import type {
  CanvasConnectionEndpoint,
  CanvasCreateIntent,
  CanvasDuplicateIntent,
  CanvasEditIntent,
  CanvasObject,
  CanvasObjectChange,
  CanvasScene,
} from '../../../src/ui/domain/canvas/index.js';

export const initialScene: CanvasScene = {
  boardId: 'canvas-fixture',
  revision: 1,
  objects: [
    {
      id: 'background',
      kind: 'shape',
      label: '底层图形',
      geometry: { x: 48, y: 102, width: 216, height: 147, rotation: 0 },
      version: 1,
    },
    {
      id: 'foreground',
      kind: 'shape',
      label: '前层图形',
      geometry: { x: 152, y: 158, width: 226, height: 142, rotation: 0 },
      version: 1,
    },
    {
      id: 'locked',
      kind: 'shape',
      label: '锁定图形',
      geometry: { x: 64, y: 364, width: 185, height: 96, rotation: 0 },
      version: 1,
      locked: true,
    },
    {
      id: 'native',
      kind: 'native',
      label: '原生内容',
      geometry: { x: 426, y: 84, width: 278, height: 324, rotation: 0 },
      version: 1,
    },
    {
      id: 'remote',
      kind: 'shape',
      label: '远处图形',
      geometry: { x: 1460, y: 192, width: 210, height: 132, rotation: 0 },
      version: 1,
    },
    {
      id: 'html',
      kind: 'html',
      label: 'HTML 预览',
      geometry: { x: 736, y: 84, width: 288, height: 220, rotation: 0 },
      version: 1,
    },
    {
      id: 'document',
      kind: 'document',
      label: '评审纪要',
      geometry: { x: 1056, y: 84, width: 280, height: 220, rotation: 0 },
      version: 1,
    },
    {
      id: 'todo',
      kind: 'todo',
      label: '交接待办',
      geometry: { x: 426, y: 448, width: 278, height: 120, rotation: 0 },
      version: 1,
    },
    {
      id: 'table',
      kind: 'table',
      label: '验收记录',
      geometry: { x: 736, y: 356, width: 288, height: 212, rotation: 0 },
      version: 1,
    },
    {
      id: 'connector',
      kind: 'connector',
      label: '锁定检查',
      geometry: { x: 249, y: 412, width: 177, height: 96, rotation: 0 },
      connection: {
        start: { point: { x: 249, y: 412 }, attachment: { objectId: 'locked', port: 'right' } },
        end: { point: { x: 426, y: 508 }, attachment: { objectId: 'todo', port: 'left' } },
      },
      version: 1,
    },
    {
      id: 'section',
      kind: 'section',
      label: '可穿透分区',
      transparent: true,
      geometry: { x: 30, y: 58, width: 370, height: 272, rotation: 0 },
      version: 1,
    },
    {
      id: 'nested-section',
      kind: 'section',
      parentId: 'section',
      label: '内层分区',
      transparent: true,
      geometry: { x: 112, y: 140, width: 280, height: 178, rotation: 0 },
      version: 1,
    },
  ],
};

export interface ReceiptFixtureState {
  scene: CanvasScene;
  pending: readonly CanvasEditIntent[];
  intentCount: number;
  receiptCount: number;
  lastRejectedId?: string;
  lastReceipt: string;
  lastIntent?: CanvasEditIntent;
}

export type ReceiptFixtureAction =
  | { type: 'edit'; intent: CanvasEditIntent }
  | { type: 'receipt'; interactionId: string; accepted: boolean };

export const initialReceiptState: ReceiptFixtureState = {
  scene: initialScene,
  pending: [],
  intentCount: 0,
  receiptCount: 0,
  lastReceipt: '尚无回执',
};

function applyObjectChange(object: CanvasObject, change: CanvasObjectChange): CanvasObject {
  const updated = { ...object, geometry: change.geometry, version: object.version + 1 };
  if (updated.kind === 'connector' && change.connection) {
    return { ...updated, connection: change.connection };
  }
  if (updated.kind === 'ink' && change.ink) {
    return { ...updated, ink: change.ink };
  }

  return updated;
}

function remapEndpoint(
  endpoint: CanvasConnectionEndpoint,
  copies: ReadonlyMap<string, string>,
): CanvasConnectionEndpoint {
  const { attachment } = endpoint;
  if (!attachment) {
    return endpoint;
  }

  const objectId = copies.get(attachment.objectId);

  return objectId ? { ...endpoint, attachment: { ...attachment, objectId } } : endpoint;
}

function copyObject(
  object: CanvasObject,
  change: CanvasObjectChange,
  id: string,
  interactionId: string,
  copies: ReadonlyMap<string, string>,
): CanvasObject {
  const { groupId, parentId, ...updated } = applyObjectChange(object, change);
  const copiedParent = parentId ? copies.get(parentId) : undefined;
  const copy = {
    ...updated,
    id,
    version: 1,
    groupId: groupId ? interactionId + ':' + groupId : undefined,
    parentId: copiedParent,
  };

  if (copy.kind === 'connector') {
    const { connection } = copy;

    return {
      ...copy,
      connection: {
        ...connection,
        start: remapEndpoint(connection.start, copies),
        end: remapEndpoint(connection.end, copies),
      },
    };
  }

  return copy;
}

function confirmDuplicate(
  scene: CanvasScene,
  intent: CanvasDuplicateIntent,
): CanvasScene | undefined {
  const changes = new Map(intent.sources.map((source) => [source.id, source]));
  const copies = new Map(intent.sources.map(({ id }) => [id, intent.interactionId + ':' + id]));
  const objects: CanvasObject[] = [];
  for (const object of scene.objects) {
    const change = changes.get(object.id);
    const copyId = copies.get(object.id);
    if (change && copyId) {
      if (change.expectedVersion !== object.version || object.locked) {
        return undefined;
      }

      objects.push(copyObject(object, change, copyId, intent.interactionId, copies));
    }
  }
  if (objects.length === changes.size) {
    return { ...scene, revision: scene.revision + 1, objects: [...scene.objects, ...objects] };
  }
}

function confirmCreate(scene: CanvasScene, intent: CanvasCreateIntent): CanvasScene | undefined {
  const object = { ...intent.object, id: intent.interactionId, version: 1 };
  const { link } = intent;
  const revision = scene.revision + 1;
  if (!link) {
    return { ...scene, revision, objects: [...scene.objects, object] };
  }

  const { source, target } = link;
  const origin = scene.objects.find(({ id }) => id === source.objectId);
  if (origin?.version !== source.expectedVersion || origin.locked) {
    return undefined;
  }

  const start = { point: source.point, attachment: { objectId: origin.id, port: source.port } };
  const end = { point: target.point, attachment: { objectId: object.id, port: target.port } };
  const geometry = {
    x: Math.min(source.point.x, target.point.x),
    y: Math.min(source.point.y, target.point.y),
    width: Math.max(1, Math.abs(target.point.x - source.point.x)),
    height: Math.max(1, Math.abs(target.point.y - source.point.y)),
    rotation: 0,
  };
  const connector: CanvasObject = {
    id: intent.interactionId + ':connector',
    kind: 'connector',
    label: '',
    connection: { start, end },
    version: 1,
    geometry,
  };

  return { ...scene, revision, objects: [...scene.objects, object, connector] };
}

function confirmEdit(scene: CanvasScene, intent: CanvasEditIntent): CanvasScene | undefined {
  const revision = scene.revision + 1;
  if (intent.kind === 'create') {
    return confirmCreate(scene, intent);
  }
  if (intent.kind === 'duplicate') {
    return confirmDuplicate(scene, intent);
  }

  const changes = new Map(intent.changes.map((change) => [change.id, change]));

  function applyChange(object: CanvasObject): CanvasObject {
    const change = changes.get(object.id);
    if (!change || change.expectedVersion !== object.version || object.locked) {
      return object;
    }

    changes.delete(object.id);

    return applyObjectChange(object, change);
  }

  const objects = scene.objects.map(applyChange);
  if (changes.size === 0) {
    return { ...scene, revision, objects };
  }
}

export function reduceReceipts(
  state: ReceiptFixtureState,
  action: ReceiptFixtureAction,
): ReceiptFixtureState {
  if (action.type === 'edit') {
    return {
      ...state,
      pending: [...state.pending, action.intent],
      intentCount: state.intentCount + 1,
      lastIntent: action.intent,
    };
  }

  const intent = state.pending.find((item) => item.interactionId === action.interactionId);
  const receiptCount = state.receiptCount + 1;
  if (!intent) {
    return { ...state, receiptCount, lastReceipt: '已忽略迟到回执' };
  }

  const pending = state.pending.filter((item) => item !== intent);
  const scene = action.accepted ? confirmEdit(state.scene, intent) : undefined;
  if (scene) {
    return { ...state, scene, pending, receiptCount, lastReceipt: '已确认' };
  }

  return {
    ...state,
    pending,
    receiptCount,
    lastRejectedId: intent.interactionId,
    lastReceipt: action.accepted ? '已拒绝版本冲突' : '已拒绝',
  };
}
