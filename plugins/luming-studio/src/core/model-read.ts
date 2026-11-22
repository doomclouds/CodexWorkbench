import { createHash } from 'node:crypto';
import { STUDIO_TOOLS, type ToolName } from '../contracts/studio.js';
import { isRecord as object } from '../shared/is-record.js';
import { StudioError } from '../shared/studio-error.js';

type Fields = Record<string, unknown>;

export const MODEL_MAX_ITEMS = 20;
export const MODEL_MAX_IDS = 10;
export const MODEL_MAX_BYTES = 32 * 1024;
const MODEL_MAX_IMAGE_BYTES = 1024 * 1024;
const SOURCE_DEFAULT = 8 * 1024;
const CURSOR_FIELDS = [
  'mode',
  'query',
  'type',
  'parentId',
  'rect',
  'ids',
  'elementId',
  'regionId',
  'blockIds',
  'itemIds',
  'checked',
  'feedbackId',
  'contextId',
  'sourceRevision',
  'atRevision',
  'action',
  'status',
  'trashed',
  'pinned',
] as const;

function invalid(message: string): never {
  throw new StudioError('INVALID_ARGUMENT', message);
}

function exceeds(message: string): never {
  throw new StudioError('LIMIT_EXCEEDED', message);
}

function hasId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && value.trim().length > 0;
}

function requireTarget(value: unknown, label: string) {
  if (!hasId(value)) {
    invalid(`请提供${label}。`);
  }
}

function idsWithinLimit(value: unknown, label: string, optional = false) {
  if (optional && value === undefined) {
    return;
  }

  if (!Array.isArray(value) || !value.length || !value.every(hasId)) {
    invalid(`请提供${label}。`);
  }
  if (value.length > MODEL_MAX_IDS) {
    exceeds(`${label}一次最多 ${MODEL_MAX_IDS} 个。`);
  }
}

function requireRect(value: unknown) {
  if (!object(value)) {
    invalid('请提供有效的白板世界坐标范围。');
  }

  const bounded = ['x', 'y', 'w', 'h'].every((key) => {
    const coordinate = value[key];

    return (
      typeof coordinate === 'number' &&
      Number.isFinite(coordinate) &&
      Math.abs(coordinate) <= 10_000_000
    );
  });

  if (!bounded || Number(value.w) <= 0 || Number(value.h) <= 0) {
    invalid('请提供有效的白板世界坐标范围。');
  }
}

function pageBounds(args: Fields, max = MODEL_MAX_ITEMS) {
  if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || Number(args.limit) < 1)) {
    invalid('limit 必须是正整数。');
  }
  if (args.limit !== undefined && Number(args.limit) > max) {
    exceeds(`此读取方式单页最多 ${max}。请减少 limit 并按游标继续。`);
  }
  if (
    args.offset !== undefined &&
    (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0)
  ) {
    invalid('offset 必须是非负整数。');
  }
  if (args.cursor !== undefined) {
    if (typeof args.cursor !== 'string' || args.cursor.length > 256 || args.offset !== undefined) {
      invalid('请单独使用上页返回的 nextCursor。');
    }
  }

  return { ...args, limit: args.limit ?? (max === MODEL_MAX_BYTES ? SOURCE_DEFAULT : 10) };
}

function boundedExportRequest(args: Fields): Fields {
  const format = typeof args.format === 'string' ? args.format.toLowerCase() : 'json';
  if (format === 'zip') {
    throw new StudioError('APP_ONLY', '完整备份请通过作品界面导出。');
  }
  if (args.viewId !== undefined) {
    throw new StudioError(
      'LIVE_CAPTURE_REQUIRED',
      '实时视图请使用已打开白板的宿主截图入口；局部导出渲染已保存版本。',
    );
  }

  const targets = [args.ids, args.regionId, args.rect].filter((value) => value !== undefined);
  if (targets.length !== 1) {
    invalid('请为局部导出指定 ids、regionId 或 rect 中的一项。');
  }

  idsWithinLimit(args.ids, '导出对象 ID', true);
  if (args.regionId !== undefined) {
    requireTarget(args.regionId, '导出区域 ID');
  }
  if (args.rect !== undefined) {
    requireRect(args.rect);
    if (format !== 'png') {
      invalid('矩形范围适用于局部 PNG。其他格式请指定对象 ID。');
    }
  }
  if (args.options !== undefined || args.elementId !== undefined) {
    invalid('请使用显式导出范围。');
  }

  return { ...args, format };
}

