import type {
  AcceptBoardSuggestion,
  BoardEditIdentity,
  BoardEditReceipt,
  BoardHeader,
  BoardObject,
  BoardReviewActor,
  BoardReviewSource,
  BoardReviewTarget,
  BoardSuggestion,
  BoardSuggestionChoice,
  BoardSuggestionCommandReceipt,
  BoardSuggestionList,
  BoardSuggestionPreview,
  CreateBoardReviewSource,
  DecodeBoardSuggestionEdit,
  RejectBoardSuggestion,
  StoredBoardSuggestion,
  SubmitBoardSuggestion,
} from '../domain/index.js';
import type {
  BoardSuggestionReader,
  BoardSuggestionRepository,
  BoardSuggestionWriter,
} from '../ports/index.js';
import {
  BoardSuggestionError,
  firstSubmission,
  normalizeOptions,
  planDraftOptions,
  proposalLifetimeMillis,
  publicSuggestion,
  suggestionIdentifier,
} from './board-suggestion-plans.js';
import {
  finishSuggestionDecision,
  prepareSuggestionDecision,
  type SuggestionReviewDraft,
} from './board-suggestion-review.js';
import { runBoardEditInTransaction } from './run-board-edit.js';

export { BoardSuggestionError } from './board-suggestion-plans.js';

interface FrozenFeedbackSource {
  readonly capturedBoardRevision: bigint;
  readonly objectId?: string;
}

interface BoardSuggestionDependencies {
  readonly now: () => number;
  readonly newId: () => string;
  readonly digest: (input: string) => string;
  readonly onChanged?: (boardId: string) => void;
  readonly readFeedbackSource?: (
    actor: BoardReviewActor,
    boardId: string,
    feedbackThreadId: string,
  ) => FrozenFeedbackSource | undefined;
}

interface ListBoardSuggestions {
  readonly boardId: string;
  readonly limit: number;
  readonly beforeProposalId?: string;
}

export interface BoardSuggestionApplication {
  createSource(actor: BoardReviewActor, request: CreateBoardReviewSource): BoardReviewSource;
  submit(
    actor: BoardReviewActor,
    request: SubmitBoardSuggestion,
    decodeEdit: DecodeBoardSuggestionEdit,
  ): BoardSuggestion;
  list(actor: BoardReviewActor, request: ListBoardSuggestions): BoardSuggestionList;
  preview(
    actor: BoardReviewActor,
    choice: BoardSuggestionChoice,
    decodeEdit: DecodeBoardSuggestionEdit,
  ): BoardSuggestionPreview;
  accept(
    actor: BoardReviewActor,
    request: AcceptBoardSuggestion,
    decodeEdit: DecodeBoardSuggestionEdit,
  ): BoardEditReceipt;
  reject(actor: BoardReviewActor, request: RejectBoardSuggestion): BoardSuggestion;
}

function requireOwner(
  reader: BoardSuggestionReader,
  actor: BoardReviewActor,
  boardId: string,
  kind: BoardReviewActor['kind'],
): BoardHeader {
  const allowed = actor.kind === kind && reader.canReviewBoard(boardId, actor.id);
  const board = allowed ? reader.getBoard(boardId) : undefined;
  if (!board) {
    throw new BoardSuggestionError(403, '当前身份没有白板审阅权限。');
  }

  return board;
}

function sourceTargets(ids: readonly string[]): readonly string[] {
  const unique = [...new Set(ids)];
  if (
    !unique.length ||
    unique.length > 120 ||
    !unique.every((id) => suggestionIdentifier.test(id))
  ) {
    throw new BoardSuggestionError(400, '请附加有效的白板对象选区。');
  }

  return unique;
}

function commandReplay(
  writer: BoardSuggestionWriter,
  actor: BoardReviewActor,
  request: BoardEditIdentity & { readonly signature: string },
  kind: BoardSuggestionCommandReceipt['kind'],
): string | undefined {
  const { boardId, commandId, signature } = request;
  const stored = writer.getSuggestionReceipt(boardId, actor.id, commandId);
  if (stored && (stored.kind !== kind || stored.signature !== signature)) {
    throw new BoardSuggestionError(409, '同一命令不能提交不同的审阅操作。');
  }

  return stored?.targetId;
}

function preserveReceipt(
  writer: BoardSuggestionWriter,
  actor: BoardReviewActor,
  request: BoardEditIdentity & { readonly signature: string },
  kind: BoardSuggestionCommandReceipt['kind'],
  targetId: string,
): void {
  const { boardId, commandId, signature } = request;
  writer.saveSuggestionReceipt(boardId, actor.id, commandId, { kind, signature, targetId });
}

