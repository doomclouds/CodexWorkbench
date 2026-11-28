import {
  BoardCatalogService,
  BoardLifecycleAction,
  CatalogRejectionReason,
  type BoardSummary,
  type CatalogCommandReceipt,
  type ManageBoardRequest,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { fromBinary } from '@bufbuild/protobuf';
import {
  ArchiveImportRejectionReason,
  BoardArchiveService,
  BoardAssetRejection,
  ImportBoardArchiveResponseSchema,
  type ArchiveImportReceipt,
  type BoardAssetReference,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeError, invalidArgument, tooLarge } from './errors.js';
import {
  callModelRpc,
  modelToolFailure,
  readModelBytes,
  type ModelToolOptions,
} from './model-tool.js';
import { archiveMediaType, protobufMediaType } from './operations.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const version = z.union([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^(?:0|[1-9]\d{0,19})$/u),
]);
const inputSchema = z.strictObject({
  action: z.enum([
    'create',
    'duplicate',
    'rename',
    'pin',
    'trash',
    'restore',
    'purge',
    'receipt',
    'import',
    'asset-import',
    'asset-list',
    'asset-delete',
  ]),
  artifactId: id.optional(),
  boardId: id.optional(),
  artifactIds: z.array(id).min(1).max(100).optional(),
  type: z.literal('whiteboard').optional(),
  title: z.string().trim().max(200).optional(),
  pinned: z.boolean().optional(),
  commandId: id.optional().describe('稳定命令 ID。写入和 receipt 查询使用同一个 ID。'),
  operationId: id.optional().describe('commandId 的初代别名。'),
  expectedEntryVersion: version.optional().describe('目标目录项的 entryVersion。'),
  entryVersion: version.optional(),
  expectedEntryVersions: z
    .record(id, version)
    .optional()
    .describe('批量 purge 的各目标目录项版本。'),
  archivePath: z.string().max(4096).optional(),
  receiptKind: z.enum(['catalog', 'archive']).optional(),
  assetPath: z.string().max(4096).optional(),
  assetId: id.optional(),
  assetCursor: id.optional(),
  assetLimit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof inputSchema>;
type Action = Input['action'];
type ToolFrame = Readonly<Record<string, unknown>>;
type Outcome = CatalogCommandReceipt['outcome'];
type ManagementOperation = ManageBoardRequest['operation'];

const routes = BoardCatalogService.method;
const maximumCatalogResponse = 128 * 1024;
const maximumArchiveBytes = 128 * 1024 * 1024;
const maximumAssetBytes = 20 * 1024 * 1024;
const archiveImportRoute = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
const maximumEntryVersion = 18_446_744_073_709_551_615n;
const rejectionMessages = new Map<CatalogRejectionReason, readonly [string, string]>([
  [CatalogRejectionReason.INVALID_TITLE, ['INVALID_TITLE', '白板标题无效，请输入有效标题。']],
  [CatalogRejectionReason.COMMAND_ID_REUSE, ['COMMAND_ID_REUSE', '此命令 ID 已用于其他操作。']],
  [CatalogRejectionReason.FORBIDDEN, ['FORBIDDEN', '当前身份无权管理该白板。']],
  [
    CatalogRejectionReason.ENTRY_VERSION_CHANGED,
    ['ENTRY_VERSION_CHANGED', '目录项已更新，请先重新读取。'],
  ],
  [CatalogRejectionReason.STATE_CHANGED, ['STATE_CHANGED', '白板的活跃或回收状态已变化。']],
  [CatalogRejectionReason.INVALID_COMMAND, ['INVALID_ARGUMENT', '管理命令无效。']],
]);
const commandFields = ['commandId', 'operationId'];
const targetFields = ['boardId', 'artifactId'];
const versionFields = ['expectedEntryVersion', 'entryVersion'];
const managementFields = [...commandFields, ...targetFields, ...versionFields];
const permittedFields: Readonly<Record<Action, readonly string[]>> = {
  create: [...commandFields, 'title', 'type'],
  duplicate: [...commandFields, ...targetFields, 'title', 'type'],
  rename: [...managementFields, 'title'],
  pin: [...managementFields, 'pinned'],
  trash: managementFields,
  restore: managementFields,
  purge: [...managementFields, 'artifactIds', 'expectedEntryVersions'],
  receipt: [...commandFields, 'receiptKind'],
  import: [...commandFields, 'archivePath', 'title'],
  'asset-import': [...commandFields, ...targetFields, 'assetPath'],
  'asset-list': [...targetFields, 'assetCursor', 'assetLimit'],
  'asset-delete': [...targetFields, 'assetId'],
};

function validateFields(input: Input) {
  const allowed = permittedFields[input.action];
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'action' && value !== undefined && !allowed.includes(key)) {
      throw invalidArgument('当前管理操作不接受 ' + key + '。');
    }
  }
}

