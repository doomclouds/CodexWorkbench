import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { artifactApplySchema } from './artifact-apply.js';
import {
  artifactIdentifier,
  artifactVersion,
  modelBoardId,
  modelVersion,
} from './artifact-tool-input.js';
import { invalidArgument, tooLarge } from './errors.js';

const maxIds = 10;
const maxRows = 20;
const defaultRows = 10;
const maxSourceChars = 16_384;
const scopeLimit = 10_000_000;
const boardId = artifactIdentifier;
const identifier = artifactIdentifier;
const identifiers = z.array(identifier).min(1).max(maxIds);
const revision = artifactVersion;
const versionId = z.union([revision, z.string().regex(/^revision-(0|[1-9]\d{0,19})$/u)]);
const coordinate = z.number().min(-scopeLimit).max(scopeLimit);
const dimension = z.number().positive().max(scopeLimit);
const rect = z.strictObject({ x: coordinate, y: coordinate, w: dimension, h: dimension });
const modes = [
  'summary',
  'search',
  'region',
  'objects',
  'units',
  'blocks',
  'tasks',
  'source',
  'context',
  'history',
  'diff',
  'assets',
  'resource',
  'operation-receipt',
] as const;

const receiptFields = artifactApplySchema
  .pick({ taskId: true, generation: true, commandId: true, operations: true })
  .partial().shape;

export const artifactReadSchema = z.strictObject({
  ...receiptFields,
  operationId: receiptFields.commandId,
  boardId: boardId.optional().describe('白板 ID'),
  artifactId: boardId.optional().describe('同一白板的作品 ID'),
  mode: z.enum(modes).optional().describe('默认 summary'),
  ids: identifiers.optional().describe('对象或差异单元的稳定 ID，最多 10 项'),
  elementId: identifier.optional(),
  regionId: identifier.optional(),
  blockIds: identifiers.optional(),
  itemIds: identifiers.optional(),
  checked: z.boolean().optional(),
  query: z.string().trim().min(1).max(200).optional(),
  rect: rect.optional().describe('白板世界坐标与尺寸，不是屏幕像素'),
  type: identifier.optional(),
  parentId: identifier.optional(),
  atRevision: revision.optional().describe('保留的白板修订，uint64 十进制字符串或安全整数'),
  sourceRevision: revision.optional(),
  feedbackId: identifier.optional(),
  contextId: identifier.optional(),
  viewId: identifier.optional(),
  fromVersionId: versionId.optional(),
  toVersionId: versionId.optional(),
  versionId: versionId.optional(),
  adjacent: z.literal(true).optional(),
  assetId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/u)
    .optional(),
  cursor: z
    .string()
    .max(16_384)
    .regex(/^[A-Za-z0-9_.-]+$/u)
    .optional(),
  limit: z.number().int().min(1).max(maxRows).optional(),
});

type ReadInput = z.infer<typeof artifactReadSchema>;
export type ReadMode = (typeof modes)[number];
export type ReadRect = NonNullable<ReadInput['rect']>;
export type ReadArguments = ReadInput & {
  readonly boardId: string;
  readonly mode: ReadMode;
  readonly limit: number;
  readonly elementId?: string;
  readonly feedbackId?: string;
};

const elementModes = new Set<ReadMode>(['blocks', 'tasks', 'source']);
const explicitModes = new Set<ReadMode>(['objects', 'units', 'diff']);
const frozenModes = new Set<ReadMode>(['context', 'blocks', 'tasks', 'source']);
const discoveryModes = new Set<ReadMode>(['summary', 'search', 'region']);

function agreed(first: string | undefined, alias: string | undefined, label: string) {
  if (first && alias && first !== alias) {
    throw invalidArgument(label + '与别名不一致。');
  }

  return first ?? alias;
}

