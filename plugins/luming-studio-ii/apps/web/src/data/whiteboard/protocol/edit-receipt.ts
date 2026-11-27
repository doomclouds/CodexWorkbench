import {
  BoardEditRejectionReason,
  type BoardEditApplied,
  type BoardEditReceipt as WireBoardEditReceipt,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { ObjectPayloadResult } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { BoardEditReceipt, BoardEditRejection } from '../edits-types.js';
import { readPayloads } from './payload.js';
import { readObjects } from './scene.js';
import { matchIdentity, requireField } from './values.js';

type AssetResolver = (source: string) => string;

const rejections = new Map<BoardEditRejectionReason, BoardEditRejection>([
  [BoardEditRejectionReason.FORBIDDEN, 'forbidden'],
  [BoardEditRejectionReason.INVALID_EDIT, 'invalidEdit'],
  [BoardEditRejectionReason.OBJECT_NOT_FOUND, 'objectNotFound'],
  [BoardEditRejectionReason.GEOMETRY_LOCKED, 'geometryLocked'],
  [BoardEditRejectionReason.COMMAND_ID_REUSE, 'commandIdReuse'],
  [BoardEditRejectionReason.UNSUPPORTED_KIND, 'unsupportedKind'],
  [BoardEditRejectionReason.VERSION_UNAVAILABLE, 'versionUnavailable'],
  [BoardEditRejectionReason.TOO_LARGE, 'tooLarge'],
  [BoardEditRejectionReason.INVALID_IMAGE, 'invalidImage'],
  [BoardEditRejectionReason.INVALID_VIDEO, 'invalidVideo'],
]);

function readIds(ids: readonly string[], name: string): readonly string[] {
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('Whiteboard edit response has an invalid or duplicate ' + name + ' ID.');
  }

  return ids;
}

function readEditPayloads(results: readonly ObjectPayloadResult[], resolveAsset: AssetResolver) {
  const ids = readIds(
    results.map(({ objectId }) => objectId),
    'payload object',
  );

  return readPayloads(results, ids, resolveAsset);
}

type BoardChangeMessage = Pick<
  BoardEditApplied,
  'boardRevision' | 'changedObjects' | 'removedObjectIds' | 'objectOrder' | 'changedPayloads'
> & { readonly detailsExpired?: boolean };

export function readBoardEditChanges(value: BoardChangeMessage, resolveAsset: AssetResolver) {
  const objects = readObjects(value.changedObjects);
  const removedIds = readIds(value.removedObjectIds, 'removed object');
  const order = readIds(value.objectOrder, 'ordered object');
  const payloads = readEditPayloads(value.changedPayloads, resolveAsset);
  const removed = new Set(removedIds);
  const keepsRemovedPayload = (result: (typeof payloads)[number]) =>
    result.kind === 'loaded' && removed.has(result.payload.id);
  const keepsRemovedObject =
    objects.some(({ id }) => removed.has(id)) || order.some((id) => removed.has(id));

  if (keepsRemovedObject || payloads.some(keepsRemovedPayload)) {
    throw new Error('Whiteboard edit response kept an object it removed.');
  }

  return {
    revision: requireField(value.boardRevision, 'applied board revision'),
    objects,
    removedIds,
    order,
    payloads,
    ...(value.detailsExpired ? { detailsExpired: true } : {}),
  };
}

export function readBoardEditReceipt(
  source: WireBoardEditReceipt | undefined,
  boardId: string,
  commandId: string,
  resolveAsset: AssetResolver,
): BoardEditReceipt {
  const receipt = requireField(source, 'edit command receipt');
  matchIdentity(receipt.boardId, boardId, 'board ID');
  matchIdentity(receipt.commandId, commandId, 'command ID');

  const identity = { boardId, commandId };
  const { case: kind, value } = receipt.outcome;

  switch (kind) {
    case 'applied':
      return { ...identity, kind, ...readBoardEditChanges(value, resolveAsset) };
    case 'conflict':
      return {
        ...identity,
        kind,
        revision: value.boardRevision,
        objects: readObjects(value.currentObjects),
        payloads: readEditPayloads(value.currentPayloads, resolveAsset),
      };
    case 'rejected':
      return { ...identity, kind, reason: rejections.get(value.reason) ?? 'unknown' };
    case undefined:
      throw new Error('Whiteboard edit response is missing a command outcome.');
  }
}
