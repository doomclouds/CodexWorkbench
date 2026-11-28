import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  FeedbackAnchorTargetSchema,
  FeedbackContentPointSchema,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { z } from 'zod';
import { artifactIdentifier, artifactVersion, modelVersion } from './artifact-tool-input.js';
import { invalidArgument } from './errors.js';
import { callModelRpc, type ModelToolOptions } from './model-tool.js';

const normalized = z.number().min(0).max(1);
const coordinate = z.number().min(-10_000_000).max(10_000_000);

export const feedbackAnchor = z
  .object({
    coordinateSpace: z
      .enum(['board', 'element', 'html', 'document', 'todo', 'selection'])
      .optional(),
    objectId: artifactIdentifier.optional(),
    elementIds: z.array(artifactIdentifier).min(1).max(100).optional(),
    regionId: artifactIdentifier.optional(),
    geometryVersion: artifactVersion.optional(),
    payloadVersion: artifactVersion.optional(),
    sourceVersion: artifactVersion.optional(),
    sourceRevision: artifactVersion.optional(),
    expectedBoardRevision: artifactVersion.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: z.number().positive().max(10_000_000).optional(),
    height: z.number().positive().max(10_000_000).optional(),
    u: normalized.optional(),
    v: normalized.optional(),
    blockIds: z.array(artifactIdentifier).min(1).max(100).optional(),
    targetIds: z.array(artifactIdentifier).min(1).max(100).optional(),
    itemId: artifactIdentifier.optional(),
  })
  .strict();

type Anchor = z.infer<typeof feedbackAnchor>;
type Target = MessageInitShape<typeof FeedbackAnchorTargetSchema>;
type Content = MessageInitShape<typeof FeedbackContentPointSchema>['content'];
type ObservedObject = Awaited<ReturnType<typeof readObject>>;

function anchorObject(anchor: Anchor) {
  const ids = [anchor.objectId, anchor.regionId, ...(anchor.elementIds ?? [])].filter(Boolean);
  const [objectId] = new Set(ids);
  if (objectId && ids.some((id) => id !== objectId)) {
    throw invalidArgument('备注只能定位一个对象。多个对象可先创建建议的审阅来源。');
  }

  return objectId;
}

async function readObject(
  options: ModelToolOptions,
  boardId: string,
  objectId: string,
  signal: AbortSignal,
) {
  const { scene } = await callModelRpc(
    options,
    WhiteboardService.method.getBoardScene,
    { boardId },
    signal,
    4 * 1024 * 1024,
  );

  return scene?.objects.find((object) => object.objectId === objectId);
}

function normalizedPoint(anchor: Anchor, observed: ObservedObject) {
  if (anchor.u !== undefined && anchor.v !== undefined) {
    return { u: anchor.u, v: anchor.v };
  }

  const fromPixels = anchor.coordinateSpace === 'html' && observed?.geometry;
  const width = fromPixels ? fromPixels.width : 1;
  const height = fromPixels ? fromPixels.height : 1;
  const u = anchor.u ?? (anchor.x === undefined ? 0.5 : anchor.x / width);
  const v = anchor.v ?? (anchor.y === undefined ? 0.5 : anchor.y / height);
  if (!normalized.safeParse(u).success || !normalized.safeParse(v).success) {
    throw invalidArgument('请指定对象内有效的 u/v 相对位置。');
  }

  return { u, v };
}

function contentTarget(anchor: Anchor): Content {
  switch (anchor.coordinateSpace) {
    case 'document':
      if (!anchor.blockIds) {
        throw invalidArgument('文档备注需要 blockIds。');
      }

      return { case: 'document', value: { blockIds: anchor.blockIds } };
    case 'todo':
      if (!anchor.itemId) {
        throw invalidArgument('待办备注需要 itemId。');
      }

      return { case: 'todoItemId', value: anchor.itemId };
    case 'html': {
      const sourceRevision = modelVersion(anchor.sourceRevision);
      if (!anchor.targetIds || sourceRevision === undefined) {
        throw invalidArgument('HTML 内容备注需要 targetIds 和 sourceRevision。');
      }

      return { case: 'html', value: { nodeIds: anchor.targetIds, sourceRevision } };
    }
    case 'board':
    case 'element':
    case 'selection':
    case undefined:
      return undefined;
  }
}

type SourceVersions = Record<string, z.infer<typeof artifactVersion>>;

function groupPoint(anchor: Anchor, primary: ObservedObject) {
  if (anchor.coordinateSpace && anchor.coordinateSpace !== 'element') {
    return { x: anchor.x ?? 0, y: anchor.y ?? 0 };
  }

  const geometry = primary?.geometry;
  if (!geometry) {
    throw invalidArgument('缺少分组首个对象的位置，请重新读取选区。');
  }

  const { u, v } = normalizedPoint(anchor, primary);
  const horizontal = (u - 0.5) * geometry.width;
  const vertical = (v - 0.5) * geometry.height;
  const rotation = (geometry.rotation * Math.PI) / 180;

  return {
    x:
      geometry.x +
      geometry.width / 2 +
      horizontal * Math.cos(rotation) -
      vertical * Math.sin(rotation),
    y:
      geometry.y +
      geometry.height / 2 +
      horizontal * Math.sin(rotation) +
      vertical * Math.cos(rotation),
  };
}

