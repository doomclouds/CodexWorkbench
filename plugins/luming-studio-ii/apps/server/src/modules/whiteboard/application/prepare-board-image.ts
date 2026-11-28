import {
  encodeSafeSvgImage,
  inspectVideo,
  looksLikeSvgImage,
  maximumBoardImageBytes,
  planDocumentImageAsset,
  readSafeSvgImage,
  type Actor,
  type BoardEditDecision,
  type BoardEditIdentity,
  type BoardEditReceipt,
  type BoardHeader,
  type SafeSvgImage,
} from '../domain/index.js';
import type { BoardEditRepository, BoardEditWriter } from '../ports/index.js';
import { checkBoardEditBeforePreparation, runBoardEdit } from './run-board-edit.js';

export type ValidateUploadedSvg = (svg: string) => Promise<boolean>;

interface ImageCommand<Operation> extends BoardEditIdentity {
  readonly operation: Operation;
  readonly signature: string;
}

type ImageEditPlan<Operation> = (
  writer: BoardEditWriter,
  board: BoardHeader,
  operation: Operation,
  vector?: SafeSvgImage,
) => BoardEditDecision;

export function readArchivedSvgImage(content: Uint8Array): Uint8Array | undefined {
  if (content.byteLength > maximumBoardImageBytes) {
    return undefined;
  }

  const svg = readSafeSvgImage(content);
  if (!svg) {
    return undefined;
  }

  const bytes = encodeSafeSvgImage(svg, maximumBoardImageBytes);

  return bytes.byteLength <= maximumBoardImageBytes ? bytes : undefined;
}

export async function prepareBoardAsset(
  boardId: string,
  assetId: string,
  content: Uint8Array,
  validateUploadedSvg: ValidateUploadedSvg,
) {
  let vector: SafeSvgImage | undefined;
  if (looksLikeSvgImage(content)) {
    vector = readSafeSvgImage(content);
    if (!vector || !(await validateUploadedSvg(vector.markup))) {
      return undefined;
    }
  }

  const image = planDocumentImageAsset(boardId, assetId, content, vector);
  if (image.kind === 'changes') {
    const [{ mimeType, bytes }] = image.assets;

    return { mimeType, bytes };
  }

  const mimeType = inspectVideo(content);

  return mimeType ? { mimeType, bytes: content } : undefined;
}

export function createImageEdit(
  repository: BoardEditRepository,
  now: () => number,
  validateUploadedSvg?: ValidateUploadedSvg,
) {
  return async function editImage<Operation extends { readonly content: Uint8Array }>(
    actor: Actor,
    command: ImageCommand<Operation>,
    plan: ImageEditPlan<Operation>,
  ): Promise<BoardEditReceipt> {
    const { operation, signature, boardId, commandId } = command;
    const identity = { boardId, commandId };
    let vector: SafeSvgImage | undefined;
    if (looksLikeSvgImage(operation.content)) {
      const prior = checkBoardEditBeforePreparation(repository, actor, identity, signature);
      if (prior) {
        return prior;
      }
      if (operation.content.byteLength > maximumBoardImageBytes) {
        return { ...identity, outcome: { kind: 'rejected', reason: 'tooLarge' } };
      }

      vector = readSafeSvgImage(operation.content);
      if (!vector || !validateUploadedSvg || !(await validateUploadedSvg(vector.markup))) {
        return { ...identity, outcome: { kind: 'rejected', reason: 'invalidImage' } };
      }
    }

    return runBoardEdit(
      repository,
      actor,
      identity,
      { kind: 'image', signature, savedAtMillis: now() },
      (writer, board) => plan(writer, board, operation, vector),
    );
  };
}
