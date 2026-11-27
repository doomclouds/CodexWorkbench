import { planImageChanges, planVideoChanges } from '../domain/index.js';
import type {
  BoardEditDecision,
  BoardHeader,
  ImageOperation,
  SafeSvgImage,
  VideoOperation,
} from '../domain/index.js';
import type { BoardEditWriter } from '../ports/index.js';

function reserveAttachment(
  writer: BoardEditWriter,
  board: BoardHeader,
  operation: ImageOperation,
  plan: ReturnType<typeof planImageChanges | typeof planVideoChanges>,
): BoardEditDecision {
  const { boardId } = board;
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

export function planImageEdit(
  writer: BoardEditWriter,
  board: BoardHeader,
  operation: ImageOperation,
  vector?: SafeSvgImage,
): BoardEditDecision {
  return reserveAttachment(
    writer,
    board,
    operation,
    planImageChanges(board.boardId, operation, vector),
  );
}

export function planVideoEdit(
  writer: BoardEditWriter,
  board: BoardHeader,
  operation: VideoOperation,
): BoardEditDecision {
  return reserveAttachment(writer, board, operation, planVideoChanges(board.boardId, operation));
}
