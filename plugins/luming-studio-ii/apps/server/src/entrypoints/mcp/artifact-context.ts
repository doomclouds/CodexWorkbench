import {
  FeedbackService,
  type FeedbackAnchor,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import {
  BoardHistoryService,
  type ExportBoardVersionResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import type { ObjectPayload } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import type { ObjectMetadata } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
  type ExportBoardResponse,
  type ExportBoardSelection,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  contextContent,
  contextLabel,
  contextObject,
  contextRepresentations,
  type ContentFocus,
  type ContextRepresentation,
} from './artifact-context-content.js';
import { readContextImage, savedPreview } from './artifact-context-media.js';
import {
  contextCursor,
  contextSchema,
  nextContextCursor,
  selectContextObjects,
  type ContextInput,
  type ContextScope,
} from './artifact-context-scope.js';
import { BridgeError, invalidArgument } from './errors.js';
import {
  callModelRpc,
  modelToolFailure,
  withAgentRead,
  type ModelToolOptions,
} from './model-tool.js';

const sceneMethods = WhiteboardService.method;
const historyMethods = BoardHistoryService.method;
const maxSceneBytes = 8 * 1024 * 1024;
const maxPreviewBytes = 2 * 1024 * 1024;
const maxVisualObjects = 48;
const emptyScope = { kind: 'objects' as const, objectIds: [] };

interface ContextLocation {
  readonly boardId: string;
  readonly scope: ContextScope;
  readonly revision?: bigint;
  readonly focus?: ContentFocus;
  readonly point?: { readonly x: number; readonly y: number };
  readonly excerpt?: string;
  readonly sourceRef?: ContextInput['sourceRef'];
}

type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string };
type ImageBlock = Extract<ContentBlock, { type: 'image' }>;

interface MissingRepresentation {
  readonly representation: ContextRepresentation;
  readonly reason: string;
  readonly next?: string;
  readonly objectId?: string;
}

type VisualResult =
  | {
      readonly representation: 'preview' | 'image';
      readonly image: ImageBlock;
      readonly origin: string;
      readonly objectId?: string;
    }
  | { readonly missing: MissingRepresentation };

const browserPreviewNext = '在同一白板的对应保存版本中选中目标后导出 PNG。';
const narrowerPreviewNext = '用更小的对象或分区范围重新请求 preview。';

function requestedScope(anchor: FeedbackAnchor): ContextScope {
  const target = anchor.target?.target;
  if (target?.case === 'objectPoint' || target?.case === 'contentPoint') {
    return { kind: 'objects', objectIds: [target.value.objectId] };
  }
  if (target?.case !== 'selection') {
    return emptyScope;
  }

  const ids = target.value.objects.map(({ objectId }) => objectId);
  if (ids.length) {
    return { kind: 'objects', objectIds: ids };
  }

  const { bounds } = target.value;
  return bounds
    ? {
        kind: 'region',
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      }
    : emptyScope;
}

function contentFocus(anchor: FeedbackAnchor): ContentFocus | undefined {
  const target = anchor.target?.target;
  if (target?.case !== 'contentPoint') {
    return;
  }

  const { content } = target.value;
  switch (content.case) {
    case 'document':
      return { kind: 'document', ids: content.value.blockIds };
    case 'todoItemId':
      return { kind: 'todo', id: content.value };
    case 'html':
      return {
        kind: 'html',
        ids: content.value.nodeIds,
        sourceRevision: content.value.sourceRevision,
      };
    case undefined:
      return undefined;
  }
}

