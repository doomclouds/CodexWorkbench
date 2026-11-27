import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { WhiteboardPost } from './contracts.js';
import type {
  UploadBoardDocumentImageCommand,
  UploadBoardDocumentImageResult,
} from './edits-types.js';
import { readBoardEditReceipt } from './protocol/edit-receipt.js';
import { request } from './protocol/index.js';

const archiveAssets = '/studio-archive-assets/';
const documentAsset = /^document-image-[0-9a-f]{64}$/u;

function validatedAssetUrl(url: string | undefined, boardId: string): string {
  const prefix = archiveAssets + boardId + '/';
  if (!url?.startsWith(prefix) || !documentAsset.test(url.slice(prefix.length))) {
    throw new Error('The saved document image does not have a board-scoped asset URL.');
  }

  return url;
}

export function createDocumentImageUpload(post: WhiteboardPost) {
  return async (
    command: UploadBoardDocumentImageCommand,
    signal?: AbortSignal,
  ): Promise<UploadBoardDocumentImageResult> => {
    const { boardId, commandId } = command;
    const response = await request(
      post,
      BoardEditService.method.uploadBoardDocumentImage,
      command,
      signal,
    );
    const receipt = readBoardEditReceipt(response.receipt, boardId, commandId, (source) => source);
    if (receipt.kind !== 'applied') {
      if (response.assetUrl !== undefined) {
        throw new Error('A rejected document image upload returned an asset URL.');
      }

      return { receipt };
    }

    const boardChanges =
      receipt.objects.length +
      receipt.order.length +
      receipt.payloads.length +
      receipt.removedIds.length;

    if (boardChanges !== 0) {
      throw new Error('A document image upload changed the board directly.');
    }

    return { receipt, assetUrl: validatedAssetUrl(response.assetUrl, boardId) };
  };
}
