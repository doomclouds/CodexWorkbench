import { toJson } from '@bufbuild/protobuf';
import { BoardArchiveService } from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import {
  FeedbackAnchorSchema,
  FeedbackService,
  type FeedbackAnchor,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import {
  BoardHistoryService,
  BoardVersionActorKind,
  BoardVersionKind,
  type BoardVersionSummary,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  ObjectPayloadSchema,
  type ObjectPayload,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import {
  ObjectMetadataSchema,
  type BoardScene,
  type ObjectMetadata,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { ArtifactReadFailure, parseRevision, type ReadArguments } from './artifact-read-page.js';
import { BridgeError, invalidArgument } from './errors.js';
import { callModelRpc, type ModelToolOptions } from './model-tool.js';

const sceneBytes = 8 * 1024 * 1024;
const payloadBytes = 24 * 1024 * 1024;
const replyBytes = 128 * 1024;
const jsonOptions = { alwaysEmitImplicit: true } as const;
const { getBoardScene } = WhiteboardService.method;
const { getThread } = FeedbackService.method;
const { listBoardAssets } = BoardArchiveService.method;
const { listBoardVersions, getBoardVersionScene, getBoardVersionPayloads } =
  BoardHistoryService.method;

export interface ReadSnapshot {
  readonly boardId: string;
  readonly revision: bigint;
  readonly scene: BoardScene;
  readonly objects: ReadonlyMap<string, ObjectMetadata>;
}

export interface FrozenRead {
  readonly id: string;
  readonly anchor: FeedbackAnchor;
}

export class ArtifactReadData {
  constructor(
    private readonly options: ModelToolOptions,
    private readonly boardId: string,
    private readonly signal: AbortSignal,
  ) {}

  async scene(revision: bigint | undefined): Promise<ReadSnapshot> {
    const { boardId, options, signal } = this;
    const response =
      revision === undefined
        ? await callModelRpc(options, getBoardScene, { boardId }, signal, sceneBytes)
        : await callModelRpc(
            options,
            getBoardVersionScene,
            { boardId, revision },
            signal,
            sceneBytes,
          );
    const { scene } = response;
    if (!scene) {
      throw new ArtifactReadFailure(
        revision === undefined ? 'NOT_FOUND' : 'VERSION_NOT_FOUND',
        revision === undefined ? '白板不可读取。' : '此白板修订已不可读取，请确认保留版本。',
      );
    }
    if (scene.boardId !== boardId || scene.boardRevision === undefined) {
      throw unusableReply();
    }
    if (revision !== undefined && scene.boardRevision !== revision) {
      throw unusableReply();
    }

    const objects = new Map(scene.objects.map((object) => [object.objectId, object]));

    return { boardId, revision: scene.boardRevision, scene, objects };
  }

  async payloads(snapshot: ReadSnapshot, ids: readonly string[]) {
    const requested = ids.filter((id) => snapshot.objects.get(id)?.payloadVersion !== undefined);
    if (!requested.length) {
      return new Map<string, ObjectPayload>();
    }

    const { boardId, options, signal } = this;
    const { revision } = snapshot;
    const result = await callModelRpc(
      options,
      getBoardVersionPayloads,
      { boardId, revision, objectIds: requested },
      signal,
      payloadBytes,
    );

    if (result.boardId !== boardId || result.revision !== revision) {
      throw unusableReply();
    }
    if (result.unavailable) {
      throw new ArtifactReadFailure('VERSION_NOT_FOUND', '此白板修订已不可读取，请确认保留版本。');
    }

    const byId = new Map(result.results.map((item) => [item.objectId, item.result]));
    const payloads = new Map<string, ObjectPayload>();
    for (const id of requested) {
      const item = byId.get(id);
      if (item?.case !== 'payload') {
        throw new ArtifactReadFailure('PAYLOAD_UNAVAILABLE', '无法读取目标对象在此修订的正文。');
      }

      const expected = snapshot.objects.get(id)?.payloadVersion;
      if (item.value.payloadVersion !== expected || item.value.body.case === undefined) {
        throw unusableReply();
      }

      payloads.set(id, item.value);
    }

    return payloads;
  }

  async frozen(id: string): Promise<FrozenRead> {
    const { boardId, options, signal } = this;
    const { thread } = await callModelRpc(
      options,
      getThread,
      { boardId, threadId: id, pageSize: 1 },
      signal,
      replyBytes,
    );

    if (!thread?.anchor || thread.threadId !== id) {
      throw new ArtifactReadFailure('NOT_FOUND', '当前白板上的反馈引用不可读取。');
    }

    return { id, anchor: thread.anchor };
  }

  async versions(beforeRevision: bigint | undefined, limit: number) {
    const { boardId, options, signal } = this;
    const page = await callModelRpc(
      options,
      listBoardVersions,
      { boardId, beforeRevision, limit },
      signal,
      replyBytes,
    );

    if (page.currentRevision === undefined) {
      throw unusableReply();
    }

    return page;
  }

  async assets(cursor: string | undefined, limit: number) {
    const { boardId, options, signal } = this;
    const { assets, nextCursor } = await callModelRpc(
      options,
      listBoardAssets,
      { boardId, cursor, limit },
      signal,
      replyBytes,
    );

    return {
      assets: assets.map(({ assetId, src, mediaType, byteLength }) => ({
        assetId,
        src,
        mediaType,
        byteLength,
      })),
      nextCursor,
    };
  }
}

function unusableReply(): BridgeError {
  return new BridgeError('UNAVAILABLE', '服务返回的白板、对象或版本无法核对。');
}

export function snapshotSummary({ boardId, revision, scene }: ReadSnapshot) {
  return {
    id: boardId,
    title: scene.title,
    revision: revision.toString(),
    canEdit: scene.access?.canEdit === true,
    trashed: scene.access?.trashed === true,
  };
}

export function metadataJson(object: ObjectMetadata) {
  return toJson(ObjectMetadataSchema, object, jsonOptions);
}

export function payloadJson(payload: ObjectPayload) {
  return toJson(ObjectPayloadSchema, payload, jsonOptions);
}

export function versionJson(version: BoardVersionSummary) {
  const {
    revision,
    title,
    savedAtMillis,
    actorId,
    actorKind,
    actorName,
    kind,
    changedObjectCount,
    sourceRevision,
  } = version;

  return {
    id: 'revision-' + String(revision),
    revision: revision?.toString(),
    title,
    savedAtMillis: savedAtMillis?.toString(),
    actorId,
    actorKind: actorKind === BoardVersionActorKind.AGENT ? 'agent' : undefined,
    actorName: actorName || undefined,
    kind: BoardVersionKind[kind],
    changedObjectCount,
    sourceRevision: sourceRevision?.toString(),
  };
}

export function frozenContext(frozen: FrozenRead) {
  return {
    feedbackId: frozen.id,
    atRevision: frozen.anchor.sourceBoardRevision.toString(),
    anchor: toJson(FeedbackAnchorSchema, frozen.anchor, jsonOptions),
  };
}

export function sourceBoardRevision(args: ReadArguments, frozen?: FrozenRead) {
  const revision = parseRevision(args.atRevision);
  if (!frozen) {
    return revision;
  }

  const source = frozen.anchor.sourceBoardRevision;
  if (revision !== undefined && revision !== source) {
    throw invalidArgument('请求修订与反馈冻结修订不同。');
  }

  return source;
}

export function requireFrozenTarget(frozen: FrozenRead, object: ObjectMetadata) {
  const target = frozen.anchor.target?.target;
  if (target?.case === 'selection') {
    const reference = target.value.objects.find(({ objectId }) => objectId === object.objectId);
    if (!reference) {
      throw new ArtifactReadFailure('OUT_OF_SCOPE', '对象不属于该反馈的冻结范围。');
    }

    verifyFrozenVersions(object, reference.geometryVersion, reference.payloadVersion);

    return;
  }
  if (target?.case !== 'objectPoint' && target?.case !== 'contentPoint') {
    throw new ArtifactReadFailure('OUT_OF_SCOPE', '该反馈未绑定可读取的对象。');
  }

  const { objectId, geometryVersion } = target.value;
  if (objectId !== object.objectId) {
    throw new ArtifactReadFailure('OUT_OF_SCOPE', '对象不属于该反馈的冻结范围。');
  }

  const payloadVersion = target.case === 'contentPoint' ? target.value.payloadVersion : undefined;
  verifyFrozenVersions(object, geometryVersion, payloadVersion);

  return target.case === 'contentPoint' ? target.value.content : undefined;
}

function verifyFrozenVersions(
  object: ObjectMetadata,
  geometryVersion: bigint | undefined,
  payloadVersion: bigint | undefined,
) {
  const geometryMismatch =
    geometryVersion !== undefined && geometryVersion !== object.geometryVersion;
  const payloadMismatch = payloadVersion !== undefined && payloadVersion !== object.payloadVersion;
  if (geometryMismatch || payloadMismatch) {
    throw new ArtifactReadFailure('VERSION_NOT_FOUND', '反馈冻结的对象版本已无法核对。');
  }
}