async function locate(
  options: ModelToolOptions,
  input: ContextInput,
  signal: AbortSignal,
): Promise<ContextLocation> {
  const { sourceRef } = input;
  const boardId = input.boardId ?? sourceRef?.boardId;
  if (!boardId) {
    throw invalidArgument('请提供白板 ID 或备注来源引用。');
  }
  if (!sourceRef) {
    return {
      boardId,
      scope: input.scope ?? { kind: 'board' },
      revision: input.revision === undefined ? undefined : BigInt(input.revision),
    };
  }
  if (sourceRef.boardId !== boardId || input.scope || input.revision !== undefined) {
    throw invalidArgument('备注来源使用自身的白板、目标和版次。');
  }

  const { thread } = await callModelRpc(
    options,
    FeedbackService.method.getThread,
    { boardId, threadId: sourceRef.feedbackThreadId, pageSize: 1 },
    signal,
  );

  if (!thread?.anchor || thread.threadId !== sourceRef.feedbackThreadId) {
    throw new BridgeError('NOT_FOUND', '当前无法取得这条备注的冻结来源。');
  }

  const { anchor } = thread;
  const point = anchor.frozenPoint;
  return {
    boardId,
    sourceRef,
    scope: requestedScope(anchor),
    revision: anchor.sourceBoardRevision,
    focus: contentFocus(anchor),
    point: point && { x: point.x, y: point.y },
    excerpt: anchor.frozenExcerpt?.slice(0, 2_400),
  };
}

async function readScene(
  options: ModelToolOptions,
  boardId: string,
  revision: bigint | undefined,
  signal: AbortSignal,
) {
  const result =
    revision === undefined
      ? await callModelRpc(options, sceneMethods.getBoardScene, { boardId }, signal, maxSceneBytes)
      : await callModelRpc(
          options,
          historyMethods.getBoardVersionScene,
          { boardId, revision },
          signal,
          maxSceneBytes,
        );
  const { scene } = result;
  if (!scene || scene.boardRevision === undefined || scene.boardId !== boardId) {
    throw new BridgeError('NOT_FOUND', '这块白板或指定的保存版次已不可读取。');
  }
  if (revision !== undefined && revision !== scene.boardRevision) {
    throw new BridgeError('CONFLICT', '返回的保存版次与请求不一致。');
  }

  return { scene, revision: scene.boardRevision };
}

async function readPayloads(
  options: ModelToolOptions,
  location: ContextLocation,
  page: readonly ObjectMetadata[],
  signal: AbortSignal,
) {
  const versions = new Map(
    page
      .filter(({ payloadVersion }) => payloadVersion !== undefined)
      .map(({ objectId, payloadVersion }) => [objectId, payloadVersion]),
  );
  const boardId = location.boardId;
  const payloads = new Map<string, ObjectPayload>();
  if (!versions.size) {
    return { payloads, missing: [] };
  }

  const objectIds = [...versions.keys()];
  const revision = location.revision;
  const reply =
    revision === undefined
      ? await callModelRpc(options, sceneMethods.getObjectPayloads, { boardId, objectIds }, signal)
      : await callModelRpc(
          options,
          historyMethods.getBoardVersionPayloads,
          { boardId, objectIds, revision },
          signal,
        );

  if (reply.boardId !== boardId || ('revision' in reply && reply.revision !== revision)) {
    throw new BridgeError('CONFLICT', '正文返回的白板或保存版次与请求不一致。');
  }

  for (const { objectId, result } of reply.results) {
    const expected = versions.get(objectId);
    if (
      expected !== undefined &&
      result.case === 'payload' &&
      result.value.payloadVersion === expected
    ) {
      payloads.set(objectId, result.value);
      versions.delete(objectId);
    }
  }

  return { payloads, missing: [...versions.keys()] };
}

function contentError(error: unknown, representation: ContextRepresentation) {
  if (error instanceof BridgeError && error.code === 'TOO_LARGE') {
    return {
      representation,
      reason: 'sizeLimit',
      next: '缩小对象范围或单独读取需要的对象。',
    };
  }

  throw error;
}