function validateTargets(args: ReadArguments) {
  const { mode, elementId, ids, query, rect: area, feedbackId, viewId, assetId } = args;
  if (elementModes.has(mode) && !elementId) {
    throw invalidArgument('此模式需要稳定对象 ID。');
  }
  if (explicitModes.has(mode) && !ids?.length) {
    throw invalidArgument('此模式需要明确的 ids。');
  }

  const invalidSearch = mode === 'search' && !query;
  const invalidRegion = mode === 'region' && !area;
  if (invalidSearch || invalidRegion) {
    throw invalidArgument('搜索需要 query，区域读取需要 rect。');
  }
  if (mode === 'resource' && !assetId) {
    throw invalidArgument('资源读取需要明确的 assetId。');
  }
  if (feedbackId && !frozenModes.has(mode)) {
    throw invalidArgument('反馈冻结来源请通过 context、blocks、tasks 或 source 读取。');
  }
  if (viewId && (mode !== 'context' || feedbackId)) {
    throw invalidArgument('活视图必须是独立的明确 context 请求。');
  }
  if (mode === 'context' && !feedbackId && !viewId) {
    throw invalidArgument('必须提供明确的反馈引用或宿主 viewId。');
  }
}

function rejectExtra(args: ReadArguments) {
  const { mode } = args;
  const fields = [
    [elementModes.has(mode), ['elementId']],
    [explicitModes.has(mode) || discoveryModes.has(mode), ['ids']],
    [mode === 'blocks', ['blockIds']],
    [mode === 'tasks', ['itemIds', 'checked']],
    [mode === 'diff', ['adjacent', 'fromVersionId', 'toVersionId', 'versionId']],
    [mode === 'source', ['sourceRevision']],
    [mode === 'search', ['query']],
    [discoveryModes.has(mode), ['rect', 'type', 'parentId']],
    [mode === 'resource', ['assetId']],
    [
      mode === 'operation-receipt',
      ['taskId', 'generation', 'commandId', 'operationId', 'operations'],
    ],
    [
      mode !== 'assets' &&
        mode !== 'resource' &&
        mode !== 'history' &&
        mode !== 'diff' &&
        mode !== 'operation-receipt',
      ['atRevision'],
    ],
  ] as const;

  for (const [allowed, group] of fields) {
    if (!allowed && group.some((key) => args[key] !== undefined)) {
      throw invalidArgument('所选模式不支持此目标约束。');
    }
  }
}

export function readArguments(input: ReadInput): ReadArguments {
  const {
    boardId: _board,
    artifactId: _artifact,
    elementId: object,
    regionId,
    feedbackId: feedback,
    contextId,
    mode = 'summary',
    limit = defaultRows,
    ...fields
  } = input;
  const args = {
    ...fields,
    boardId: modelBoardId(input),
    elementId: agreed(object, regionId, '对象 ID'),
    feedbackId: agreed(feedback, contextId, '反馈 ID'),
    mode,
    limit,
  };
  validateTargets(args);
  rejectExtra(args);

  return args;
}

export function readOriginalEdit(args: ReadArguments) {
  const original = artifactApplySchema.safeParse({
    boardId: args.boardId,
    taskId: args.taskId,
    generation: args.generation,
    commandId: agreed(args.commandId, args.operationId, '命令 ID'),
    operations: args.operations,
  });

  if (!original.success || args.cursor) {
    throw invalidArgument('查询回执需要原写入命令的 ID、工作区代次和完整 operations。');
  }

  return original.data;
}

export function parseRevision(value: string | number | undefined): bigint | undefined {
  return modelVersion(typeof value === 'string' ? value.replace(/^revision-/u, '') : value);
}

