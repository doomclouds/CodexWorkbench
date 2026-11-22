import { z } from 'zod';
import {
  BOARD_OPEN_FORMAT,
  BOARD_SCENE_FORMAT,
  BOARD_SCENE_GEOMETRY,
  type BoardOpenResponse,
  type BoardSceneResponse,
  type BoardSceneUnit,
} from '../../contracts/board-open.js';
import {
  isBoardElementProjection,
  studioArtifactSchema as artifact,
  studioBoardSchema as board,
  studioDocumentSchema as documentContent,
} from '../../contracts/board-shape';
import {
  STUDIO_TOOLS,
  type ArtifactReadMode,
  type ArtifactReadRequest,
  type ArtifactReadResult,
  type ArtifactReadResults,
  type Connection,
  type OtherStudioTool,
  type StudioToolCall,
  type StudioToolArguments,
  type ToolFailure,
  type ToolName,
} from '../../contracts/studio.js';
import type { AppTransportResult } from '../../contracts/transport.js';
import { isRecord } from '../../shared/is-record.js';

const text = z.string();
const revision = z.int().nonnegative();
const strings = z.array(text);
const actor = z.looseObject({
  id: text,
  name: text,
  kind: z.enum(['human', 'agent']),
  role: z.enum(['owner', 'editor', 'commenter', 'viewer']),
  presentationId: text.optional(),
});
const historyEntry = z.looseObject({
  id: text,
  revision,
  createdAt: text,
  actor,
  summary: text,
  changedIds: strings,
  restoredFrom: text.optional(),
  restoreMode: z.literal('undo').optional(),
});
const unitSaveReceipt = z.looseObject({
  receiptFormat: z.literal('units-v1'),
  operationId: text,
  baseRevision: revision,
  artifact,
  historyEntry,
  units: z.array(z.unknown()),
});
const historyBatch = historyEntry.extend({
  firstVersionId: text,
  firstRevision: revision,
  firstCreatedAt: text,
  beforeVersionId: text.optional(),
  versionIds: strings,
});
const unit = z.looseObject({ id: text, after: z.unknown() });
const diffUnit = unit.extend({
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
const modeSchema = z
  .enum(['board', 'document', 'version', 'history', 'operation-receipt', 'diff', 'units', 'source'])
  .default('document');

type ReadSchemas = { [Mode in ArtifactReadMode]: z.ZodType<ArtifactReadResults[Mode]> };

const schemas: ReadSchemas = {
  board,
  document: board,
  version: z.looseObject({ board }),
  history: z.looseObject({ history: z.array(historyEntry), batches: z.array(historyBatch) }),
  'operation-receipt': z.looseObject({ operationId: text, board, historyEntry }),
  units: z.looseObject({ artifact, units: z.array(unit) }),
  diff: z.looseObject({
    units: z.array(diffUnit),
    fromRevision: revision.nullable(),
    toRevision: revision,
  }),
  source: z.union([
    z.looseObject({ html: text, document: z.never().optional() }),
    z.looseObject({
      html: z.never().optional(),
      artifactId: text,
      elementId: text.optional(),
      version: revision,
      document: documentContent,
      text: text.optional(),
    }),
  ]),
};

const boardOpenHead = z.looseObject({
  format: z.literal(BOARD_OPEN_FORMAT),
  artifactId: text.min(1),
  revision,
  epoch: text.regex(/^[A-Za-z0-9_-]{1,120}$/),
});
const boardOpen = z.discriminatedUnion('unchanged', [
  boardOpenHead.extend({ unchanged: z.literal(true), artifact, board: z.never().optional() }),
  boardOpenHead.extend({ unchanged: z.literal(false), board, artifact: z.never().optional() }),
]);

const boardScene = boardOpenHead.extend({
  format: z.literal(BOARD_SCENE_FORMAT),
  scene: z.looseObject({
    artifact,
    style: board.shape.style,
    orderVersion: revision.optional(),
    units: z.array(z.unknown()),
  }),
});
const geometryFields = new Set<string>(BOARD_SCENE_GEOMETRY);

const errorSchema = z.object({ code: text, message: text, details: z.unknown().optional() });
const failedTool = z.looseObject({
  ok: z.literal(false),
  data: z.never().optional(),
  error: errorSchema,
});
const successfulTool = z.looseObject({
  ok: z.literal(true),
  data: z.unknown(),
  error: z.never().optional(),
});
const httpEnvelope = z.discriminatedUnion('ok', [successfulTool, failedTool]);
const hostEnvelope = z.discriminatedUnion('ok', [
  successfulTool.partial({ data: true }),
  failedTool,
]);
const connection = z.looseObject({
  baseUrl: text.optional(),
  token: text,
  actor,
  artifactId: text.optional(),
  access: z.enum(['local', 'lan']).optional(),
});
const openingRoute = successfulTool.extend({
  data: z.looseObject({ artifactId: text.optional(), view: text.optional() }).optional(),
});
const appResponse = z.looseObject({
  status: z.int().min(200).max(599),
  headers: z.record(text, text),
  body: text.optional(),
  downloadId: text.optional(),
  size: revision,
});
const uploadReceipt = z.looseObject({ transferId: text, nextOffset: revision });
const downloadChunk = z.looseObject({ data: text, nextOffset: revision, done: z.boolean() });
const releasedTransfer = z.looseObject({ released: z.boolean() });

function invalidResponse(message: string, status?: number, cause?: unknown) {
  return Object.assign(new Error(message, { cause }), { code: 'INVALID_RESPONSE', status });
}

function toolError(failure: ToolFailure | undefined, fallback: string, status?: number) {
  return Object.assign(new Error(failure?.message || fallback), {
    code: failure?.code,
    details: failure?.details,
    status,
  });
}

async function decodeHttpEnvelope(response: Response): Promise<unknown> {
  let input: unknown;
  const fallback = `作品服务返回了无效的响应（${response.status}）。`;

  try {
    input = await response.json();
  } catch (error) {
    throw invalidResponse(fallback, response.status, error);
  }

  const envelope = httpEnvelope.safeParse(input);
  if (!envelope.success) {
    throw invalidResponse(fallback, response.status, envelope.error);
  }
  if (!envelope.data.ok) {
    throw toolError(envelope.data.error, '操作未完成', response.status);
  }
  if (!response.ok || envelope.data.data === undefined) {
    throw invalidResponse(fallback, response.status);
  }

  return envelope.data.data;
}

function assertReadResult<Mode extends ArtifactReadMode>(
  mode: Mode,
  value: unknown,
  status: number,
): asserts value is ArtifactReadResults[Mode] {
  const result = schemas[mode].safeParse(value);
  if (!result.success) {
    throw invalidResponse(`作品读取返回了无效的 ${mode} 数据。`, status, result.error);
  }
}

function verifyUnitSaveReceipt(args: Record<string, unknown>, result: unknown, status: number) {
  const parsed = unitSaveReceipt.safeParse(result);
  if (!parsed.success) {
    throw invalidResponse('作品读取返回了无效的增量回执。', status, parsed.error);
  }

  const data = parsed.data;
  const matchingIntent =
    data.operationId === args.operationId && data.artifact.id === args.artifactId;
  const matchingRevision =
    data.artifact.revision === data.historyEntry.revision &&
    data.artifact.revision === data.baseRevision + 1;

  if (!matchingIntent || !matchingRevision) {
    throw invalidResponse('作品读取返回的操作回执不匹配。', status);
  }

  return result;
}

function verifyOperationReceipt(args: Record<string, unknown>, result: unknown, status: number) {
  if (
    args.receiptFormat === 'units-v1' &&
    isRecord(result) &&
    result.receiptFormat === 'units-v1'
  ) {
    return verifyUnitSaveReceipt(args, result, status);
  }

  assertReadResult('operation-receipt', result, status);
  if (
    result.operationId !== args.operationId ||
    result.board.artifact.id !== args.artifactId ||
    result.historyEntry.revision !== result.board.artifact.revision
  ) {
    throw invalidResponse('作品读取返回的操作回执不匹配。', status);
  }

  return result;
}

type ReadResponse = (response: Response) => Promise<unknown>;
type RequestTool = (
  name: ToolName,
  args: Record<string, unknown>,
  read: ReadResponse,
) => Promise<unknown>;

async function readToolResponse(name: ToolName, args: Record<string, unknown>, response: Response) {
  const payload = await decodeHttpEnvelope(response);
  if (name !== STUDIO_TOOLS.read) {
    return payload;
  }

  const mode = modeSchema.safeParse(args.mode);
  if (!mode.success) {
    throw invalidResponse('无法识别作品读取模式。', response.status, mode.error);
  }
  if (mode.data === 'operation-receipt') {
    return verifyOperationReceipt(args, payload, response.status);
  }

  assertReadResult(mode.data, payload, response.status);

  return payload;
}

export function createStudioToolCall(request: RequestTool): StudioToolCall {
  function call<Request extends ArtifactReadRequest>(
    name: typeof STUDIO_TOOLS.read,
    args: Request,
  ): Promise<ArtifactReadResult<Request>>;
  function call<T = unknown>(name: OtherStudioTool, args?: Record<string, unknown>): Promise<T>;
  function call(...args: StudioToolArguments): Promise<unknown>;
  function call(name: ToolName, args: Record<string, unknown> = {}): Promise<unknown> {
    return request(name, args, (response) => readToolResponse(name, args, response));
  }

  return call;
}

export function decodeBoardOpenResponse(
  value: unknown,
  artifactId: string,
): BoardOpenResponse | undefined {
  if (!isRecord(value) || value.format !== BOARD_OPEN_FORMAT) {
    return;
  }

  const parsed = boardOpen.safeParse(value);
  if (!parsed.success) {
    throw invalidResponse('作品服务返回了无效的权威白板元数据。', undefined, parsed.error);
  }

  const { data } = parsed;
  const metadata = data.unchanged ? data.artifact : data.board.artifact;
  const matchesArtifact = data.artifactId === artifactId && metadata.id === artifactId;
  if (!matchesArtifact || metadata.revision !== data.revision) {
    throw invalidResponse('作品服务返回的白板标识与版次不匹配。');
  }

  return data;
}

function sceneUnit(unit: unknown): BoardSceneUnit | undefined {
  if (!isRecord(unit)) {
    return;
  }
  if (unit.state === 'complete') {
    return isBoardElementProjection(unit.element)
      ? { state: 'complete', element: unit.element }
      : undefined;
  }

  const { geometry } = unit;
  if (unit.state !== 'unloaded' || !isRecord(geometry)) {
    return;
  }
  if (Object.keys(geometry).some((field) => !geometryFields.has(field))) {
    return;
  }

  return isBoardElementProjection(geometry) ? { state: 'unloaded', geometry } : undefined;
}

function decodeSceneUnits(units: unknown[]) {
  const ids = new Set<string>();
  const decoded: BoardSceneUnit[] = [];
  for (const value of units) {
    const unit = sceneUnit(value);
    if (!unit) {
      return;
    }

    const { id } = unit.state === 'complete' ? unit.element : unit.geometry;
    if (ids.has(id)) {
      return;
    }

    ids.add(id);
    decoded.push(unit);
  }

  return decoded;
}

export function decodeBoardSceneResponse(
  value: unknown,
  artifactId: string,
): BoardSceneResponse | undefined {
  if (!isRecord(value) || value.format !== BOARD_SCENE_FORMAT) {
    return;
  }

  const parsed = boardScene.safeParse(value);
  if (!parsed.success) {
    throw invalidResponse('作品服务返回了无效的首屏场景。', undefined, parsed.error);
  }

  const { data } = parsed;
  const matchesArtifact = data.artifactId === artifactId && data.scene.artifact.id === artifactId;
  if (!matchesArtifact || data.revision !== data.scene.artifact.revision) {
    throw invalidResponse('作品服务返回的首屏场景不能用于当前版次。');
  }

  const units = decodeSceneUnits(data.scene.units);
  if (!units) {
    throw invalidResponse('作品服务返回了无效或重复的首屏对象。');
  }

  return { ...data, scene: { ...data.scene, units } };
}

export function decodeStudioConnection(
  value: unknown,
  fallbackBaseUrl = '',
): Connection | undefined {
  const parsed = connection.safeParse(value);
  if (!parsed.success) {
    return;
  }

  const baseUrl = parsed.data.baseUrl || fallbackBaseUrl;
  return baseUrl ? { ...parsed.data, baseUrl } : undefined;
}

export function decodeOpeningRoute(value: unknown) {
  const parsed = openingRoute.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function assertHostToolSuccess(
  value: unknown,
  isError: boolean | undefined,
  fallback: string,
) {
  if (value === undefined && !isError) {
    return;
  }

  const status = hostEnvelope.safeParse(value);
  if (!status.success) {
    if (isError) {
      throw toolError(undefined, fallback);
    }

    throw invalidResponse('宿主返回了无效的作品传输状态。', undefined, status.error);
  }
  if (!status.data.ok || isError) {
    throw toolError(status.data.error, fallback);
  }
}

function appTransportSchema(action: unknown): z.ZodType<AppTransportResult> {
  switch (action) {
    case 'request':
      return appResponse;
    case 'upload':
      return uploadReceipt;
    case 'download':
      return downloadChunk;
    case 'release':
      return releasedTransfer;
    default:
      throw invalidResponse('无法识别作品界面传输操作。');
  }
}

export function decodeAppTransportResult(action: unknown, value: unknown): AppTransportResult {
  const result = appTransportSchema(action).safeParse(value);
  if (!result.success) {
    throw invalidResponse(
      '作品服务没有返回有效的界面响应，请重新打开作品。',
      undefined,
      result.error,
    );
  }

  return result.data;
}
