import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogManagementReceipt,
  CatalogManagementRejectionReason,
  CatalogManagementService,
  CatalogManageRequest,
} from './contracts.js';

type CatalogLookup = Pick<BoardCatalogService, 'listBoards'>;
type CatalogWriter = Pick<CatalogManagementService, 'manageBoard' | 'getReceipt'>;
type RenameRequest = CatalogManageRequest & {
  readonly operation: { readonly kind: 'rename'; readonly title: string };
};

const untitledBoard = '未命名白板';
const pageSize = 30;
const maximumQueryLength = 200;
const unknownOutcome = '名称保存结果尚未确认，请重试查询。';
const staleEntry = '作品目录已变化，请刷新白板后再试。';
const forbidden = '你没有管理这件作品的权限。';
const renameErrors: Readonly<Record<CatalogManagementRejectionReason, string>> = {
  invalidTitle: '作品名称无效。',
  commandIdReuse: '操作命令 ID 已被另一条命令使用。',
  forbidden,
  entryVersionChanged: staleEntry,
  stateChanged: staleEntry,
  invalidCommand: '名称保存命令无效。',
  unknown: '服务端拒绝了名称保存。',
};

async function findRenameEntry(
  catalog: CatalogLookup,
  boardId: string,
  currentTitle: string,
): Promise<CatalogBoardSummary> {
  const query = currentTitle.trim().slice(0, maximumQueryLength);
  const cursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await catalog.listBoards({ query, order: 'title', pageSize, cursor });
    const board = page.boards.find((entry) => entry.boardId === boardId);
    if (board) {
      if (board.canManage === false) {
        throw new Error(forbidden);
      }
      if (board.title !== currentTitle) {
        throw new Error(staleEntry);
      }

      return board;
    }

    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) {
      break;
    }

    if (cursor) {
      cursors.add(cursor);
    }
  } while (cursor);

  throw new Error(staleEntry);
}

async function recoverReceipt(
  writer: CatalogWriter,
  commandId: string,
  original?: unknown,
): Promise<CatalogManagementReceipt | undefined> {
  try {
    return await writer.getReceipt(commandId);
  } catch (error) {
    const failures = original === undefined ? [error] : [original, error];

    throw new AggregateError(failures, unknownOutcome, { cause: error });
  }
}

async function submitRename(
  writer: CatalogWriter,
  request: RenameRequest,
): Promise<CatalogManagementReceipt> {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await writer.manageBoard(request);
    } catch (error) {
      lastFailure = error;
      const recorded = await recoverReceipt(writer, request.commandId, error);
      if (recorded) {
        return recorded;
      }
    }
  }

  throw new Error(unknownOutcome, { cause: lastFailure });
}

function matchesRename(request: RenameRequest, receipt: CatalogManagementReceipt): boolean {
  if (receipt.commandId !== request.commandId || receipt.kind === 'purged') {
    return false;
  }

  return (
    receipt.kind === 'rejected' ||
    (receipt.board.boardId === request.boardId &&
      receipt.board.title === request.operation.title &&
      receipt.board.entryVersion === request.expectedEntryVersion + 1n)
  );
}

export function createCatalogBoardRename(
  catalog: CatalogLookup,
  writer: CatalogWriter,
  createCommandId: () => string,
) {
  const pending = new Map<string, RenameRequest>();

  return async (boardId: string, currentTitle: string, title: string): Promise<void> => {
    const normalized = title.trim() || untitledBoard;
    const previous = pending.get(boardId);
    if (normalized === currentTitle && !previous) {
      return;
    }

    const resume = previous?.operation.title === normalized;
    const request: RenameRequest = resume
      ? previous
      : {
          boardId,
          commandId: createCommandId(),
          expectedEntryVersion: (await findRenameEntry(catalog, boardId, currentTitle))
            .entryVersion,
          operation: { kind: 'rename', title: normalized },
        };
    pending.set(boardId, request);

    const stored = resume ? await recoverReceipt(writer, request.commandId) : undefined;
    const receipt = stored ?? (await submitRename(writer, request));
    if (!matchesRename(request, receipt)) {
      throw new Error('名称保存回执与当前操作不匹配。');
    }

    if (pending.get(boardId) === request) {
      pending.delete(boardId);
    }
    if (receipt.kind === 'rejected') {
      throw new Error(renameErrors[receipt.reason]);
    }
  };
}
