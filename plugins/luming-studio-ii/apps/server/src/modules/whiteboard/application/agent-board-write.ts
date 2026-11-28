import type {
  BoardEditDecision,
  BoardEditIdentity,
  BoardEditReceipt,
  BoardHeader,
  BoardSuggestionOperation,
} from '../domain/index.js';
import type { BoardEditPlanningReader, BoardEditRepository } from '../ports/index.js';
import {
  agentOwnsChanges,
  agentOwnsTargets,
  agentWorkspacesDisjoint,
  type AgentWriteWorkspace,
} from './agent-board-write-scope.js';
import type { BoardChangePublication } from './board-content-changes.js';
import { createSuggestionOverlay } from './board-suggestion-overlay.js';
import { planSuggestion, scopedOperationTargets } from './board-suggestion-plans.js';
import { checkBoardEditBeforePreparation, runBoardEdit } from './run-board-edit.js';

interface AgentBoardWriteCommand extends BoardEditIdentity {
  readonly agentId: string;
  readonly taskId: string;
  readonly generation: string;
  readonly signature: string;
  readonly operations: readonly BoardSuggestionOperation[];
}

interface AgentBoardWriteOptions {
  readonly now: () => number;
  readonly boardChanges?: BoardChangePublication;
  readonly resolveWorkspaces: (boardId: string, ownerId: string) => readonly AgentWriteWorkspace[];
}

export interface BoardAgentWriteApplication {
  apply(ownerId: string, command: AgentBoardWriteCommand): BoardEditReceipt;
  getReceipt(
    ownerId: string,
    command: Omit<AgentBoardWriteCommand, 'operations'>,
  ): BoardEditReceipt | undefined;
}

export const maximumAgentBoardWriteOperations = 60;

const forbidden = { kind: 'rejected', reason: 'forbidden' } as const;

function targetWorkspace(
  { agentId, taskId, generation }: AgentBoardWriteCommand,
  workspaces: readonly AgentWriteWorkspace[],
) {
  return workspaces.find(
    (task) => task.agentId === agentId && task.taskId === taskId && task.generation === generation,
  );
}

function planWrites(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  command: AgentBoardWriteCommand,
  workspaces: readonly AgentWriteWorkspace[],
): BoardEditDecision {
  const target = targetWorkspace(command, workspaces);
  if (!target || !agentWorkspacesDisjoint(reader, board.boardId, target, workspaces)) {
    return forbidden;
  }
  if (!command.operations.length || command.operations.length > maximumAgentBoardWriteOperations) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const { boardId } = board;
  const { scope } = target;
  const staged = createSuggestionOverlay(reader, boardId, true);
  for (const operation of command.operations) {
    const targets = scopedOperationTargets(operation);
    if (!targets || !agentOwnsTargets(staged.reader, boardId, scope, targets)) {
      return forbidden;
    }

    const next = planSuggestion(staged.reader, board, operation);
    if (next.kind !== 'changes') {
      return next;
    }
    if (!agentOwnsChanges(staged.reader, boardId, scope, next)) {
      return forbidden;
    }

    staged.stage(next);
  }

  return agentWorkspacesDisjoint(staged.reader, boardId, target, workspaces)
    ? staged.changes()
    : forbidden;
}

export function createBoardAgentWriteApplication(
  repository: BoardEditRepository,
  { now, resolveWorkspaces, boardChanges }: AgentBoardWriteOptions,
): BoardAgentWriteApplication {
  return {
    getReceipt(ownerId, { boardId, commandId, agentId, signature }) {
      return checkBoardEditBeforePreparation(
        repository,
        { id: agentId },
        { boardId, commandId },
        signature,
        ownerId,
      );
    },
    apply(ownerActorId, command) {
      const { boardId, commandId, agentId, signature } = command;
      const kind = command.operations.some(({ kind }) => kind === 'geometry')
        ? 'geometry'
        : 'content';

      return runBoardEdit(
        repository,
        { id: agentId },
        { boardId, commandId },
        { kind, signature, savedAtMillis: now(), ownerActorId },
        (reader, board) =>
          planWrites(reader, board, command, resolveWorkspaces(boardId, ownerActorId)),
        boardChanges,
      );
    },
  };
}
