import { toJson } from '@bufbuild/protobuf';
import {
  DocumentBlockSchema,
  TodoItemSchema,
  type DocumentBlock,
  type ObjectPayload,
  type TodoItem,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import type { ObjectMetadata } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import {
  metadataJson,
  payloadJson,
  requireFrozenTarget,
  snapshotSummary,
  type ArtifactReadData,
  type FrozenRead,
  type ReadSnapshot,
} from './artifact-read-data.js';
import {
  ArtifactReadFailure,
  parseRevision,
  readPage,
  rowPage,
  sourcePage,
  type ReadArguments,
} from './artifact-read-page.js';
import { invalidArgument } from './errors.js';

export const contentBytes = 32 * 1024;
const jsonOptions = { alwaysEmitImplicit: true } as const;

type ContentAnchor = ReturnType<typeof requireFrozenTarget>;

interface TargetContent {
  readonly object: ObjectMetadata;
  readonly payload?: ObjectPayload;
  readonly anchor: ContentAnchor;
}

async function targetContent(
  data: ArtifactReadData,
  snapshot: ReadSnapshot,
  objectId: string | undefined,
  frozen?: FrozenRead,
): Promise<TargetContent> {
  const object = objectId && snapshot.objects.get(objectId);
  if (!object) {
    throw new ArtifactReadFailure('NOT_FOUND', '当前读取修订没有指定的对象。');
  }

  const anchor = frozen && requireFrozenTarget(frozen, object);
  const payload = (await data.payloads(snapshot, [object.objectId])).get(object.objectId);
  return { object, payload, anchor };
}

export function readItem(object: ObjectMetadata, payload?: ObjectPayload) {
  return {
    id: object.objectId,
    object: metadataJson(object),
    payload: payload ? payloadJson(payload) : null,
  };
}

export async function readUnits(
  data: ArtifactReadData,
  snapshot: ReadSnapshot | undefined,
  ids: readonly string[],
) {
  const payloads = snapshot && (await data.payloads(snapshot, ids));

  return ids.map((id) => {
    const object = snapshot?.objects.get(id);

    return { id, after: object ? readItem(object, payloads?.get(id)) : null };
  });
}

export async function readObjects(
  data: ArtifactReadData,
  snapshot: ReadSnapshot,
  args: ReadArguments,
) {
  const ids = [...new Set(args.ids)];
  const units = await readUnits(data, snapshot, ids);
  const base = { artifact: snapshotSummary(snapshot) };
  const page = readPage(args, snapshot.revision.toString(), contentBytes);
  if (args.mode === 'units') {
    return rowPage(units, 'units', base, page);
  }

  const items = units.flatMap(({ after }) => (after ? [after] : []));
  const missingIds = units.filter(({ after }) => !after).map(({ id }) => id);

  return rowPage(items, 'items', { ...base, missingIds }, page);
}

export function* flattenBlocks(blocks: readonly DocumentBlock[]): Generator<DocumentBlock> {
  for (const block of blocks) {
    yield block;
    yield* flattenBlocks(block.children);
  }
}

function scopedIds(
  requested: readonly string[] | undefined,
  allowed: readonly string[] | undefined,
) {
  if (allowed && requested?.some((id) => !allowed.includes(id))) {
    throw new ArtifactReadFailure('OUT_OF_SCOPE', '正文单元不属于该反馈的冻结范围。');
  }

  return requested ?? allowed;
}

function documentRows(target: TargetContent, args: ReadArguments) {
  const { anchor, payload } = target;
  const body = payload?.body;
  if (body?.case !== 'document' || (anchor && anchor.case !== 'document')) {
    throw invalidArgument('目标没有可读取的文档块。');
  }

  const ids = scopedIds(args.blockIds, anchor?.value.blockIds);
  const requested = ids && new Set(ids);
  const blocks = requested
    ? [...flattenBlocks(body.value.blocks)].filter(({ blockId }) => requested.has(blockId))
    : body.value.blocks;

  return {
    blocks: blocks.map((block) => toJson(DocumentBlockSchema, block, jsonOptions)),
    schemaVersion: body.value.schemaVersion,
    missingBlockIds: ids?.filter((id) => blocks.every(({ blockId }) => blockId !== id)),
  };
}

function taskRows(target: TargetContent, args: ReadArguments) {
  const { anchor, payload } = target;
  const body = payload?.body;
  if (body?.case !== 'todo' || (anchor && anchor.case !== 'todoItemId')) {
    throw invalidArgument('目标没有可读取的 Todo 任务。');
  }

  const ids = scopedIds(args.itemIds, anchor && [anchor.value]);
  const selected = new Set(ids);
  const tasks = body.value.items.filter(({ itemId, checked }) => {
    const hasId = selected.size === 0 || selected.has(itemId);
    const matches = args.checked === undefined || checked === args.checked;

    return hasId && matches;
  });

  return {
    items: tasks.map(todoJson),
    missingItemIds: ids?.filter((id) => body.value.items.every(({ itemId }) => itemId !== id)),
  };
}

function todoJson(item: TodoItem) {
  return toJson(TodoItemSchema, item, jsonOptions);
}

function targetBase(snapshot: ReadSnapshot, target: TargetContent, frozen?: FrozenRead) {
  const { object } = target;

  return {
    artifact: snapshotSummary(snapshot),
    elementId: object.objectId,
    geometryVersion: object.geometryVersion?.toString(),
    payloadVersion: object.payloadVersion?.toString(),
    ...(frozen && { feedbackId: frozen.id }),
  };
}

function requireSourceVersion(
  revision: bigint,
  expected: bigint | undefined,
  anchored: bigint | undefined,
) {
  if (anchored !== undefined && revision !== anchored) {
    throw new ArtifactReadFailure('VERSION_NOT_FOUND', '无法核对冻结 HTML 的源码版本。');
  }
  if (expected !== undefined && revision !== expected) {
    throw new ArtifactReadFailure('VERSION_NOT_FOUND', '当前快照的 HTML 源码版本不匹配。');
  }
}

function readSource(
  snapshot: ReadSnapshot,
  target: TargetContent,
  args: ReadArguments,
  frozen?: FrozenRead,
) {
  const { anchor, object, payload } = target;
  const body = payload?.body;
  const base = targetBase(snapshot, target, frozen);
  const page = readPage(args, snapshot.revision.toString(), contentBytes);
  const expected = parseRevision(args.sourceRevision);
  if (body?.case === 'embed' && body.value.html !== undefined) {
    const revision = body.value.sourceRevision ?? object.payloadVersion ?? 0n;
    const htmlAnchor = anchor?.case === 'html' ? anchor.value : undefined;
    requireSourceVersion(revision, expected, htmlAnchor?.sourceRevision);

    return sourcePage(
      body.value.html,
      'html',
      {
        ...base,
        regionId: object.objectId,
        sourceRevision: revision.toString(),
        nodeIds: htmlAnchor?.nodeIds,
      },
      page,
    );
  }
  if (expected !== undefined || anchor?.case === 'html') {
    throw invalidArgument('该对象没有对应的 HTML 源码版本。');
  }

  let value: unknown = readItem(object, target.payload);
  if (anchor?.case === 'document') {
    value = documentRows(target, args);
  }
  if (anchor?.case === 'todoItemId') {
    value = taskRows(target, args);
  }

  return sourcePage(JSON.stringify(value), 'json', base, page);
}

export async function readContent(
  data: ArtifactReadData,
  snapshot: ReadSnapshot,
  args: ReadArguments,
  frozen?: FrozenRead,
) {
  const target = await targetContent(data, snapshot, args.elementId, frozen);
  if (args.mode === 'source') {
    return readSource(snapshot, target, args, frozen);
  }

  const base = targetBase(snapshot, target, frozen);
  const page = readPage(args, snapshot.revision.toString(), contentBytes);
  if (args.mode === 'blocks') {
    const { blocks, ...structure } = documentRows(target, args);

    return rowPage(blocks, 'blocks', { ...base, ...structure }, page);
  }

  const { items, ...structure } = taskRows(target, args);

  return rowPage(items, 'items', { ...base, ...structure }, page);
}