function boundedFeedbackRequest(args: Fields): Fields {
  const action = args.action ?? 'list';
  if (action === 'preview') {
    throw new StudioError('APP_ONLY', '提案的整张白板预览请通过界面查看。');
  }

  if (action === 'get') {
    requireTarget(args.feedbackId, '反馈 ID');
  }
  if (action === 'list') {
    return pageBounds({ ...args, action });
  }

  return args;
}

function validateReadSourceTarget(mode: unknown, args: Fields): void {
  if (mode !== 'source' && mode !== 'blocks' && mode !== 'tasks') {
    return;
  }

  requireTarget(
    mode === 'tasks' ? args.elementId : (args.elementId ?? args.regionId),
    '要读取的对象或区域 ID',
  );

  if (
    args.elementId !== undefined &&
    args.regionId !== undefined &&
    args.elementId !== args.regionId
  ) {
    invalid('请指定一个读取目标。');
  }

  idsWithinLimit(args.blockIds, '段落 ID', true);
  idsWithinLimit(args.itemIds, '任务 ID', true);
}

function validateDiffRequest(args: Fields): void {
  if (args.adjacent === true) {
    requireTarget(args.versionId, '相邻差异的版本 ID');

    return;
  }

  requireTarget(args.fromVersionId, '差异的起始版本 ID');
  requireTarget(args.toVersionId, '差异的结束版本 ID');
}

function boundedReadRequest(args: Fields): Fields {
  const mode = args.mode ?? 'summary';
  const request = { ...args, mode };
  if (mode === 'document' || mode === 'board' || mode === 'version') {
    throw new StudioError(
      'APP_ONLY',
      '整张白板请在界面查看；Agent 可用 summary、history 或指定 IDs 逐步定位。',
    );
  }

  if (mode === 'objects' || mode === 'units' || mode === 'diff') {
    idsWithinLimit(args.ids, '对象 ID');
  }
  if (mode === 'diff') {
    validateDiffRequest(args);
  }

  validateReadSourceTarget(mode, args);
  if (mode === 'context') {
    requireTarget(args.feedbackId ?? args.contextId ?? args.viewId, '具体反馈、上下文或视图 ID');
  }
  if (mode === 'region') {
    requireRect(args.rect);
  }
  if (mode === 'search' && (typeof args.query !== 'string' || !args.query.trim())) {
    invalid('请输入板内查找关键词。');
  }
  if (mode === 'search' || mode === 'region') {
    idsWithinLimit(args.ids, '过滤对象 ID', true);
  }
  if (mode === 'source') {
    return pageBounds(request, MODEL_MAX_BYTES);
  }
  if (
    ['summary', 'history', 'blocks', 'tasks', 'assets', 'search', 'region', 'context'].includes(
      String(mode),
    )
  ) {
    return pageBounds(request);
  }

  return request;
}

export function boundedModelRequest(name: ToolName, args: Fields): Fields {
  if (name === STUDIO_TOOLS.list) {
    return pageBounds(args);
  }
  if (name === STUDIO_TOOLS.export) {
    return boundedExportRequest(args);
  }
  if (name === STUDIO_TOOLS.feedback) {
    return boundedFeedbackRequest(args);
  }

  return name === STUDIO_TOOLS.read ? boundedReadRequest(args) : args;
}

export function modelDataBudget(name: ToolName, args: Fields): number {
  if (name === STUDIO_TOOLS.list || (name === STUDIO_TOOLS.read && args.mode === 'search')) {
    return 8 * 1024;
  }
  if (
    name === STUDIO_TOOLS.read &&
    ['summary', 'region', 'history', 'assets'].includes(String(args.mode))
  ) {
    return 16 * 1024;
  }

  return MODEL_MAX_BYTES;
}

export function modelDataFits(data: unknown, bytes: number) {
  return Buffer.byteLength(JSON.stringify({ ok: true, data }), 'utf8') <= bytes;
}

export interface ModelPage {
  offset: number;
  limit: number;
  cursorFor(offset: number): string;
}