function previewScope(location: ContextLocation, objects: readonly ObjectMetadata[]) {
  if (location.scope.kind === 'board') {
    return { case: 'whole' as const, value: {} };
  }

  const selection: Pick<ExportBoardSelection, 'objectIds'> = {
    objectIds: objects.map(({ objectId }) => objectId),
  };

  return { case: 'selection' as const, value: selection };
}

async function preview(
  options: ModelToolOptions,
  location: ContextLocation,
  revision: bigint,
  objects: readonly ObjectMetadata[],
  signal: AbortSignal,
): Promise<VisualResult> {
  if (location.focus) {
    return {
      missing: {
        representation: 'preview',
        reason: 'contentUnitPreviewUnavailable',
        next: '在白板界面定位同一备注，再取得该内容单元的画面。',
      },
    };
  }
  if (!objects.length || objects.length > maxVisualObjects) {
    return {
      missing: {
        representation: 'preview',
        reason: objects.length ? 'sizeLimit' : 'noRenderableObjects',
        next: narrowerPreviewNext,
      },
    };
  }

  const boardId = location.boardId;
  const format = BoardExportFormat.PNG;
  const scope = previewScope(location, objects);
  const reply =
    location.revision === undefined
      ? await callModelRpc(
          options,
          sceneMethods.exportBoard,
          { boardId, expectedRevision: revision, scope, format },
          signal,
          maxPreviewBytes,
        )
      : await callModelRpc(
          options,
          historyMethods.exportBoardVersion,
          { boardId, revision, scope, format },
          signal,
          maxPreviewBytes,
        );
  const { result } = reply;
  if (result.case === 'file') {
    const image = savedPreview(result.value, revision);
    if (image) {
      return {
        representation: 'preview',
        image,
        origin: location.scope.kind === 'board' ? 'savedBoard' : 'savedSelection',
      };
    }
  }

  const browserRequired = result.case === 'browserPng';
  const reason = browserRequired ? 'browserRequired' : previewFailure(result);
  return {
    missing: {
      representation: 'preview' as const,
      reason,
      next: browserRequired ? browserPreviewNext : narrowerPreviewNext,
    },
  };
}

function previewFailure(
  result: ExportBoardResponse['result'] | ExportBoardVersionResponse['result'],
) {
  if (result.case === 'stale') {
    return 'revisionChanged';
  }
  if (result.case === 'rejected' && result.value.reason === BoardExportRejectionReason.TOO_LARGE) {
    return 'sizeLimit';
  }

  return 'previewUnavailable';
}

function titleFor(object: ObjectMetadata) {
  return contextLabel(object.label) || object.objectId;
}

function namedText(object: ObjectMetadata, text: string): ContentBlock {
  return { type: 'text', text: titleFor(object) + ' [' + object.objectId + ']\n' + text };
}

function representObjects(
  page: readonly ObjectMetadata[],
  payloads: ReadonlyMap<string, ObjectPayload>,
  requested: readonly ContextRepresentation[],
  location: ContextLocation,
) {
  const content: ContentBlock[] = [];
  const provided = new Set<ContextRepresentation>();
  const missing: MissingRepresentation[] = [];
  const includeText = requested.includes('text');
  const objects = page.map((object) => {
    const payload = payloads.get(object.objectId);
    const parts = payload && contextContent(payload, location.focus, includeText);
    if (includeText && parts?.text) {
      content.push(namedText(object, parts.text));
      provided.add('text');
    }
    if (requested.includes('source') && parts?.source) {
      content.push(namedText(object, parts.source.html));
      provided.add('source');
    }

    return { object, parts };
  });

  if (requested.includes('text') && !provided.has('text') && location.excerpt) {
    content.push({ type: 'text', text: '备注冻结摘录\n' + location.excerpt });
    provided.add('text');
  }

  for (const representation of ['text', 'source'] as const) {
    if (requested.includes(representation) && !provided.has(representation)) {
      missing.push({ representation, reason: 'notStoredForScope' });
    }
  }

  return { content, provided, missing, objects };
}