function attachedFeedback(
  repository: BoardSuggestionRepository,
  actor: BoardReviewActor,
  request: CreateBoardReviewSource,
  readFeedback: BoardSuggestionDependencies['readFeedbackSource'],
): FrozenFeedbackSource | undefined {
  if (request.origin.kind !== 'feedback') {
    return undefined;
  }

  const { origin, boardId } = request;
  const replay = repository.read((reader) => {
    requireOwner(reader, actor, boardId, 'human');

    return reader.getSuggestionReceipt(boardId, actor.id, request.commandId);
  });

  if (replay) {
    return undefined;
  }

  const frozen = readFeedback?.(actor, boardId, origin.threadId);
  if (!frozen) {
    throw new BoardSuggestionError(404, '这条批注已不存在。');
  }

  return frozen;
}

function reviewTarget({
  objectId,
  kind,
  geometryVersion,
  payloadVersion,
  geometry,
}: BoardObject): BoardReviewTarget {
  return { objectId, kind, geometryVersion, payloadVersion, geometry };
}

function captureSource(
  writer: BoardSuggestionWriter,
  board: BoardHeader,
  actor: BoardReviewActor,
  request: CreateBoardReviewSource,
  sourceId: string,
  frozen?: FrozenFeedbackSource,
): BoardReviewSource {
  const { origin, expectedBoardRevision } = request;
  if (expectedBoardRevision !== undefined && expectedBoardRevision !== board.revision) {
    throw new BoardSuggestionError(409, '白板已变化，请重新附加选区。');
  }

  if (origin.kind === 'feedback') {
    if (!frozen) {
      throw new BoardSuggestionError(404, '这条批注已不存在。');
    }

    const objectIds = frozen.objectId ? [frozen.objectId] : [];

    return {
      boardId: board.boardId,
      sourceId,
      ownerActorId: actor.id,
      capturedBoardRevision: frozen.capturedBoardRevision,
      objectIds,
      feedbackThreadId: origin.threadId,
      targets: writer.getObjects(board.boardId, objectIds).map(reviewTarget),
      targetsBoardRevision: board.revision,
    };
  }

  const objectIds = sourceTargets(origin.objectIds);
  const targets = writer.getObjects(board.boardId, objectIds).map(reviewTarget);
  if (targets.length !== objectIds.length) {
    throw new BoardSuggestionError(409, '白板上已有对象变化，请重新框选。');
  }

  return {
    boardId: board.boardId,
    sourceId,
    ownerActorId: actor.id,
    capturedBoardRevision: board.revision,
    objectIds,
    targets,
    targetsBoardRevision: board.revision,
  };
}

function recordedSource(writer: BoardSuggestionWriter, boardId: string, id: string) {
  const source = writer.getReviewSource(boardId, id);
  if (!source) {
    throw new Error('A saved whiteboard source receipt lost its target.');
  }

  return source;
}

function recordedSuggestion(writer: BoardSuggestionWriter, boardId: string, id: string) {
  const proposal = writer.getSuggestion(boardId, id);
  if (!proposal) {
    throw new Error('A saved whiteboard suggestion receipt lost its target.');
  }

  return proposal;
}

function rejectPending(
  writer: BoardSuggestionWriter,
  request: RejectBoardSuggestion,
  now: bigint,
): StoredBoardSuggestion {
  const proposal = writer.getSuggestion(request.boardId, request.proposalId);
  if (!proposal || proposal.expiresAtMillis <= now) {
    throw new BoardSuggestionError(404, '建议不存在或已过期。');
  }
  if (proposal.rejected || proposal.proposalVersion !== request.expectedProposalVersion) {
    throw new BoardSuggestionError(409, '建议状态已变化，请重新查看。');
  }

  return { ...proposal, proposalVersion: proposal.proposalVersion + 1n, rejected: true };
}

function reviewChoice(
  reader: BoardSuggestionReader,
  board: BoardHeader,
  proposed: StoredBoardSuggestion | undefined,
  choice: BoardSuggestionChoice,
  decodeEdit: DecodeBoardSuggestionEdit,
  time: number,
  digest: (input: string) => string,
  applying: boolean,
): ReturnType<typeof prepareSuggestionDecision> {
  if (!proposed || proposed.expiresAtMillis <= BigInt(time)) {
    return { decision: { kind: 'rejected', reason: 'versionUnavailable' } };
  }

  return prepareSuggestionDecision({
    reader,
    board,
    proposal: proposed,
    choice,
    decodeEdit,
    digest,
    applying,
  });
}

function acceptPending(
  writer: BoardSuggestionWriter,
  actor: BoardReviewActor,
  request: AcceptBoardSuggestion,
  decodeEdit: DecodeBoardSuggestionEdit,
  timeMillis: number,
  digest: (input: string) => string,
): { receipt: BoardEditReceipt; changed: boolean } {
  const board = requireOwner(writer, actor, request.boardId, 'human');
  const { boardId, commandId, signature, proposalId, optionId } = request;
  const proposal = writer.getSuggestion(boardId, proposalId);
  const option = proposal?.options.find((entry) => entry.optionId === optionId);
  let review: SuggestionReviewDraft | undefined;
  const edit = runBoardEditInTransaction(
    writer,
    actor,
    { boardId, commandId },
    { signature, savedAtMillis: timeMillis, kind: option?.edit.kind ?? 'geometry' },
    () => {
      const prepared = reviewChoice(
        writer,
        board,
        proposal,
        request,
        decodeEdit,
        timeMillis,
        digest,
        true,
      );
      review = prepared.review;

      return prepared.decision;
    },
  );

  if (review && proposal && edit.outcome.kind === 'applied') {
    const state = finishSuggestionDecision(
      writer,
      boardId,
      edit.outcome.boardRevision,
      review,
      digest,
    );
    const accepted = state.applications.at(-1);
    writer.decideSuggestion({
      ...proposal,
      acceptedOptionId: accepted?.optionId,
      acceptedBoardRevision: accepted?.boardRevision,
      proposalVersion: proposal.proposalVersion + 1n,
      reviewState: state,
    });
  }

  return { receipt: edit, changed: review !== undefined && edit.outcome.kind === 'applied' };
}

