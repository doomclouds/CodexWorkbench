import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Buffer } from 'node:buffer';
import type { AgentReceiptLookup } from './artifact-apply.js';
import { readContent, readObjects, readUnits, contentBytes } from './artifact-read-content.js';
import {
  ArtifactReadData,
  frozenContext,
  sourceBoardRevision,
  versionJson,
} from './artifact-read-data.js';
import {
  ArtifactReadFailure,
  artifactReadSchema,
  parseRevision,
  readArguments,
  readOriginalEdit,
  readPage,
  requireReadBudget,
  rowPage,
  sourcePage,
  type ReadArguments,
} from './artifact-read-page.js';
import { readDiscovery } from './artifact-read-search.js';
import { invalidArgument } from './errors.js';
import { readActivePanelView } from './panel-view.js';
import {
  modelToolFailure,
  readModelBytes,
  withAgentRead,
  type ModelToolOptions,
} from './model-tool.js';

const overviewBytes = 16 * 1024;
const maximumAssetBytes = 20 * 1024 * 1024;
const pathBoard = /^[A-Za-z0-9_-]{1,128}$/u;
const historyCursor = /^(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})\.([A-Za-z0-9_-]+)\.(\d{1,2})$/u;

async function readAssets(data: ArtifactReadData, args: ReadArguments) {
  const { boardId, cursor, limit } = args;
  const prefix = Buffer.from(boardId, 'utf8').toString('base64url') + '.';
  if (cursor && !cursor.startsWith(prefix)) {
    throw new ArtifactReadFailure('INVALID_CURSOR', '素材游标属于不同的白板。');
  }

  const { assets, nextCursor } = await data.assets(cursor?.slice(prefix.length), limit);

  return requireReadBudget(
    {
      boardId,
      assets,
      nextCursor: nextCursor && prefix + nextCursor,
    },
    overviewBytes,
  );
}

async function readHistory(data: ArtifactReadData, args: ReadArguments) {
  const match = args.cursor && historyCursor.exec(args.cursor);
  const board = Buffer.from(args.boardId, 'utf8').toString('base64url');
  const samePage = match && match[3] === board && Number(match[4]) === args.limit;
  if (args.cursor && !samePage) {
    throw new ArtifactReadFailure('INVALID_CURSOR', '历史游标属于不同的白板或分页范围。');
  }

  const before = match ? parseRevision(match[2]) : undefined;
  const result = await data.versions(before, args.limit);
  const revision = result.currentRevision?.toString();
  if (match && match[1] !== revision) {
    throw new ArtifactReadFailure('CURSOR_STALE', '白板修订已变化，请重新读取历史第一页。');
  }

  const { nextBeforeRevision } = result;
  const nextCursor =
    nextBeforeRevision === undefined
      ? undefined
      : [revision, nextBeforeRevision, board, args.limit].join('.');

  return requireReadBudget(
    {
      boardId: args.boardId,
      revision,
      history: result.versions.map(versionJson),
      nextCursor,
    },
    overviewBytes,
  );
}

async function diffRevisions(data: ArtifactReadData, args: ReadArguments) {
  if (args.adjacent) {
    const revision = parseRevision(args.versionId);
    if (
      revision === undefined ||
      args.fromVersionId !== undefined ||
      args.toVersionId !== undefined
    ) {
      throw invalidArgument('相邻差异需要唯一的 versionId。');
    }

    const previous = await data.versions(revision, 1);

    return { after: revision, before: previous.versions[0]?.revision };
  }
  const before = parseRevision(args.fromVersionId);
  if (before === undefined || args.versionId !== undefined) {
    throw invalidArgument('版本差异需要 fromVersionId，可用 toVersionId 指定终点。');
  }

  return { before, after: parseRevision(args.toVersionId) };
}

async function readDiff(data: ArtifactReadData, args: ReadArguments) {
  const { before, after } = await diffRevisions(data, args);
  const [left, right] = await Promise.all([
    before === undefined ? undefined : data.scene(before),
    data.scene(after),
  ]);
  const ids = [...new Set(args.ids)];
  const [beforeUnits, afterUnits] = await Promise.all([
    readUnits(data, left, ids),
    readUnits(data, right, ids),
  ]);
  const changes = beforeUnits.flatMap(({ id, after: previous }, index) => {
    const current = afterUnits[index]?.after ?? null;

    return JSON.stringify(previous) === JSON.stringify(current)
      ? []
      : [{ id, before: previous, after: current }];
  });
  const base = {
    boardId: args.boardId,
    fromRevision: left?.revision.toString() ?? null,
    toRevision: right.revision.toString(),
  };
  const key = String(base.fromRevision) + ':' + base.toRevision;

  return rowPage(changes, 'units', base, readPage(args, key, contentBytes));
}