async function contextImage(
  options: ModelToolOptions,
  boardId: string,
  payloads: ReadonlyMap<string, ObjectPayload>,
  signal: AbortSignal,
): Promise<VisualResult> {
  const candidate = [...payloads].find(
    ([, payload]) => payload.body.case === 'image' || payload.body.case === 'video',
  );

  if (!candidate) {
    return { missing: { representation: 'image', reason: 'notStoredForScope' } };
  }

  const [objectId, payload] = candidate;
  const image = await readContextImage(options, boardId, payload, signal);
  if (image.kind === 'image') {
    return { representation: 'image', image: image.block, origin: image.origin, objectId };
  }

  return {
    missing: {
      representation: 'image',
      reason: image.reason,
      objectId,
      next: '可尝试读取同一对象的保存态 preview，或使用用户提供的原图。',
    },
  };
}

async function addVisual(
  options: ModelToolOptions,
  location: ContextLocation,
  revision: bigint,
  objects: readonly ObjectMetadata[],
  payloads: ReadonlyMap<string, ObjectPayload>,
  signal: AbortSignal,
  requested: readonly ContextRepresentation[],
) {
  const content: ContentBlock[] = [];
  const provided: ContextRepresentation[] = [];
  const missing: MissingRepresentation[] = [];
  const media: { representation: ContextRepresentation; origin: string; objectId?: string }[] = [];

  function add(result: VisualResult) {
    if ('missing' in result) {
      missing.push(result.missing);
    } else {
      const { representation, image, origin, objectId } = result;
      content.push(image);
      provided.push(representation);
      media.push({ representation, origin, objectId });
    }
  }

  if (requested.includes('preview')) {
    try {
      add(await preview(options, location, revision, objects, signal));
    } catch (error) {
      missing.push(contentError(error, 'preview'));
    }
  }

  if (requested.includes('image')) {
    try {
      add(await contextImage(options, location.boardId, payloads, signal));
    } catch (error) {
      missing.push(contentError(error, 'image'));
    }
  }

  return { content, provided, missing, media };
}

function categoryCounts(objects: readonly ObjectMetadata[]) {
  const counts = new Map<string, number>();
  for (const { kind } of objects) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
}

function readPage(input: ContextInput, location: ContextLocation) {
  const requested = contextRepresentations.filter((name) =>
    (input.include ?? ['overview']).includes(name),
  );
  const key = JSON.stringify([location.boardId, location.scope, location.sourceRef, requested]);
  const cursor = contextCursor(input.cursor);
  if (cursor && cursor.key !== key) {
    throw invalidArgument('续读时请沿用相同白板、范围和表示类型。');
  }

  const expected = location.revision;
  const revision = cursor ? BigInt(cursor.revision) : expected;
  if (expected !== undefined && expected !== revision) {
    throw invalidArgument('续读游标与请求版次不一致。');
  }

  return { requested, key, revision, offset: cursor?.offset ?? 0, pageSize: input.pageSize ?? 8 };
}

