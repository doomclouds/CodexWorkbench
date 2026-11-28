import {
  boardWritePayloadLimit,
  clipboardObject,
  connectorAttachmentIds,
  hasInlineEmbedResource,
  validNewObjectId,
  type Actor,
  type BoardEditDecision,
  type BoardEditRejection,
  type BoardHeader,
  type BoardObject,
  type GeometryOperation,
  type PayloadRecord,
} from '../domain/index.js';
import type { BoardEditWriter } from '../ports/index.js';
import { clipboardPayloads } from './clipboard-payloads.js';

type Paste = Extract<GeometryOperation, { kind: 'paste' }>;

interface PasteSource {
  readonly objects: readonly BoardObject[];
  readonly geometry: ReadonlyMap<string, BoardObject>;
  readonly payloads: readonly PayloadRecord[];
  readonly payloadBytes: bigint;
}

const clipboardObjectLimit = 200;
const expectedNamespace = /^geometry:([a-f0-9]{64})$/u;

function rejected(reason: BoardEditRejection): BoardEditDecision {
  return { kind: 'rejected', reason };
}

function currentSourceReader(
  writer: BoardEditWriter,
  { sourceBoardId, sourceRevision }: Paste,
  current: boolean,
) {
  const version = current ? undefined : sourceRevision;

  return {
    objects: (ids: readonly string[]) =>
      current
        ? writer.getObjects(sourceBoardId, ids)
        : writer.listVersionObjects(sourceBoardId, sourceRevision, ids),
    payloads: (ids: readonly string[]) =>
      current
        ? writer.getPayloads(sourceBoardId, ids)
        : writer.getVersionPayloads(sourceBoardId, sourceRevision, ids),
    bytes: (ids: readonly string[]) => writer.payloadByteSize?.(sourceBoardId, ids, version) ?? 0n,
  };
}

function clipboardAttachments(objects: readonly BoardObject[]): readonly string[] {
  const linked = new Set(
    objects.flatMap(({ detail }) =>
      detail?.kind === 'connector' ? connectorAttachmentIds(detail) : [],
    ),
  );

  for (const { objectId } of objects) {
    linked.delete(objectId);
  }

  return [...linked];
}

function readSource(
  writer: BoardEditWriter,
  actor: Actor,
  operation: Paste,
): PasteSource | BoardEditRejection {
  const { sourceBoardId, sourceRevision, targets } = operation;
  if (!writer.getAccess(sourceBoardId, actor.id)) {
    return 'forbidden';
  }

  const board = writer.getBoard(sourceBoardId);
  const current = board?.revision === sourceRevision;
  if (!current && !writer.getVersion(sourceBoardId, sourceRevision)) {
    return 'versionUnavailable';
  }

  const reader = currentSourceReader(writer, operation, current);
  const ids = targets.map(({ sourceObjectId }) => sourceObjectId);
  const objects = reader.objects(ids);
  if (objects.length !== ids.length) {
    return 'objectNotFound';
  }

  const required = objects.filter(({ payloadVersion }) => payloadVersion !== undefined);
  const bodyIds = required.map(({ objectId }) => objectId);
  const payloadBytes = reader.bytes(bodyIds);
  if (payloadBytes > boardWritePayloadLimit) {
    return 'tooLarge';
  }

  const payloads = reader.payloads(bodyIds);
  const versions = new Map(
    payloads.map(({ objectId, payloadVersion }) => [objectId, payloadVersion]),
  );

  if (required.some(({ objectId, payloadVersion }) => versions.get(objectId) !== payloadVersion)) {
    return 'versionUnavailable';
  }

  const attached = reader.objects(clipboardAttachments(objects));
  const geometry = new Map([...objects, ...attached].map((object) => [object.objectId, object]));

  return { objects, geometry, payloads, payloadBytes };
}

function destinationIds(
  writer: BoardEditWriter,
  boardId: string,
  targets: Paste['targets'],
): ReadonlyMap<string, string> | undefined {
  const ids = new Map(targets.map(({ objectId, sourceObjectId }) => [sourceObjectId, objectId]));
  const generated = new Set(ids.values());
  if (generated.size !== ids.size || ids.size !== targets.length) {
    return undefined;
  }
  if ([...generated].some((id) => !validNewObjectId(id) || writer.hasUsedObjectId(boardId, id))) {
    return undefined;
  }

  return ids;
}

function destinationGroups(
  writer: BoardEditWriter,
  boardId: string,
  origin: readonly BoardObject[],
  ids: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> | undefined {
  const groups = new Map<string, string>();
  for (const { groupId, objectId } of origin) {
    const replacement = ids.get(objectId);
    if (groupId === undefined || !replacement || groups.has(groupId)) {
      continue;
    }

    const id = 'group:' + replacement;
    if (writer.listGroupObjects(boardId, id).length > 0) {
      return undefined;
    }

    groups.set(groupId, id);
  }

  return groups;
}

interface DestinationPlan {
  readonly scope: Parameters<typeof clipboardObject>[2];
  readonly source: PasteSource;
}

function pasteObjects({ scope, source }: DestinationPlan): readonly BoardObject[] | undefined {
  const added: BoardObject[] = [];
  for (const object of source.objects) {
    const id = scope.ids.get(object.objectId);
    const copy = id && clipboardObject(object, id, scope);
    if (!copy) {
      return undefined;
    }

    added.push(copy);
  }

  return added;
}

export function pasteBoardObjects(
  writer: BoardEditWriter,
  board: BoardHeader,
  actor: Actor,
  operation: Paste,
  signature: string,
): BoardEditDecision {
  const { boardId } = board;
  const { targets, delta, sourceBoardId } = operation;
  if (!targets.length || ![delta.dx, delta.dy].every(Number.isFinite)) {
    return rejected('invalidEdit');
  }
  if (targets.length > clipboardObjectLimit) {
    return rejected('tooLarge');
  }

  const ids = destinationIds(writer, boardId, targets);
  const assetNamespace = expectedNamespace.exec(signature)?.[1];
  if (!ids || !assetNamespace) {
    return rejected('invalidEdit');
  }

  const source = readSource(writer, actor, operation);
  if (typeof source === 'string') {
    return rejected(source);
  }
  if (source.payloads.some(hasInlineEmbedResource)) {
    return rejected('inlineHtmlResource');
  }

  const groups = destinationGroups(writer, boardId, source.objects, ids);
  if (!groups) {
    return rejected('invalidEdit');
  }

  const sameBoard = sourceBoardId === boardId;
  const liveAttachments = sameBoard
    ? writer.getObjects(boardId, clipboardAttachments(source.objects))
    : [];
  const attachableObjects = new Set(liveAttachments.map(({ objectId }) => objectId));
  const scope = { ids, groups, geometry: source.geometry, delta, attachableObjects };
  const objects = pasteObjects({ scope, source });
  if (!objects) {
    return rejected('invalidEdit');
  }

  const data = clipboardPayloads(source.payloads, {
    sourceBoardId,
    destinationBoardId: boardId,
    assetNamespace,
    ids,
    writer,
    availableBytes: Number(boardWritePayloadLimit - source.payloadBytes),
  });

  if (typeof data === 'string') {
    return rejected(data);
  }

  return { kind: 'changes', objects, ...data };
}
