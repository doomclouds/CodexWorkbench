import { z } from 'zod';
import {
  studioArtifactSchema as artifact,
  studioBoardSchema as board,
  studioDocumentSchema as documentContent,
} from '../contracts/board-shape';
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
} from '../contracts/studio.js';
import type { AppTransportResult } from '../contracts/transport.js';

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
  .enum(['board', 'document', 'version', 'history', 'diff', 'units', 'source'])
  .default('document');

type ReadSchemas = { [Mode in ArtifactReadMode]: z.ZodType<ArtifactReadResults[Mode]> };

const schemas: ReadSchemas = {
  board,
  document: board,
  version: z.looseObject({ board }),
  history: z.looseObject({ history: z.array(historyEntry), batches: z.array(historyBatch) }),
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
