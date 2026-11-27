import {
  BoardRoomGestureKind,
  type BoardRoomGestureGeometry as WireGestureChange,
  type BoardRoomGesturePreview as WireGesture,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import type { BoardRoomGestureChange, BoardRoomGesturePreview } from './contracts.js';

const gestureKinds = {
  move: BoardRoomGestureKind.MOVE,
  resize: BoardRoomGestureKind.RESIZE,
  rotate: BoardRoomGestureKind.ROTATE,
} as const;

const domainKinds = new Map<BoardRoomGestureKind, BoardRoomGesturePreview['kind']>([
  [gestureKinds.move, 'move'],
  [gestureKinds.resize, 'resize'],
  [gestureKinds.rotate, 'rotate'],
]);

function readGestureChange(source: WireGestureChange): BoardRoomGestureChange {
  const { objectId, geometry } = source;
  const expectedVersion = Number(source.expectedGeometryVersion);
  if (!objectId.trim() || !Number.isSafeInteger(expectedVersion) || !geometry) {
    throw new Error('房间手势缺少有效对象、版本或几何。');
  }

  const { x, y, width, height, rotation } = geometry;
  const finite = [x, y, width, height, rotation].every(Number.isFinite);
  if (!finite || Math.min(width, height) <= 0) {
    throw new Error('房间手势包含无效几何。');
  }

  return { id: objectId, expectedVersion, geometry: { x, y, width, height, rotation } };
}

export function readRoomGesture(
  source: WireGesture | undefined,
): BoardRoomGesturePreview | undefined {
  if (!source) {
    return;
  }

  const kind = domainKinds.get(source.kind);
  if (!kind || source.changes.length === 0 || source.changes.length > 32) {
    throw new Error('房间手势类型或大小无效。');
  }

  return { kind, changes: source.changes.map(readGestureChange) };
}

export function writeRoomGesture(source: BoardRoomGesturePreview | undefined) {
  if (!source) {
    return;
  }

  return {
    kind: gestureKinds[source.kind],
    changes: source.changes.map(({ id, expectedVersion, geometry }) => ({
      objectId: id,
      expectedGeometryVersion: BigInt(expectedVersion),
      geometry,
    })),
  };
}