export function modelPage(args: Fields, artifactId: string, revision: number | string): ModelPage {
  const fields = CURSOR_FIELDS.flatMap((key) =>
    args[key] === undefined ? [] : [[key, args[key]]],
  );
  const scope = createHash('sha256')
    .update(JSON.stringify([artifactId, fields]))
    .digest('base64url');
  let offset = Number(args.offset) || 0;
  if (args.cursor !== undefined) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(String(args.cursor), 'base64url').toString('utf8'));
    } catch (error) {
      throw new StudioError('INVALID_ARGUMENT', '分页游标无效。请从第一页重新读取。', undefined, {
        cause: error,
      });
    }

    if (!object(decoded) || decoded.scope !== scope) {
      invalid('分页游标与当前读取范围不匹配。');
    }
    if (!Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0) {
      invalid('分页游标与当前读取范围不匹配。');
    }
    if (decoded.revision !== revision) {
      throw new StudioError('CURSOR_STALE', '作品已变化，请从第一页重新读取。', { revision });
    }

    offset = Number(decoded.offset);
  }

  return {
    offset,
    limit: Number(args.limit) || 10,
    cursorFor: (nextOffset) =>
      Buffer.from(JSON.stringify({ scope, revision, offset: nextOffset })).toString('base64url'),
  };
}

export function modelPageResult(
  args: Fields,
  page: ModelPage,
  data: Fields,
  listKey: string,
  name: ToolName = STUDIO_TOOLS.read,
): Fields {
  const { nextOffset: rawNext, nextCursor: _cursor, ...metadata } = data;
  const rows = Array.isArray(metadata[listKey]) ? (metadata[listKey] as unknown[]) : [];
  let count = Math.min(rows.length, page.limit);
  const bytes = modelDataBudget(name, args);
  while (count >= 0) {
    const nextOffset = count < rows.length ? page.offset + count : rawNext;
    const next =
      typeof nextOffset === 'number' ? { nextOffset, nextCursor: page.cursorFor(nextOffset) } : {};
    const value = { ...metadata, offset: page.offset, [listKey]: rows.slice(0, count), ...next };
    if ((count > 0 || !rows.length) && modelDataFits(value, bytes)) {
      return value;
    }

    count--;
  }

  exceeds('这一页包含超出响应预算的大对象。请指定更小的范围，或按源码分段读取。');
}