function requireAlias(first: string | undefined, second: string | undefined, label: string) {
  if (first && second && first !== second) {
    throw invalidArgument(label + '的两个参数不一致。');
  }

  const value = first ?? second;
  if (!value) {
    throw invalidArgument('请提供' + label + '。');
  }

  return value;
}

function requireVersion(value: z.infer<typeof version> | undefined) {
  if (value === undefined) {
    throw invalidArgument('请先从 artifact_list 或上一条回执读取目标 entryVersion。');
  }

  const checked = BigInt(value);
  if (checked > maximumEntryVersion) {
    throw invalidArgument('entryVersion 超出可用范围。');
  }

  return checked;
}

function targetVersion(input: Input) {
  const first = input.expectedEntryVersion;
  const second = input.entryVersion;
  const value = requireVersion(first ?? second);
  if (second !== undefined && value !== requireVersion(second)) {
    throw invalidArgument('expectedEntryVersion 与 entryVersion 不一致。');
  }

  return value;
}

function purgeTargets(input: Input) {
  const batch = input.artifactIds;
  if (!batch) {
    if (input.expectedEntryVersions) {
      throw invalidArgument('expectedEntryVersions 仅用于 artifactIds 批量永久删除。');
    }

    return [
      {
        boardId: requireAlias(input.boardId, input.artifactId, '目标白板 ID'),
        expectedEntryVersion: targetVersion(input),
      },
    ];
  }
  const singleBoard = input.artifactId !== undefined || input.boardId !== undefined;
  const singleVersion =
    input.expectedEntryVersion !== undefined || input.entryVersion !== undefined;

  if (singleBoard || singleVersion) {
    throw invalidArgument('单个白板和批量 artifactIds 二选一。');
  }

  const ids = new Set(batch);
  if (ids.size !== batch.length) {
    throw invalidArgument('批量永久删除的白板 ID 不能重复。');
  }

  const versions = input.expectedEntryVersions;
  if (!versions || Object.keys(versions).some((boardId) => !ids.has(boardId))) {
    throw invalidArgument('请在 expectedEntryVersions 提供各目标目录项版本。');
  }

  return batch.map((boardId) => ({
    boardId,
    expectedEntryVersion: requireVersion(
      Object.hasOwn(versions, boardId) ? versions[boardId] : undefined,
    ),
  }));
}

function operation(input: Input): ManagementOperation {
  switch (input.action) {
    case 'rename':
      if (!input.title) {
        throw invalidArgument('重命名需要非空白板标题。');
      }

      return { case: 'title', value: input.title };
    case 'pin':
      if (input.pinned === undefined) {
        throw invalidArgument('请明确 pinned 为 true 或 false。');
      }

      return { case: 'pinned', value: input.pinned };
    case 'trash':
      return { case: 'lifecycle', value: BoardLifecycleAction.TRASH };
    case 'restore':
      return { case: 'lifecycle', value: BoardLifecycleAction.RESTORE };
    case 'create':
    case 'duplicate':
    case 'purge':
    case 'receipt':
    case 'import':
    case 'asset-import':
    case 'asset-list':
    case 'asset-delete':
      throw invalidArgument('请选择可用的目录项更新操作。');
  }
}

function success(data: ToolFrame) {
  return { content: [], structuredContent: { ok: true, data } };
}

function failure(code: string, message: string, data?: ToolFrame) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
    structuredContent: { ok: false, error: { code, message }, data },
  };
}

function issue(reason: CatalogRejectionReason) {
  const [code, message] = rejectionMessages.get(reason) ?? ['REJECTED', '目录服务拒绝了管理操作。'];

  return { code, message };
}

function artifact(board: BoardSummary) {
  return {
    id: board.boardId,
    boardId: board.boardId,
    type: 'whiteboard',
    title: board.title,
    pinned: board.pinned,
    entryVersion: board.entryVersion?.toString(),
    updatedAtMillis: board.updatedAtMillis?.toString(),
    canManage: board.canManage,
  };
}

function purged(outcome: Extract<Outcome, { case: 'purged' }>, commandId: string) {
  const deletedIds: string[] = [];
  const failures: ToolFrame[] = [];
  for (const item of outcome.value.items) {
    if (item.outcome.case === 'deleted' && item.outcome.value) {
      deletedIds.push(item.boardId);
    }
    if (item.outcome.case === 'rejected') {
      failures.push({ artifactId: item.boardId, ...issue(item.outcome.value.reason) });
    }
  }

  return success({ commandId, status: 'purged', deletedIds, failures });
}