async function groupFeedbackTarget(
  options: ModelToolOptions,
  boardId: string,
  anchor: Anchor,
  versions: SourceVersions | undefined,
  signal: AbortSignal,
): Promise<Target> {
  const { scene } = await callModelRpc(
    options,
    WhiteboardService.method.getBoardScene,
    { boardId },
    signal,
    4 * 1024 * 1024,
  );
  const expectedBoardRevision = modelVersion(anchor.expectedBoardRevision) ?? scene?.boardRevision;
  const objectIds = anchor.elementIds ?? [];
  const metadata = new Map(scene?.objects.map((object) => [object.objectId, object]));
  if (expectedBoardRevision === undefined || objectIds.length !== new Set(objectIds).size) {
    throw invalidArgument('无法核对选区版次，或选区存在重复对象。');
  }

  const objects = objectIds.map((objectId) => {
    const source = metadata.get(objectId);
    if (source?.geometryVersion === undefined) {
      throw invalidArgument('选区包含无法读取的对象。');
    }

    return {
      objectId,
      geometryVersion: modelVersion(versions?.[objectId]) ?? source.geometryVersion,
      payloadVersion: source.payloadVersion,
    };
  });
  const point = groupPoint(anchor, metadata.get(objectIds[0] ?? ''));
  const bounds =
    anchor.width && anchor.height
      ? {
          x: anchor.x ?? point.x,
          y: anchor.y ?? point.y,
          width: anchor.width,
          height: anchor.height,
        }
      : undefined;

  return {
    target: { case: 'selection', value: { bounds, point, objects, expectedBoardRevision } },
  };
}

function needsObservation(
  anchor: Anchor,
  geometryVersion: bigint | undefined,
  payloadVersion: bigint | undefined,
  content: Content,
) {
  const unnormalized =
    (anchor.u === undefined && anchor.x !== undefined) ||
    (anchor.v === undefined && anchor.y !== undefined);
  const pixels = anchor.coordinateSpace === 'html' && unnormalized;

  return (
    geometryVersion === undefined ||
    (content !== undefined && payloadVersion === undefined) ||
    pixels
  );
}

interface ObjectAnchor {
  readonly objectId: string;
  readonly anchor: Anchor;
  readonly content: Content;
  readonly versions?: SourceVersions;
}

async function objectFeedbackTarget(
  options: ModelToolOptions,
  boardId: string,
  { objectId, anchor, content, versions }: ObjectAnchor,
  signal: AbortSignal,
): Promise<Target> {
  const geometryVersion = modelVersion(anchor.geometryVersion ?? versions?.[objectId]);
  const payloadVersion = modelVersion(anchor.payloadVersion ?? anchor.sourceVersion);
  const observed = needsObservation(anchor, geometryVersion, payloadVersion, content)
    ? await readObject(options, boardId, objectId, signal)
    : undefined;
  const point = {
    ...normalizedPoint(anchor, observed),
    objectId,
    geometryVersion: geometryVersion ?? observed?.geometryVersion,
  };

  if (point.geometryVersion === undefined) {
    throw invalidArgument('无法确认对象的几何版本。请先读取目标对象。');
  }
  if (!content) {
    return { target: { case: 'objectPoint', value: point } };
  }

  const version = payloadVersion ?? observed?.payloadVersion;
  if (version === undefined) {
    throw invalidArgument('无法确认备注对应的正文版本。请先读取源内容。');
  }

  return {
    target: { case: 'contentPoint', value: { ...point, payloadVersion: version, content } },
  };
}

function boardFeedbackTarget(anchor: Anchor): Target {
  return { target: { case: 'boardPoint', value: { x: anchor.x ?? 0, y: anchor.y ?? 0 } } };
}

export async function modelFeedbackTarget(
  options: ModelToolOptions,
  boardId: string,
  anchor: Anchor,
  versions: SourceVersions | undefined,
  signal: AbortSignal,
): Promise<Target> {
  const content = contentTarget(anchor);
  const isGroup = (anchor.elementIds?.length ?? 0) > 1;
  if (anchor.coordinateSpace === 'selection' || (isGroup && !content)) {
    return groupFeedbackTarget(options, boardId, anchor, versions, signal);
  }
  if (anchor.coordinateSpace === 'board') {
    return boardFeedbackTarget(anchor);
  }

  const objectId = anchorObject(anchor);
  if (!objectId) {
    if (content || anchor.coordinateSpace === 'element') {
      throw invalidArgument('对象备注需要稳定对象 ID。');
    }

    return boardFeedbackTarget(anchor);
  }

  return objectFeedbackTarget(options, boardId, { objectId, anchor, content, versions }, signal);
}
