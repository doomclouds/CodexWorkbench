import type {
  CanvasEditIntent,
  CanvasObject,
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
  ],
};

interface ReceiptFixtureState {
  scene: CanvasScene;
  pending: readonly CanvasEditIntent[];
  intentCount: number;
  receiptCount: number;
  lastRejectedId?: string;
  lastReceipt: string;
  lastIntent?: CanvasEditIntent;
}

type ReceiptFixtureAction =
  | { type: 'edit'; intent: CanvasEditIntent }
  | { type: 'receipt'; interactionId: string; accepted: boolean };

export const initialReceiptState: ReceiptFixtureState = {
  scene: initialScene,
  pending: [],
  intentCount: 0,
  receiptCount: 0,
  lastReceipt: '尚无回执',
};

function confirmEdit(scene: CanvasScene, intent: CanvasEditIntent): CanvasScene | undefined {
  const changes = new Map(intent.changes.map((change) => [change.id, change]));

  function applyChange(object: CanvasObject): CanvasObject {
    const change = changes.get(object.id);
    if (!change || change.expectedVersion !== object.version || object.locked) {
      return object;
    }

    changes.delete(object.id);

    return { ...object, geometry: change.geometry, version: object.version + 1 };
  }

  const objects = scene.objects.map(applyChange);
  if (changes.size === 0) {
    return { ...scene, revision: scene.revision + 1, objects };
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
