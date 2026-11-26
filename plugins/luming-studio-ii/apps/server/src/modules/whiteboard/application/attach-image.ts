import { planImageChanges } from '../domain/index.js';
import type { BoardEditDecision, BoardHeader, ImageOperation } from '../domain/index.js';
import type { BoardEditWriter } from '../ports/index.js';

export function planImageEdit(
  writer: BoardEditWriter,
  board: BoardHeader,
  operation: ImageOperation,
): BoardEditDecision {
  const { boardId } = board;
  const plan = planImageChanges(boardId, operation);
  if (plan.kind === 'rejected') {
    return plan;
  }

  const [asset] = plan.assets;
  const objectIdUsed = writer.hasUsedObjectId(boardId, operation.objectId);
  const assetIdUsed = writer.getExportAsset?.(boardId, asset.assetId, 0);
  if (objectIdUsed || assetIdUsed) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  return plan;
}
