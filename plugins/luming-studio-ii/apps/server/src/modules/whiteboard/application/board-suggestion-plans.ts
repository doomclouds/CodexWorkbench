import {
  type BoardChanges,
  type BoardEditDecision,
  type BoardHeader,
  type BoardSuggestion,
  type BoardSuggestionChoice,
  type BoardSuggestionOperation,
  type BoardSuggestionOptionDraft,
  type BoardSuggestionOptionRecord,
  type DecodeBoardSuggestionEdit,
  type GeometryOperation,
  type StoredBoardSuggestion,
} from '../domain/index.js';
import type { BoardEditPlanningReader, BoardSuggestionReader } from '../ports/index.js';
import { planContentEdit } from './edit-content.js';
import { planGeometryEdit } from './edit-geometry.js';

export class BoardSuggestionError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'BoardSuggestionError';
  }
}

export const proposalLifetimeMillis = 30n * 60_000n;
export const suggestionIdentifier = /^[A-Za-z0-9_-]{1,128}$/u;
const maximumProposalBytes = 256 * 1024;

function validOption(option: BoardSuggestionOptionDraft): boolean {
  const labelLength = option.label.trim().length;
  const descriptionLength = option.description?.trim().length ?? 0;

  return (
    suggestionIdentifier.test(option.optionId) &&
    labelLength > 0 &&
    labelLength <= 80 &&
    descriptionLength <= 500
  );
}

export function normalizeOptions(
  options: readonly BoardSuggestionOptionDraft[],
): readonly BoardSuggestionOptionDraft[] {
  if (options.length < 2 || options.length > 4 || !options.every(validOption)) {
    throw new BoardSuggestionError(400, '请选择两至四条有效方案。');
  }

  const bytes = options.reduce((total, option) => total + option.edit.bytes.byteLength, 0);
  if (bytes > maximumProposalBytes) {
    throw new BoardSuggestionError(400, '建议内容过大。');
  }

  const ids = new Set(options.map(({ optionId }) => optionId));
  const labels = new Set(options.map(({ label }) => label.trim()));
  const edits = new Set(options.map(({ editFingerprint }) => editFingerprint));
  if ([ids, labels, edits].some((set) => set.size !== options.length)) {
    throw new BoardSuggestionError(400, '建议方案的标识、名称及操作需要互不相同。');
  }

  return options.map((option) => ({
    ...option,
    label: option.label.trim(),
    description: option.description?.trim(),
  }));
}

function geometryTargets(operation: GeometryOperation): readonly string[] {
  switch (operation.kind) {
    case 'create':
      return [];
    case 'transform':
      return operation.objects.map(({ target }) => target.objectId);
    case 'duplicate':
      return operation.targets.map(({ source }) => source.objectId);
    case 'lock':
    case 'delete':
    case 'reorder':
      return operation.targets.map(({ objectId }) => objectId);
  }
}

export function operationFitsSource(
  request: BoardSuggestionOperation,
  sourceIds: ReadonlySet<string>,
): boolean {
  if (request.kind === 'content') {
    return sourceIds.has(request.operation.objectId);
  }

  return geometryTargets(request.operation).every((id) => sourceIds.has(id));
}

export function planSuggestion(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  request: BoardSuggestionOperation,
): BoardEditDecision {
  return request.kind === 'geometry'
    ? planGeometryEdit(reader, board, request.operation)
    : planContentEdit(reader, board, request.operation);
}

function changesFitSource(changes: BoardChanges, sourceIds: ReadonlySet<string>): boolean {
  const writtenIds = [
    ...(changes.objects?.map(({ objectId }) => objectId) ?? []),
    ...(changes.removedObjectIds ?? []),
    ...(changes.payloads?.map(({ objectId }) => objectId) ?? []),
    ...(changes.removedPayloadObjectIds ?? []),
    ...(changes.layerPlacement?.objectIds ?? []),
  ];

  return writtenIds.every((id) => sourceIds.has(id));
}

function planScopedSuggestion(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  request: BoardSuggestionOperation,
  sourceIds: ReadonlySet<string>,
): BoardEditDecision {
  if (!operationFitsSource(request, sourceIds)) {
    return { kind: 'rejected', reason: 'forbidden' };
  }

  const decision = planSuggestion(reader, board, request);
  if (decision.kind === 'changes' && !changesFitSource(decision, sourceIds)) {
    return { kind: 'rejected', reason: 'forbidden' };
  }

  return decision;
}

export function changeFingerprint(changes: BoardChanges, digest: (input: string) => string) {
  return digest(
    JSON.stringify(changes, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}

export function reviewChoice(
  reader: BoardSuggestionReader,
  board: BoardHeader,
  proposal: StoredBoardSuggestion | undefined,
  choice: BoardSuggestionChoice,
  decodeEdit: DecodeBoardSuggestionEdit,
  now: bigint,
  digest: (input: string) => string,
): BoardEditDecision {
  const option = proposal?.options.find(({ optionId }) => optionId === choice.optionId);
  if (!proposal || !option || proposal.expiresAtMillis <= now) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (proposal.proposalVersion !== choice.expectedProposalVersion) {
    return { kind: 'conflict', boardRevision: board.revision };
  }
  if (proposal.rejected || proposal.acceptedOptionId) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const source = reader.getReviewSource(board.boardId, proposal.sourceId);
  if (!source) {
    return { kind: 'rejected', reason: 'forbidden' };
  }

  const plan = planScopedSuggestion(
    reader,
    board,
    decodeEdit(option.edit),
    new Set(source.objectIds),
  );

  if (plan.kind === 'changes' && changeFingerprint(plan, digest) !== option.plannedFingerprint) {
    return { kind: 'conflict', boardRevision: board.revision };
  }

  return plan;
}

export function publicSuggestion(proposal: StoredBoardSuggestion): BoardSuggestion {
  const { proposalId, sourceId, observation, proposalVersion, expiresAtMillis } = proposal;
  const { acceptedOptionId, acceptedBoardRevision, rejected } = proposal;

  return {
    proposalId,
    sourceId,
    observation,
    proposalVersion,
    expiresAtMillis,
    options: proposal.options.map(({ optionId, label, description }) => ({
      optionId,
      label,
      description,
    })),
    acceptedOptionId,
    acceptedBoardRevision,
    rejected,
  };
}

export function firstSubmission(proposal: StoredBoardSuggestion): BoardSuggestion {
  return {
    ...publicSuggestion(proposal),
    proposalVersion: 0n,
    acceptedOptionId: undefined,
    acceptedBoardRevision: undefined,
    rejected: false,
  };
}

export function planDraftOptions(
  reader: BoardSuggestionReader,
  board: BoardHeader,
  options: readonly BoardSuggestionOptionDraft[],
  sourceIds: ReadonlySet<string>,
  decodeEdit: DecodeBoardSuggestionEdit,
  digest: (input: string) => string,
): readonly BoardSuggestionOptionRecord[] {
  return options.map((option) => {
    const operation = decodeEdit(option.edit);
    const decision = planScopedSuggestion(reader, board, operation, sourceIds);
    if (decision.kind === 'rejected' && decision.reason === 'forbidden') {
      throw new BoardSuggestionError(403, '建议操作超出已附加的白板对象。');
    }
    if (decision.kind !== 'changes') {
      throw new BoardSuggestionError(409, '建议方案的目标、基线或权限已变化。');
    }

    return { ...option, plannedFingerprint: changeFingerprint(decision, digest) };
  });
}
