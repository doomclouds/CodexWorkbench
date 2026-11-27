import {
  looksLikeSvgImage,
  svgForImagePreview,
  type Actor,
  type BoardEditIdentity,
  type BoardEditReceipt,
  type ImageOperation,
} from '../domain/index.js';
import type { BoardEditRepository } from '../ports/index.js';
import { planImageEdit } from './attach-image.js';
import { checkBoardEditBeforePreparation, runBoardEdit } from './run-board-edit.js';

export type RenderUploadedSvg = (svg: string) => Promise<Uint8Array | undefined>;

interface ImageCommand extends BoardEditIdentity {
  readonly operation: ImageOperation;
  readonly signature: string;
}

export function createAttachImage(
  repository: BoardEditRepository,
  now: () => number,
  renderUploadedSvg?: RenderUploadedSvg,
) {
  return async (actor: Actor, command: ImageCommand): Promise<BoardEditReceipt> => {
    const { operation, signature, boardId, commandId } = command;
    const identity = { boardId, commandId };
    let prepared = operation;
    if (looksLikeSvgImage(operation.content)) {
      const prior = checkBoardEditBeforePreparation(repository, actor, identity, signature);
      if (prior) {
        return prior;
      }

      const svg = svgForImagePreview(operation.content);
      const raster = svg && renderUploadedSvg ? await renderUploadedSvg(svg) : undefined;
      if (!raster) {
        return { ...identity, outcome: { kind: 'rejected', reason: 'invalidImage' } };
      }

      prepared = { ...operation, content: raster };
    }

    return runBoardEdit(
      repository,
      actor,
      identity,
      { kind: 'image', signature, savedAtMillis: now() },
      (writer, board) => planImageEdit(writer, board, prepared),
    );
  };
}
