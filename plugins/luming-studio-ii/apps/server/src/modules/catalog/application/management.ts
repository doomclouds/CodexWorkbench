import { catalogTimestamp, normalizeBoardTitle } from '../domain/index.js';
import type {
  CatalogManagedBoard,
  CatalogManagementReceipt,
  CatalogPurgeItem,
  CatalogRejectedReceipt,
  CatalogRejectionReason,
} from '../domain/index.js';
import type { CatalogRepository, CatalogWriter } from '../ports/index.js';

type BoardOperation =
  | { readonly kind: 'rename'; readonly title: string }
  | { readonly kind: 'pin'; readonly pinned: boolean }
  | { readonly kind: 'trash' }
  | { readonly kind: 'restore' };

export interface BoardTarget {
  readonly boardId: string;
  readonly expectedEntryVersion: bigint;
}

export interface ManageBoardCommand extends BoardTarget {
  readonly commandId: string;
  readonly operation: BoardOperation;
}

export interface PurgeBoardsCommand {
  readonly commandId: string;
  readonly targets: readonly BoardTarget[];
}

const maxPurgeTargets = 100;

function rejection(commandId: string, reason: CatalogRejectionReason): CatalogRejectedReceipt {
  return { kind: 'rejected', commandId, reason };
}

function execute(
  repository: CatalogRepository,
  actorId: string,
  commandId: string,
  signature: string,
  decide: (writer: CatalogWriter) => CatalogManagementReceipt,
): CatalogManagementReceipt {
  return repository.write((writer) => {
    const stored = writer.getReceipt(actorId, commandId);
    if (stored) {
      const { receipt } = stored;

      return stored.signature === signature && receipt.kind !== 'created'
        ? receipt
        : rejection(commandId, 'commandIdReuse');
    }

    const receipt = decide(writer);
    writer.saveManagementReceipt(actorId, signature, receipt);

    return receipt;
  });
}

function validTarget(target: BoardTarget): boolean {
  return target.boardId.trim().length > 0 && target.expectedEntryVersion >= 0n;
}

function targetMismatch(
  managed: CatalogManagedBoard,
  target: BoardTarget,
  requiresTrash: boolean,
): CatalogRejectionReason | undefined {
  const inTrash = managed.trashedAtMillis !== undefined;
  if (inTrash !== requiresTrash) {
    return 'stateChanged';
  }
  if (managed.board.entryVersion !== target.expectedEntryVersion) {
    return 'entryVersionChanged';
  }
}

function titleForChange(operation: BoardOperation, title: string): string | undefined {
  if (operation.kind !== 'rename') {
    return title;
  }

  const requested = operation.title.trim();

  return requested ? normalizeBoardTitle(requested) : undefined;
}

function manage(
  writer: CatalogWriter,
  actorId: string,
  command: ManageBoardCommand,
  now: () => number,
): CatalogManagementReceipt {
  const { boardId, commandId, operation } = command;
  const managed = writer.getManagedBoard(actorId, boardId);
  if (!managed) {
    return rejection(commandId, 'forbidden');
  }

  const mismatch = targetMismatch(managed, command, operation.kind === 'restore');
  if (mismatch) {
    return rejection(commandId, mismatch);
  }

  const title = titleForChange(operation, managed.board.title);
  if (title === undefined) {
    return rejection(commandId, 'invalidTitle');
  }

  const updatedAtMillis = catalogTimestamp(now());
  const board = {
    ...managed.board,
    title,
    updatedAtMillis,
    pinned: operation.kind === 'pin' ? operation.pinned : managed.board.pinned,
    entryVersion: managed.board.entryVersion + 1n,
  };
  const trashedAtMillis = operation.kind === 'trash' ? updatedAtMillis : undefined;
  writer.changeBoard({ board, trashedAtMillis });

  return { kind: 'changed', commandId, board };
}

function manageSignature(command: ManageBoardCommand): string {
  const { operation, boardId, expectedEntryVersion } = command;
  const signature = ['manage', boardId, expectedEntryVersion.toString(), operation.kind];
  if (operation.kind === 'rename') {
    signature.push(operation.title.trim());
  }
  if (operation.kind === 'pin') {
    signature.push(String(operation.pinned));
  }

  return JSON.stringify(signature);
}

export function manageBoard(
  repository: CatalogRepository,
  actorId: string,
  command: ManageBoardCommand,
  now: () => number,
): CatalogManagementReceipt {
  if (!validTarget(command)) {
    return rejection(command.commandId, 'invalidCommand');
  }

  return execute(repository, actorId, command.commandId, manageSignature(command), (writer) =>
    manage(writer, actorId, command, now),
  );
}

function uniqueTargets(targets: readonly BoardTarget[]): readonly BoardTarget[] | undefined {
  if (targets.length === 0 || targets.length > maxPurgeTargets) {
    return undefined;
  }

  const byId = new Map<string, BoardTarget>();
  for (const target of targets) {
    if (!validTarget(target)) {
      return undefined;
    }

    const existing = byId.get(target.boardId);
    if (existing && existing.expectedEntryVersion !== target.expectedEntryVersion) {
      return undefined;
    }

    byId.set(target.boardId, target);
  }

  return [...byId.values()];
}

function purgeOne(writer: CatalogWriter, actorId: string, target: BoardTarget): CatalogPurgeItem {
  const { boardId } = target;
  const managed = writer.getManagedBoard(actorId, boardId);
  if (!managed) {
    return { boardId, deleted: false, reason: 'forbidden' };
  }

  const mismatch = targetMismatch(managed, target, true);
  if (mismatch) {
    return { boardId, deleted: false, reason: mismatch };
  }

  writer.deleteBoard(boardId);

  return { boardId, deleted: true };
}

function purgeSignature(targets: readonly BoardTarget[]): string {
  const entries = targets.map(({ boardId, expectedEntryVersion }) =>
    JSON.stringify([boardId, expectedEntryVersion.toString()]),
  );

  return JSON.stringify(['purge', entries.sort()]);
}

export function purgeBoards(
  repository: CatalogRepository,
  actorId: string,
  command: PurgeBoardsCommand,
): CatalogManagementReceipt {
  const { commandId } = command;
  const targets = uniqueTargets(command.targets);
  if (!targets) {
    return rejection(commandId, 'invalidCommand');
  }

  return execute(repository, actorId, commandId, purgeSignature(targets), (writer) => ({
    kind: 'purged',
    commandId,
    items: targets.map((target) => purgeOne(writer, actorId, target)),
  }));
}