export function modelElement(value: unknown): unknown {
  if (!object(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    return value;
  }

  const { html, document, ...fields } = value;
  const { data, src, video, state, points, text } = fields;
  const clipped = (input: unknown) => input !== undefined && !modelDataFits(input, 8 * 1024);
  const discarded = Object.entries({ data, src, video, state, points, text }).filter(
    ([name, content]) => (name === 'data' && value.type === 'todo') || clipped(content),
  );

  for (const [name] of discarded) {
    delete fields[name];
  }

  return {
    ...fields,
    ...(typeof html === 'string'
      ? { htmlLength: html.length, readWith: 'artifact_read source + regionId + sourceRevision' }
      : {}),
    ...(document ? { documentSchemaVersion: 1, readWith: 'artifact_read blocks + elementId' } : {}),
    ...(value.type === 'todo' ? { readWith: 'artifact_read tasks + elementId' } : {}),
    ...(discarded.length && value.type !== 'todo'
      ? {
          omittedFields: discarded.map(([name]) => name),
          ...(!html && !document ? { readWith: 'artifact_read source + elementId' } : {}),
        }
      : {}),
  };
}

function unitValue(id: unknown, value: unknown) {
  if (id === '$order' && object(value) && Array.isArray(value.ids)) {
    const totalCount = Math.max(value.ids.length, Number(value.totalCount) || 0);

    return {
      version: value.version,
      ids: value.ids.slice(0, MODEL_MAX_ITEMS),
      ...(totalCount > MODEL_MAX_ITEMS ? { totalCount } : {}),
    };
  }

  return modelElement(value);
}

export function modelUnit(value: unknown) {
  if (!object(value)) {
    return value;
  }

  return {
    ...value,
    ...Object.fromEntries(
      ['before', 'after', 'value']
        .filter((key) => Object.hasOwn(value, key))
        .map((key) => [key, unitValue(value.id, value[key])]),
    ),
  };
}

export function modelSource(value: unknown): Fields {
  if (!object(value)) {
    return {};
  }

  const { html, document, sources: _sources, element, ...metadata } = value;
  const frozen = object(element) ? element : undefined;
  const sourceHtml = typeof html === 'string' ? html : frozen?.html;

  return {
    ...metadata,
    ...(frozen ? { element: modelElement(frozen) } : {}),
    ...(document || frozen?.document
      ? {
          documentSchemaVersion: 1,
          readWith: 'artifact_read blocks + elementId，或 source 分页读取 JSON',
        }
      : {}),
    ...(typeof sourceHtml === 'string'
      ? { htmlLength: sourceHtml.length, readWith: 'artifact_read source + regionId' }
      : {}),
  };
}

function readSourceBody(result: Fields): string | undefined {
  if (typeof result.html === 'string') {
    return result.html;
  }
  if (typeof result.json === 'string') {
    return result.json;
  }
  if (object(result.document)) {
    return JSON.stringify(result.document);
  }
}

function splitsSurrogatePair(body: string, offset: number): boolean {
  return (
    /[\uD800-\uDBFF]/.test(body[offset - 1] ?? '') && /[\uDC00-\uDFFF]/.test(body[offset] ?? '')
  );
}

export function modelSourcePage(result: Fields, page: ModelPage): Fields {
  const { html, document, json, text: plainText, ...rest } = result;
  const metadata = modelSource(rest);
  const body = readSourceBody({ html, json, document });
  if (body === undefined) {
    return plainText === undefined ? metadata : { ...metadata, text: plainText };
  }

  let offset = Math.min(page.offset, body.length);
  if (offset > 0 && splitsSurrogatePair(body, offset)) {
    offset--;
  }

  const key = typeof html === 'string' ? 'html' : 'json';
  let span = Math.min(page.limit, body.length - offset);
  while (span >= 0) {
    let end = offset + span;
    if (end > offset && splitsSurrogatePair(body, end)) {
      end += span === 1 ? 1 : -1;
    }

    const next = end < body.length ? { nextOffset: end, nextCursor: page.cursorFor(end) } : {};
    const value = {
      ...metadata,
      [key]: body.slice(offset, end),
      offset,
      totalLength: body.length,
      ...next,
      complete: end === body.length,
    };

    if ((end > offset || end === body.length) && modelDataFits(value, MODEL_MAX_BYTES)) {
      return value;
    }

    span = span <= 1 ? -1 : Math.floor(span / 2);
  }

  return exceeds('源码摘要超过响应预算。请读取较小的区域或按段落 ID 查询。');
}

export function modelFeedbackItem(value: unknown): Fields {
  const item = object(value) ? value : {};
  const replies = Array.isArray(item.replies) ? item.replies : [];
  const proposal = object(item.proposal) ? item.proposal : undefined;

  return {
    ...item,
    replies: replies.slice(-5).map((reply) =>
      object(reply) && typeof reply.text === 'string' && !modelDataFits(reply.text, 2 * 1024)
        ? {
            ...reply,
            text: Array.from(reply.text).slice(0, 500).join(''),
            textLength: reply.text.length,
          }
        : reply,
    ),
    ...(typeof item.text === 'string' && !modelDataFits(item.text, 4 * 1024)
      ? { text: Array.from(item.text).slice(0, 1000).join(''), textLength: item.text.length }
      : {}),
    ...(replies.length > 5 ? { replyCount: replies.length, repliesTruncated: true } : {}),
    ...(proposal && Array.isArray(proposal.options)
      ? {
          proposal: {
            audience: proposal.audience,
            expiresAt: proposal.expiresAt,
            compact: true,
            options: proposal.options.map((value) => {
              const option = object(value) ? value : {};

              return {
                id: option.id,
                label: option.label,
                description: option.description,
                active: option.active,
                targetIds: Array.isArray(option.targetIds)
                  ? option.targetIds.slice(0, MODEL_MAX_IDS)
                  : undefined,
              };
            }),
          },
        }
      : {}),
  };
}

function projectedReadData(args: Fields, result: Fields): Fields {
  if (args.mode === 'operation-receipt') {
    const board = object(result.board) ? result.board : undefined;
    const entry = object(result.historyEntry) ? result.historyEntry : undefined;

    return {
      operationId: result.operationId,
      artifact: result.artifact ?? board?.artifact,
      historyEntry: entry && { id: entry.id, revision: entry.revision },
    };
  }
  if (args.mode === 'source') {
    if (typeof result.complete === 'boolean' && typeof result.offset === 'number') {
      return result;
    }

    const revision = typeof result.version === 'number' ? result.version : 0;

    return modelSourcePage(result, modelPage(args, String(args.artifactId), revision));
  }
  if (args.mode === 'context' && Array.isArray(result.sources)) {
    return {
      ...result,
      sources: result.sources.slice(0, Number(args.limit)).map(modelSource),
      ...(result.feedback ? { feedback: modelFeedbackItem(result.feedback) } : {}),
    };
  }
  if (args.mode === 'objects') {
    return {
      ...result,
      ...(Array.isArray(result.elements) ? { elements: result.elements.map(modelElement) } : {}),
      ...(Array.isArray(result.units) ? { units: result.units.map(modelUnit) } : {}),
    };
  }

  if ((args.mode === 'units' || args.mode === 'diff') && Array.isArray(result.units)) {
    const { changes: _changes, order: _order, style: _style, ...metadata } = result;

    return { ...metadata, units: result.units.map(modelUnit) };
  }

  return result;
}

function projectedModelData(name: ToolName, args: Fields, result: Fields): Fields {
  if (name === STUDIO_TOOLS.list && Array.isArray(result.artifacts)) {
    return {
      ...result,
      artifacts: result.artifacts.slice(0, Number(args.limit)).map((item) => {
        if (!object(item)) {
          return item;
        }

        const { thumbnail: _thumbnail, ...metadata } = item;

        return metadata;
      }),
    };
  }

  if (name === STUDIO_TOOLS.apply || name === STUDIO_TOOLS.manage) {
    let snapshot = object(result.document) ? result.document : undefined;
    if (!snapshot && object(result.board)) {
      snapshot = result.board;
    }

    const artifact = result.artifact ?? snapshot?.artifact;
    if (artifact) {
      return { artifact, ...(result.historyEntry ? { historyEntry: result.historyEntry } : {}) };
    }
  }
  if (name === STUDIO_TOOLS.read) {
    return projectedReadData(args, result);
  }

  if (name === STUDIO_TOOLS.feedback && Array.isArray(result.feedback)) {
    const id = args.feedbackId || result.contextId;
    let selected: unknown[];
    if (id) {
      selected = result.feedback.filter((item) => object(item) && item.id === id);
    } else {
      selected =
        args.action === 'list'
          ? result.feedback.slice(0, Number(args.limit))
          : result.feedback.slice(-1);
    }

    const { feedback: _feedback, board: _board, document: _document, ...metadata } = result;

    return { ...metadata, feedback: selected.map(modelFeedbackItem) };
  }

  return result;
}

export function boundedModelResult(name: ToolName, args: Fields, value: unknown): unknown {
  const result = object(value) ? projectedModelData(name, args, value) : value;
  if (modelDataFits(result, modelDataBudget(name, args))) {
    return result;
  }

  const readsFeedback =
    name === STUDIO_TOOLS.feedback && ['list', 'get'].includes(String(args.action));

  if (name === STUDIO_TOOLS.read || name === STUDIO_TOOLS.list || readsFeedback) {
    exceeds('这次读取超过 UTF‑8 响应预算。请减少目标数、分页，或按源码分段读取。');
  }

  const data = object(result) ? result : {};
  const { artifact, contextId, exportId } = data;
  const historyEntry = object(data.historyEntry)
    ? { id: data.historyEntry.id, revision: data.historyEntry.revision }
    : undefined;

  return {
    artifact,
    contextId,
    exportId,
    historyEntry,
    truncated: true,
    hint: '操作已返回，请按对象 ID 或版本分段核对。',
  };
}

export function modelResponseParts(name: ToolName, args: Fields, value: unknown) {
  if (name !== STUDIO_TOOLS.export || args.format !== 'png' || !object(value)) {
    return { data: value };
  }
  if (!Object.hasOwn(value, 'image')) {
    return { data: value };
  }

  const { image, ...data } = value;
  if (args.includeImage === false) {
    return { data };
  }

  if (!object(image) || image.mimeType !== 'image/png' || typeof image.data !== 'string') {
    exceeds('局部图像超过响应预算，请缩小范围。');
  }
  if (Buffer.byteLength(image.data, 'base64') > MODEL_MAX_IMAGE_BYTES) {
    exceeds('局部图像超过响应预算，请缩小范围。');
  }

  return { data, image: { data: image.data, mimeType: 'image/png' as const } };
}
