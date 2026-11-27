import {
  planDocumentImageAsset,
  type BoardEditDecision,
  type BoardEditReceipt,
  type BoardHeader,
  type SafeSvgImage,
} from '../domain/index.js';
import type { BoardEditWriter } from '../ports/index.js';

export interface DocumentImageOperation {
  readonly objectId: string;
  readonly assetId: string;
  readonly content: Uint8Array;
}

export interface DocumentImageUpload {
  readonly receipt: BoardEditReceipt;
  readonly assetUrl?: string;
}

export function planDocumentImageUpload(
  writer: BoardEditWriter,
  { boardId }: BoardHeader,
  operation: DocumentImageOperation,
  vector?: SafeSvgImage,
): BoardEditDecision {
  const { objectId, assetId, content } = operation;
  const [document] = writer.getObjects(boardId, [objectId]);
  if (!document) {
    return { kind: 'rejected', reason: 'objectNotFound' };
  }
  if (document.kind !== 'document') {
    return { kind: 'rejected', reason: 'unsupportedKind' };
  }
  if (writer.getExportAsset?.(boardId, assetId, 0)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  return planDocumentImageAsset(boardId, assetId, content, vector);
}