function reply(value: CatalogCommandReceipt | undefined, commandId: string) {
  if (!value || value.commandId !== commandId) {
    return failure('COMMIT_RESULT_UNKNOWN', '未确认命令回执，请使用同一命令 ID 查询 receipt。', {
      commandId,
    });
  }

  const outcome = value.outcome;
  switch (outcome.case) {
    case 'created':
    case 'changed':
      return success({ commandId, status: outcome.case, artifact: artifact(outcome.value) });
    case 'rejected': {
      const reason = issue(outcome.value.reason);

      return failure(reason.code, reason.message, { commandId, status: 'rejected' });
    }
    case 'purged':
      return purged(outcome, commandId);
    case undefined:
      return failure('COMMIT_RESULT_UNKNOWN', '回执未包含结果，请使用同一命令 ID 查询 receipt。', {
        commandId,
      });
  }
}

async function readReceipt(options: ModelToolOptions, commandId: string, signal: AbortSignal) {
  const { result } = await callModelRpc(
    options,
    routes.getCatalogCommandReceipt,
    { commandId },
    signal,
    maximumCatalogResponse,
  );

  if (result.case === 'notRecorded' && result.value.commandId === commandId) {
    return success({ commandId, status: 'not_recorded' });
  }

  return reply(result.case === 'receipt' ? result.value : undefined, commandId);
}

const archiveIssues = new Map<ArchiveImportRejectionReason, readonly [string, string]>([
  [ArchiveImportRejectionReason.INVALID_ARCHIVE, ['INVALID_ARCHIVE', '无法读取此白板备份。']],
  [
    ArchiveImportRejectionReason.UNSUPPORTED_VERSION,
    ['UNSUPPORTED_VERSION', '此备份的版本暂不受支持。'],
  ],
  [
    ArchiveImportRejectionReason.INCOMPATIBLE_CONTENT,
    ['INCOMPATIBLE_CONTENT', '备份包含不兼容的内容。'],
  ],
  [
    ArchiveImportRejectionReason.COMMAND_ID_REUSE,
    ['COMMAND_ID_REUSE', '此命令 ID 已用于其他操作。'],
  ],
]);

function archiveReply(value: ArchiveImportReceipt | undefined, commandId: string) {
  const detail = { commandId, receiptKind: 'archive' };
  if (!value || value.commandId !== commandId) {
    return failure(
      'COMMIT_RESULT_UNKNOWN',
      '未确认导入回执，请查询 archive 类型的 receipt。',
      detail,
    );
  }

  const outcome = value.outcome;
  switch (outcome.case) {
    case 'imported':
      return success({
        ...detail,
        status: 'imported',
        artifact: {
          id: outcome.value.boardId,
          boardId: outcome.value.boardId,
          type: 'whiteboard',
          title: outcome.value.title,
        },
      });
    case 'rejected': {
      const [code, message] = archiveIssues.get(outcome.value.reason) ?? [
        'REJECTED',
        '导入服务拒绝此备份。',
      ];

      return failure(code, message, { ...detail, status: 'rejected' });
    }
    case undefined:
      return failure(
        'COMMIT_RESULT_UNKNOWN',
        '回执未包含导入结果，请查询 archive 类型的 receipt。',
        detail,
      );
  }
}

async function readArchiveReceipt(
  options: ModelToolOptions,
  commandId: string,
  signal: AbortSignal,
) {
  const { result } = await callModelRpc(
    options,
    BoardArchiveService.method.getArchiveImportReceipt,
    { commandId },
    signal,
    maximumCatalogResponse,
  );

  if (result.case === 'notRecorded' && result.value.commandId === commandId) {
    return success({ commandId, receiptKind: 'archive', status: 'not_recorded' });
  }

  return archiveReply(result.case === 'receipt' ? result.value : undefined, commandId);
}

async function decodeArchiveReply(response: Response) {
  const bytes = await readModelBytes(response, maximumCatalogResponse);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== protobufMediaType) {
    throw new BridgeError('UNAVAILABLE', '无法确认本机备份导入结果。');
  }

  return fromBinary(ImportBoardArchiveResponseSchema, bytes, { readUnknownFields: false });
}

