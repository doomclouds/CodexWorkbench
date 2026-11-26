import type {
  CatalogManagementReceipt,
  CatalogManagementService,
  TrashedBoardSummary,
} from '../../data/catalog/index.js';

export interface RecycleTarget {
  readonly boardId: string;
  readonly expectedEntryVersion: bigint;
  readonly title: string;
}

export interface PurgeScope {
  readonly all: boolean;
  readonly targets: readonly RecycleTarget[];
}

export interface PurgeFailure {
  readonly target: RecycleTarget;
  readonly message: string;
}

type PurgeFeedback = {
  readonly deleted: string[];
  readonly failures: PurgeFailure[];
};

const batchSize = 100;
const uncertainResult = '操作结果待确认，请先刷新回收站核对。';
const rejectionCopy = new Map<string, string>([
  ['stateChanged', '作品已不在回收站。'],
  ['entryVersionChanged', '作品已变化，请刷新回收站后重试。'],
  ['forbidden', '当前账号无权操作此作品。'],
  ['commandIdReuse', '该操作编号已使用，请刷新回收站后重试。'],
]);

export function toRecycleTarget({ board }: TrashedBoardSummary): RecycleTarget {
  return { boardId: board.boardId, expectedEntryVersion: board.entryVersion, title: board.title };
}

export function describePurgeRejection(reason: string) {
  return rejectionCopy.get(reason) ?? '操作未完成，请刷新回收站后重试。';
}

export function describeRecycleError(cause: unknown) {
  return cause instanceof Error ? cause.message : '回收站操作未完成。';
}

export async function recoverRecycleReceipt(
  management: CatalogManagementService,
  commandId: string,
  signal: AbortSignal,
  send: () => Promise<CatalogManagementReceipt>,
): Promise<CatalogManagementReceipt> {
  try {
    return await send();
  } catch (cause) {
    signal.throwIfAborted();

    let receipt: CatalogManagementReceipt | undefined;
    try {
      receipt = await management.getReceipt(commandId, signal);
    } catch (lookupError) {
      throw new AggregateError([cause, lookupError], uncertainResult, { cause: lookupError });
    }

    if (!receipt) {
      throw new Error(uncertainResult, { cause });
    }

    return receipt;
  }
}

export async function collectPurgeScope(management: CatalogManagementService, signal: AbortSignal) {
  const targets = new Map<string, RecycleTarget>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();

    const page = await management.listTrashedBoards(
      { query: '', order: 'recent', pageSize: batchSize, cursor },
      signal,
    );

    for (const item of page.boards) {
      targets.set(item.board.boardId, toRecycleTarget(item));
    }

    cursor = page.nextCursor;
    if (cursor) {
      if (cursors.has(cursor)) {
        throw new Error('回收站分页发生重复，请刷新后重试。');
      }

      cursors.add(cursor);
    }
  } while (cursor);

  return [...targets.values()];
}

function recordBatch(
  feedback: PurgeFeedback,
  targets: readonly RecycleTarget[],
  receipt: CatalogManagementReceipt,
) {
  if (receipt.kind !== 'purged') {
    const message =
      receipt.kind === 'rejected' ? describePurgeRejection(receipt.reason) : uncertainResult;
    feedback.failures.push(...targets.map((target) => ({ target, message })));
    return;
  }

  const items = new Map(receipt.items.map((item) => [item.boardId, item]));
  for (const target of targets) {
    const outcome = items.get(target.boardId);
    if (outcome?.deleted) {
      feedback.deleted.push(target.boardId);
    } else {
      const message = outcome ? describePurgeRejection(outcome.reason) : uncertainResult;
      feedback.failures.push({ target, message });
    }
  }
}

export async function purgeRecycleTargets(
  management: CatalogManagementService,
  targets: readonly RecycleTarget[],
  createCommandId: () => string,
  signal: AbortSignal,
) {
  const feedback: PurgeFeedback = { deleted: [], failures: [] };
  for (let offset = 0; offset < targets.length; offset += batchSize) {
    signal.throwIfAborted();

    const batch = targets.slice(offset, offset + batchSize);
    try {
      const commandId = createCommandId();
      const receipt = await recoverRecycleReceipt(management, commandId, signal, () =>
        management.purgeBoards(
          {
            commandId,
            targets: batch.map(({ boardId, expectedEntryVersion }) => ({
              boardId,
              expectedEntryVersion,
            })),
          },
          signal,
        ),
      );
      recordBatch(feedback, batch, receipt);
    } catch (cause) {
      signal.throwIfAborted();

      const message = describeRecycleError(cause);
      feedback.failures.push(...batch.map((target) => ({ target, message })));
    }
  }

  return feedback;
}
