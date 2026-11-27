import type { WhiteboardObject, WhiteboardScene } from './contracts.js';
import type { BoardEditReceipt } from './edits-types.js';

export type AppliedBoardEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;
type BoardSceneChanges = Pick<AppliedBoardEdit, 'removedIds' | 'objects' | 'order'>;
type ConfirmedSceneEdit = BoardSceneChanges & Pick<AppliedBoardEdit, 'revision' | 'customColors'>;

export interface WhiteboardContentChange {
  readonly revision: bigint;
  readonly changedObjectIds: readonly string[];
  readonly removedObjectIds: readonly string[];
  readonly changedObjects?: readonly WhiteboardObject[];
  readonly refreshScene: boolean;
}

const existingOrder: readonly string[] = [];

function coversChange(change: WhiteboardContentChange, metadata: readonly WhiteboardObject[]) {
  const changed = new Set(change.changedObjectIds);
  const removed = new Set(change.removedObjectIds);
  const metadataIds = new Set(metadata.map(({ id }) => id));
  const distinctChanges = changed.size === change.changedObjectIds.length;
  const distinctMetadata = metadataIds.size === metadata.length;
  const sameSize = metadataIds.size === changed.size;
  const matching = metadata.every(({ id }) => changed.has(id) && !removed.has(id));

  return distinctChanges && distinctMetadata && sameSize ? matching : false;
}

export function mergeRoomContent(
  scene: WhiteboardScene,
  change: WhiteboardContentChange,
): WhiteboardScene | undefined {
  const objects = change.changedObjects ?? [];
  if (change.refreshScene || !coversChange(change, objects)) {
    return undefined;
  }

  return mergeConfirmedEdit(scene, {
    revision: change.revision,
    removedIds: change.removedObjectIds,
    objects,
    order: existingOrder,
  });
}

export function mergeConfirmedEdit(
  scene: WhiteboardScene,
  receipt: ConfirmedSceneEdit,
): WhiteboardScene | undefined {
  const { revision, customColors } = receipt;
  if (revision < scene.revision) {
    return scene;
  }

  const palette = customColors === undefined ? undefined : { customColors };
  if (revision === scene.revision) {
    return palette ? { ...scene, ...palette } : scene;
  }
  if (revision !== scene.revision + 1n) {
    return undefined;
  }

  const next = projectBoardChanges(scene, receipt);

  return next && { ...next, ...palette, revision };
}

export function projectBoardChanges(
  scene: WhiteboardScene,
  changes: BoardSceneChanges,
): WhiteboardScene | undefined {
  const objects = new Map(scene.objects.map((object) => [object.id, object]));
  for (const id of changes.removedIds) {
    objects.delete(id);
  }
  for (const object of changes.objects) {
    objects.set(object.id, object);
  }

  const { order } = changes;
  if (!order.length) {
    return { ...scene, objects: [...objects.values()] };
  }

  const ordered = order.flatMap((id) => {
    const object = objects.get(id);

    return object ? [object] : [];
  });

  if (
    ordered.length !== objects.size ||
    order.length !== objects.size ||
    new Set(order).size !== order.length
  ) {
    return undefined;
  }

  return { ...scene, objects: ordered };
}
