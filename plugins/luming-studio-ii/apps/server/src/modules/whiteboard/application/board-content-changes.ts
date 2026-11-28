import type { BoardEditReceipt, BoardObject, CommandReceipt } from '../domain/index.js';

interface BoardChangeIdentity {
  readonly boardId: string;
  readonly boardRevision: bigint;
}

interface RefreshBoardContent extends BoardChangeIdentity {
  readonly kind: 'refresh';
}

interface BoardContentDelta extends BoardChangeIdentity {
  readonly kind: 'delta';
  readonly changedObjects: readonly BoardObject[];
  readonly removedObjectIds: readonly string[];
}

export type BoardContentChange = RefreshBoardContent | BoardContentDelta;

export interface BoardChangePublication {
  readonly publish: (change: BoardContentChange) => void;
  readonly onError: (error: unknown) => void;
}

export function publishBoardContentChange<Receipt extends BoardEditReceipt | CommandReceipt>(
  receipt: Receipt,
  publication?: BoardChangePublication,
): Receipt {
  const { boardId, outcome } = receipt;
  if (!publication || outcome.kind !== 'applied') {
    return receipt;
  }

  const { boardRevision, objects } = outcome;
  const orderChanged = 'order' in outcome && Boolean(outcome.order);
  const expired = 'detailsExpired' in outcome && outcome.detailsExpired;
  const colorsChanged = 'customColors' in outcome && outcome.customColors !== undefined;
  const refresh = orderChanged || expired || colorsChanged || objects.length > 64;
  try {
    publication.publish(
      refresh
        ? { kind: 'refresh', boardId, boardRevision }
        : {
            kind: 'delta',
            boardId,
            boardRevision,
            changedObjects: objects,
            removedObjectIds: 'removedObjectIds' in outcome ? outcome.removedObjectIds : [],
          },
    );
  } catch (error) {
    publication.onError(error);
  }

  return receipt;
}
