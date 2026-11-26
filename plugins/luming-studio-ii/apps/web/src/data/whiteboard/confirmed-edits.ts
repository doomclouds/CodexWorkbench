import type { WhiteboardScene } from './contracts.js';
import type { BoardEditReceipt } from './edits-types.js';

export type AppliedBoardEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

export function mergeConfirmedEdit(
  scene: WhiteboardScene,
  receipt: AppliedBoardEdit,
): WhiteboardScene | undefined {
  if (receipt.revision <= scene.revision) {
    return scene;
  }
  if (receipt.revision !== scene.revision + 1n) {
    return undefined;
  }

  const objects = new Map(scene.objects.map((object) => [object.id, object]));
  for (const id of receipt.removedIds) {
    objects.delete(id);
  }
  for (const object of receipt.objects) {
    objects.set(object.id, object);
  }

  const { order } = receipt;
  if (!order.length) {
    return { ...scene, revision: receipt.revision, objects: [...objects.values()] };
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

  return { ...scene, revision: receipt.revision, objects: ordered };
}