async function readResource(
  options: ModelToolOptions,
  data: ArtifactReadData,
  args: ReadArguments,
  signal: AbortSignal,
) {
  const { boardId, assetId } = args;
  if (!assetId || !pathBoard.test(boardId)) {
    throw invalidArgument('资源需要有效的白板 ID 和素材 ID。');
  }

  const snapshot = await data.scene(undefined);
  const page = readPage(args, snapshot.revision.toString(), contentBytes);
  const src = '/studio-archive-assets/' + boardId + '/' + assetId;
  const response = await options.dispatch({ route: src, method: 'GET' }, signal);
  const bytes = await readModelBytes(response, maximumAssetBytes);
  signal.throwIfAborted();
  const base = {
    boardId,
    assetId,
    src,
    revision: snapshot.revision.toString(),
    mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
    byteLength: bytes.byteLength,
  };

  return sourcePage(Buffer.from(bytes).toString('base64'), 'base64', base, page);
}

async function readArtifact(
  options: ModelToolOptions,
  args: ReadArguments,
  signal: AbortSignal,
  lookupReceipt?: AgentReceiptLookup,
) {
  if (args.mode === 'operation-receipt') {
    if (!lookupReceipt) {
      throw new ArtifactReadFailure('COMMIT_RESULT_UNKNOWN', '当前连接无法查询此写入回执。');
    }

    return lookupReceipt(readOriginalEdit(args), signal);
  }

  const data = new ArtifactReadData(options, args.boardId, signal);
  if (args.mode === 'history') {
    return readHistory(data, args);
  }
  if (args.mode === 'diff') {
    return readDiff(data, args);
  }
  if (args.mode === 'assets') {
    return readAssets(data, args);
  }
  if (args.mode === 'resource') {
    return readResource(options, data, args, signal);
  }

  const frozen = args.feedbackId ? await data.frozen(args.feedbackId) : undefined;
  const revision = sourceBoardRevision(args, frozen);
  if (args.mode === 'context') {
    if (frozen) {
      return requireReadBudget({ boardId: args.boardId, ...frozenContext(frozen) }, overviewBytes);
    }

    const live =
      args.viewId && revision === undefined
        ? await readActivePanelView(options, args.boardId, args.viewId, signal)
        : undefined;

    if (!live) {
      throw new ArtifactReadFailure(
        'LIVE_CONTEXT_REQUIRED',
        '该白板视图已关闭、过期或尚未同步，请使用当前 Codex 面板显示的 viewId。',
      );
    }

    return live;
  }

  const snapshot = await data.scene(revision);
  switch (args.mode) {
    case 'objects':
    case 'units':
      return readObjects(data, snapshot, args);
    case 'blocks':
    case 'tasks':
    case 'source':
      return readContent(data, snapshot, args, frozen);
    case 'summary':
    case 'search':
    case 'region':
      return readDiscovery(data, snapshot, args);
  }
}

export function registerArtifactRead(
  server: McpServer,
  options: ModelToolOptions,
  lookupReceipt?: AgentReceiptLookup,
) {
  server.registerTool(
    'artifact_read',
    {
      title: '按精确范围读取白板',
      description:
        '按明确的白板、对象、修订或备注引用读取编辑所需内容。summary、search 和 region 用于定位。objects、units、blocks、tasks 和 source 读取保存数据。history 和 diff 核对修订。operation-receipt 核对同一连接的原写入。使用 nextCursor 继续同一范围，按顺序拼接源码片段。',
      inputSchema: artifactReadSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        const args = readArguments(input);
        const data = await withAgentRead(
          options,
          args.boardId,
          () => readArtifact(options, args, signal, lookupReceipt),
          signal,
        );

        return { content: [], structuredContent: { ok: true, data } };
      } catch (error) {
        if (error instanceof ArtifactReadFailure) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error.message }],
            structuredContent: { ok: false, error: { code: error.code, message: error.message } },
          };
        }

        return modelToolFailure(error, options.onError);
      }
    },
  );
}