function writeFailure(
  error: unknown,
  options: ModelToolOptions,
  commandId: string,
  receiptKind: 'catalog' | 'archive' | 'asset',
) {
  const result = modelToolFailure(error, options.onError);
  if (result.structuredContent.error.code === 'UNAVAILABLE') {
    if (receiptKind === 'asset') {
      return failure(
        'COMMIT_RESULT_UNKNOWN',
        '导入结果未确认。请用同一命令 ID 与原始文件重试，或查询资产列表。',
        {
          commandId,
          action: 'asset-import',
        },
      );
    }

    return failure('COMMIT_RESULT_UNKNOWN', '命令结果未确认。请使用同一命令 ID 查询回执。', {
      commandId,
      receiptKind,
    });
  }

  return result;
}

async function importArchive(
  options: ModelToolOptions,
  input: Input,
  commandId: string,
  signal: AbortSignal,
) {
  if (!options.readArchiveFile) {
    return failure('UNSUPPORTED', '当前模型入口没有本机备份读取权限。可通过工作台导入备份。');
  }
  if (!input.archivePath?.trim()) {
    throw invalidArgument('请提供用户指定的本机备份文件路径。');
  }
  if (input.title) {
    throw invalidArgument('导入保留备份标题。可在导入后重命名。');
  }

  const body = await options.readArchiveFile(input.archivePath, signal);
  if (body.byteLength === 0) {
    throw invalidArgument('备份文件为空。');
  }
  if (body.byteLength > maximumArchiveBytes) {
    throw tooLarge('白板备份超过 128 MiB。');
  }

  signal.throwIfAborted();
  try {
    const response = await options.dispatch(
      {
        route: archiveImportRoute,
        method: 'POST',
        mediaType: archiveMediaType,
        commandId,
        body,
      },
      signal,
    );
    const { receipt } = await decodeArchiveReply(response);

    return archiveReply(receipt, commandId);
  } catch (error) {
    return writeFailure(error, options, commandId, 'archive');
  }
}

const assetIssues = new Map<BoardAssetRejection, readonly [string, string]>([
  [BoardAssetRejection.INVALID_MEDIA, ['INVALID_MEDIA', '仅支持可用的白板图片与视频文件。']],
  [BoardAssetRejection.TOO_LARGE, ['TOO_LARGE', '白板媒体超过 20 MiB。']],
  [BoardAssetRejection.COMMAND_ID_REUSE, ['COMMAND_ID_REUSE', '此命令 ID 已用于其他媒体内容。']],
  [BoardAssetRejection.NOT_FOUND, ['NOT_FOUND', '该白板资源不存在或已移除。']],
  [BoardAssetRejection.REFERENCE_IN_USE, ['REFERENCE_IN_USE', '此资源仍被白板或历史内容引用。']],
]);

function assetRejection(boardId: string, reason: BoardAssetRejection, commandId?: string) {
  const [code, message] = assetIssues.get(reason) ?? ['REJECTED', '服务拒绝资源操作。'];

  return failure(code, message, { boardId, commandId });
}

function assetReference({ assetId, src, mediaType, byteLength }: BoardAssetReference) {
  return { assetId, src, mediaType, byteLength };
}

async function importAsset(
  options: ModelToolOptions,
  input: Input,
  boardId: string,
  signal: AbortSignal,
) {
  if (!options.readAssetFile) {
    return failure('UNSUPPORTED', '当前模型入口没有本机媒体文件读取能力。可在白板中附加媒体。');
  }
  if (!input.assetPath?.trim()) {
    throw invalidArgument('请提供用户指定的本机媒体文件路径。');
  }

  const commandId = requireAlias(input.commandId, input.operationId, '稳定命令 ID');
  const content = await options.readAssetFile(input.assetPath, signal);
  if (!content.byteLength) {
    throw invalidArgument('媒体文件为空。');
  }
  if (content.byteLength > maximumAssetBytes) {
    throw tooLarge('白板媒体超过 20 MiB。');
  }

  try {
    const { result } = await callModelRpc(
      options,
      BoardArchiveService.method.importBoardAsset,
      { boardId, commandId, content },
      signal,
      maximumCatalogResponse,
    );

    if (result.case === 'asset') {
      return success({
        boardId,
        commandId,
        status: 'imported',
        asset: assetReference(result.value),
      });
    }
    if (result.case === 'rejected') {
      return assetRejection(boardId, result.value, commandId);
    }

    return failure('COMMIT_RESULT_UNKNOWN', '导入结果不明。请保留同一命令 ID 与原文件重试。', {
      boardId,
      commandId,
    });
  } catch (error) {
    return writeFailure(error, options, commandId, 'asset');
  }
}