async function artifactContext(
  options: ModelToolOptions,
  input: ContextInput,
  signal: AbortSignal,
) {
  const location = await locate(options, input, signal);
  const { requested, key, revision: pinned, offset, pageSize } = readPage(input, location);
  const source = { ...location, revision: pinned };
  const snapshot = await retainedScene(options, source, signal);
  if (!snapshot) {
    return archivedContext(source, requested);
  }

  const { scene, revision } = snapshot;
  const selected = selectContextObjects(scene.objects, source.scope);
  const page = selected.objects.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  let payloads = new Map<string, ObjectPayload>();
  let missingPayloadIds: readonly string[] = [];
  const missing: MissingRepresentation[] = [];
  const payloadRequests = requested.filter((name) => name !== 'overview' && name !== 'preview');
  if (payloadRequests.length) {
    try {
      const result = await readPayloads(options, source, page, signal);
      payloads = result.payloads;
      missingPayloadIds = result.missing;
    } catch (error) {
      missing.push(...payloadRequests.map((name) => contentError(error, name)));
    }
  }

  const rendered = representObjects(page, payloads, requested, source);
  const visual = await addVisual(
    options,
    source,
    revision,
    selected.objects,
    payloads,
    signal,
    requested,
  );
  signal.throwIfAborted();
  const structured = requested.includes('structure');
  const overview = requested.includes('overview');
  const labels = structured
    ? new Map(scene.objects.map((object) => [object.objectId, titleFor(object)]))
    : new Map<string, string>();

  if (structured) {
    rendered.provided.add('structure');
  }
  if (overview) {
    rendered.provided.add('overview');
  }

  const data = {
    boardId: source.boardId,
    title: contextLabel(scene.title),
    revision: revision.toString(),
    scope: source.scope,
    sourceRef: source.sourceRef,
    point: source.point,
    count: selected.objects.length,
    kinds: overview ? categoryCounts(selected.objects) : undefined,
    objects: rendered.objects.map(({ object, parts }) => ({
      ...(structured
        ? contextObject(object, labels)
        : { id: object.objectId, kind: object.kind, label: titleFor(object) }),
      ...(structured && parts?.structure && { structure: parts.structure }),
      ...(requested.includes('text') &&
        parts?.text && {
          textOrigin: parts.textOrigin,
          textTruncated: parts.textTruncated,
        }),
      ...(requested.includes('source') &&
        parts?.source && {
          source: { revision: parts.source.sourceRevision, truncated: parts.source.truncated },
        }),
    })),
    returned: [...rendered.provided, ...visual.provided],
    missing: [...missing, ...rendered.missing, ...visual.missing],
    missingObjectIds: selected.missing,
    missingPayloadIds,
    media: visual.media,
    nextCursor:
      nextOffset < selected.objects.length
        ? nextContextCursor(key, revision, nextOffset)
        : undefined,
  };

  return {
    content: [...rendered.content, ...visual.content],
    structuredContent: { ok: true, data },
  };
}

async function retainedScene(
  options: ModelToolOptions,
  location: ContextLocation,
  signal: AbortSignal,
) {
  try {
    return await readScene(options, location.boardId, location.revision, signal);
  } catch (error) {
    if (location.sourceRef && error instanceof BridgeError && error.code === 'NOT_FOUND') {
      return undefined;
    }

    throw error;
  }
}

function archivedContext(location: ContextLocation, requested: readonly ContextRepresentation[]) {
  const { boardId, revision, sourceRef, excerpt, scope, point } = location;
  const text = requested.includes('text') ? excerpt : undefined;
  const returned = text ? ['text'] : [];
  const data = {
    boardId,
    revision: revision?.toString(),
    sourceRef,
    scope,
    point,
    returned,
    missing: requested
      .filter((name) => !returned.includes(name))
      .map((representation) => ({
        representation,
        reason: 'revisionUnavailable',
        next: '确认仍需查看现有对象时，按对象或分区范围读取当前保存版次。',
      })),
  };

  return {
    content: text ? [{ type: 'text' as const, text: '备注冻结摘录\n' + text }] : [],
    structuredContent: { ok: true, data },
  };
}

export function registerArtifactContext(server: McpServer, options: ModelToolOptions): void {
  server.registerTool(
    'artifact_context',
    {
      title: '读取白板上下文',
      description:
        '按任务从已保存的白板范围或备注来源读取概要、正文、结构、保存态图、原图或源码。大范围按返回游标续读。',
      inputSchema: contextSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        const boardId = input.sourceRef?.boardId ?? input.boardId;

        return await withAgentRead(
          options,
          boardId,
          () => artifactContext(options, input, signal),
          signal,
        );
      } catch (error) {
        return modelToolFailure(error, options.onError);
      }
    },
  );
}