export class ArtifactReadFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const cursorSchema = z.tuple([
  z.string(),
  z.string(),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);

export interface ReadPosition {
  readonly offset: number;
  readonly inner?: number;
}

export interface ReadPage {
  readonly position: ReadPosition;
  readonly limit: number;
  readonly bytes: number;
  readonly next: (offset: number, inner?: number) => string;
}

function cursorFields({ cursor: _cursor, ...fields }: ReadArguments) {
  return JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
}

function decodeCursor(cursor: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch (error) {
    throw new ArtifactReadFailure('INVALID_CURSOR', '读取游标无效。', { cause: error });
  }
}

export function readPage(args: ReadArguments, revision: string, bytes: number): ReadPage {
  const scope = cursorFields(args);
  const encode = (offset: number, inner = 0) =>
    Buffer.from(JSON.stringify([scope, revision, offset, inner]), 'utf8').toString('base64url');
  let position: ReadPosition = { offset: 0 };
  if (args.cursor) {
    const [previousScope, previousRevision, offset, inner] = decodeCursor(args.cursor);
    if (scope !== previousScope) {
      throw new ArtifactReadFailure('INVALID_CURSOR', '读取游标属于不同的目标或查询范围。');
    }
    if (revision !== previousRevision) {
      throw new ArtifactReadFailure('CURSOR_STALE', '白板修订已变化，请重新读取第一页。');
    }

    position = { offset, inner };
  }

  return { position, limit: args.limit, bytes, next: encode };
}

export function readBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function requireReadBudget<T>(data: T, max: number): T {
  if (readBytes(data) > max) {
    throw tooLarge('读取超过单页大小，请缩小目标范围或通过 source 分页读取原始内容。');
  }

  return data;
}

export function rowPage(
  rows: readonly unknown[],
  key: string,
  base: Readonly<Record<string, unknown>>,
  page: ReadPage,
) {
  const {
    position: { offset },
    limit,
    bytes,
    next,
  } = page;

  if (offset > rows.length) {
    throw new ArtifactReadFailure('INVALID_CURSOR', '读取游标超过当前结果范围。');
  }

  for (let end = Math.min(rows.length, offset + limit); end >= offset; end--) {
    const suffix = end < rows.length ? { nextCursor: next(end) } : {};
    const result = { ...base, [key]: rows.slice(offset, end), totalCount: rows.length, ...suffix };
    if ((end > offset || offset === rows.length) && readBytes(result) <= bytes) {
      return result;
    }
  }

  throw tooLarge('单项内容超过返回限制，请通过 source 按原文分页读取。');
}

export function sourcePage(
  input: string,
  key: 'html' | 'json' | 'base64',
  metadata: Readonly<Record<string, unknown>>,
  page: ReadPage,
) {
  const {
    position: { offset },
    bytes,
    next,
  } = page;
  const invalidBase64 = key === 'base64' && offset % 4 !== 0;
  if (offset > input.length || splitSurrogate(input, offset) || invalidBase64) {
    throw new ArtifactReadFailure('INVALID_CURSOR', '源码游标位置无效。');
  }

  let low = offset;
  let high = Math.min(input.length, offset + maxSourceChars);
  let best = offset;
  const response = (end: number) => ({
    ...metadata,
    [key]: input.slice(offset, end),
    offset,
    length: input.length,
    ...(end < input.length ? { nextCursor: next(end) } : {}),
  });

  while (low <= high) {
    const end = Math.floor((low + high) / 2);
    if (readBytes(response(end)) <= bytes) {
      best = end;
      low = end + 1;
    } else {
      high = end - 1;
    }
  }
  if (splitSurrogate(input, best)) {
    best--;
  }
  if (key === 'base64' && best < input.length) {
    best -= best % 4;
  }
  if (best <= offset && offset < input.length) {
    throw tooLarge('单页返回预算不足。');
  }

  return requireReadBudget(response(best), bytes);
}

function splitSurrogate(text: string, position: number) {
  const high = text.charCodeAt(position - 1);
  const low = text.charCodeAt(position);
  const lead = high >= 0xd800 && high <= 0xdbff;

  return lead && low >= 0xdc00 && low <= 0xdfff;
}