function assetDeleteUnknown(boardId: string, assetId: string) {
  return failure('COMMIT_RESULT_UNKNOWN', '无法确认移除结果。请查询资产列表或按原 assetId 重试。', {
    boardId,
    assetId,
  });
}

async function deleteAsset(
  options: ModelToolOptions,
  boardId: string,
  assetId: string,
  signal: AbortSignal,
) {
  try {
    const { result } = await callModelRpc(
      options,
      BoardArchiveService.method.deleteBoardAsset,
      { boardId, assetId },
      signal,
      maximumCatalogResponse,
    );

    if (result.case === 'removed' && result.value === assetId) {
      return success({ boardId, assetId, status: 'removed' });
    }
    if (result.case === 'rejected') {
      return assetRejection(boardId, result.value);
    }

    return assetDeleteUnknown(boardId, assetId);
  } catch (error) {
    const result = modelToolFailure(error, options.onError);

    return result.structuredContent.error.code === 'UNAVAILABLE'
      ? assetDeleteUnknown(boardId, assetId)
      : result;
  }
}

async function manageAsset(options: ModelToolOptions, input: Input, signal: AbortSignal) {
  const boardId = requireAlias(input.boardId, input.artifactId, '目标白板 ID');
  if (input.action === 'asset-import') {
    return importAsset(options, input, boardId, signal);
  }

  if (input.action === 'asset-list') {
    const { assets, nextCursor } = await callModelRpc(
      options,
      BoardArchiveService.method.listBoardAssets,
      { boardId, cursor: input.assetCursor, limit: input.assetLimit },
      signal,
      maximumCatalogResponse,
    );

    return success({ boardId, assets: assets.map(assetReference), nextCursor });
  }
  if (!input.assetId) {
    throw invalidArgument('请提供资产列表中的 assetId。');
  }

  return deleteAsset(options, boardId, input.assetId, signal);
}

async function catalogueWrite(
  options: ModelToolOptions,
  input: Input,
  commandId: string,
  signal: AbortSignal,
) {
  if (input.action === 'create') {
    return callModelRpc(
      options,
      routes.createBoard,
      { commandId, title: input.title ?? '' },
      signal,
      maximumCatalogResponse,
    );
  }
  if (input.action === 'purge') {
    return callModelRpc(
      options,
      routes.purgeBoards,
      { commandId, targets: purgeTargets(input) },
      signal,
      maximumCatalogResponse,
    );
  }

  const boardId = requireAlias(input.boardId, input.artifactId, '目标白板 ID');
  if (input.action === 'duplicate') {
    if (input.title) {
      throw invalidArgument('副本由目录生成标题。复制后可用返回的 entryVersion 重命名。');
    }

    return callModelRpc(
      options,
      routes.duplicateBoard,
      { commandId, sourceBoardId: boardId },
      signal,
      maximumCatalogResponse,
    );
  }
  const request = {
    commandId,
    boardId,
    expectedEntryVersion: targetVersion(input),
    operation: operation(input),
  };

  return callModelRpc(options, routes.manageBoard, request, signal, maximumCatalogResponse);
}

async function manageArtifact(options: ModelToolOptions, input: Input, signal: AbortSignal) {
  validateFields(input);
  if (
    input.action === 'asset-import' ||
    input.action === 'asset-delete' ||
    input.action === 'asset-list'
  ) {
    return manageAsset(options, input, signal);
  }

  const commandId = requireAlias(input.commandId, input.operationId, '稳定命令 ID');
  if (input.action === 'receipt') {
    return input.receiptKind === 'archive'
      ? readArchiveReceipt(options, commandId, signal)
      : readReceipt(options, commandId, signal);
  }
  if (input.action === 'import') {
    return importArchive(options, input, commandId, signal);
  }

  try {
    const { receipt } = await catalogueWrite(options, input, commandId, signal);

    return reply(receipt, commandId);
  } catch (error) {
    return writeFailure(error, options, commandId, 'catalog');
  }
}

export function registerArtifactManageTool(server: McpServer, options: ModelToolOptions) {
  server.registerTool(
    'artifact_manage',
    {
      title: '管理白板及回收站',
      description:
        '管理白板与回收站，导入用户指定的本机备份 ZIP，或导入、列出、移除白板资源。目录项修改使用 artifact_list 或回执中的 entryVersion，批量删除需给每个回收站目标的版本。目录项写入和导入需指定稳定的 commandId，可查询 receipt；备份导入回执指定 receiptKind=archive。媒体导入按原 commandId 和文件重试，移除按 assetId 重试。',
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        return await manageArtifact(options, input, signal);
      } catch (error) {
        return modelToolFailure(error, options.onError);
      }
    },
  );
}
