import { toBinary } from '@bufbuild/protobuf';
import { ObjectMetadataSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type { RoomsApplication } from '../../modules/rooms/application/index.js';
import type {
  BoardEditorApplication,
  WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { toObjectMetadata } from './scene.js';

type EditReceipt = ReturnType<BoardEditorApplication['editContent']>;
type MoveReceipt = ReturnType<WhiteboardApplication['moveObjects']>;

export type ObserveEdit = (receipt: EditReceipt) => void;
export type ObserveMove = (receipt: MoveReceipt) => void;

export function observeRoomChange(
  rooms: RoomsApplication | undefined,
  reportError: (error: unknown) => void,
) {
  function publish(outcome: EditReceipt | MoveReceipt) {
    if (!rooms || outcome.outcome.kind !== 'applied') {
      return;
    }

    const receipt = outcome.outcome;
    try {
      const orderChanged = 'order' in receipt && Boolean(receipt.order);
      const expired = 'detailsExpired' in receipt && receipt.detailsExpired;
      const refreshScene = orderChanged || expired || receipt.objects.length > 64;
      if (refreshScene) {
        rooms.publishContentChange({
          boardId: outcome.boardId,
          boardRevision: receipt.boardRevision,
          refreshScene: true,
        });

        return;
      }

      rooms.publishContentChange({
        boardId: outcome.boardId,
        boardRevision: receipt.boardRevision,
        changedObjectIds: receipt.objects.map(({ objectId }) => objectId),
        removedObjectIds: 'removedObjectIds' in receipt ? receipt.removedObjectIds : [],
        changedObjects: receipt.objects.map((object) =>
          toBinary(ObjectMetadataSchema, toObjectMetadata(object)),
        ),
      });
    } catch (error) {
      reportError(error);
    }
  }

  return rooms ? publish : undefined;
}