export function createBoardSuggestionApplication(
  repository: BoardSuggestionRepository,
  { now, newId, digest, readFeedbackSource, onChanged }: BoardSuggestionDependencies,
): BoardSuggestionApplication {
  return {
    createSource(actor, request) {
      const frozen = attachedFeedback(repository, actor, request, readFeedbackSource);

      return repository.write((writer) => {
        const board = requireOwner(writer, actor, request.boardId, 'human');
        const replay = commandReplay(writer, actor, request, 'source');
        if (replay) {
          return recordedSource(writer, board.boardId, replay);
        }

        const source = captureSource(writer, board, actor, request, newId(), frozen);
        writer.createReviewSource(source);
        preserveReceipt(writer, actor, request, 'source', source.sourceId);

        return source;
      });
    },
    submit(actor, request, decodeEdit) {
      let changed = false;
      const result = repository.write((writer) => {
        const board = requireOwner(writer, actor, request.boardId, 'agent');
        const replay = commandReplay(writer, actor, request, 'submit');
        if (replay) {
          return firstSubmission(recordedSuggestion(writer, board.boardId, replay));
        }

        const source = writer.getReviewSource(board.boardId, request.sourceId);
        if (!source || source.ownerActorId !== actor.id) {
          throw new BoardSuggestionError(403, '缺少与当前白板相符的用户附加来源。');
        }

        const observation = request.observation.trim();
        if (!observation || observation.length > 160) {
          throw new BoardSuggestionError(400, '请简短描述观察到的问题。');
        }

        const options = planDraftOptions(
          writer,
          board,
          normalizeOptions(request.options),
          new Set(source.objectIds),
          decodeEdit,
          digest,
        );
        const createdAtMillis = BigInt(now());
        const proposal: StoredBoardSuggestion = {
          boardId: board.boardId,
          ownerActorId: source.ownerActorId,
          sourceId: source.sourceId,
          proposalId: newId(),
          observation,
          createdAtMillis,
          expiresAtMillis: createdAtMillis + proposalLifetimeMillis,
          proposalVersion: 0n,
          options,
          rejected: false,
        };
        writer.createSuggestion(proposal);
        preserveReceipt(writer, actor, request, 'submit', proposal.proposalId);
        changed = true;

        return publicSuggestion(proposal);
      });

      if (changed) {
        onChanged?.(request.boardId);
      }

      return result;
    },
    list(actor, { boardId, limit, beforeProposalId }) {
      return repository.read((reader) => {
        requireOwner(reader, actor, boardId, 'human');

        const proposals = reader.listSuggestions(
          boardId,
          BigInt(now()),
          limit + 1,
          beforeProposalId,
        );
        const page = proposals.slice(0, limit);

        return {
          proposals: page,
          nextBeforeProposalId: proposals.length > limit ? page.at(-1)?.proposalId : undefined,
        };
      });
    },
    preview(actor, choice, decodeEdit) {
      return repository.read((reader) => {
        const board = requireOwner(reader, actor, choice.boardId, 'human');
        const proposal = reader.getSuggestion(board.boardId, choice.proposalId);

        return {
          boardRevision: board.revision,
          decision: reviewChoice(reader, board, proposal, choice, decodeEdit, now(), digest, false)
            .decision,
        };
      });
    },
    accept(actor, request, decodeEdit) {
      const { receipt, changed } = repository.write((writer) =>
        acceptPending(writer, actor, request, decodeEdit, now(), digest),
      );

      if (changed) {
        onChanged?.(request.boardId);
      }

      return receipt;
    },
    reject(actor, request) {
      let changed = false;
      const result = repository.write((writer) => {
        const board = requireOwner(writer, actor, request.boardId, 'human');
        const replay = commandReplay(writer, actor, request, 'reject');
        if (replay) {
          return publicSuggestion(recordedSuggestion(writer, board.boardId, replay));
        }

        const rejected = rejectPending(writer, request, BigInt(now()));
        writer.decideSuggestion(rejected);
        preserveReceipt(writer, actor, request, 'reject', rejected.proposalId);
        changed = true;

        return publicSuggestion(rejected);
      });

      if (changed) {
        onChanged?.(request.boardId);
      }

      return result;
    },
  };
}
