import {
  type BoardChanges,
  type BoardEditDecision,
  type BoardHeader,
  type BoardSuggestion,
  type BoardSuggestionOperation,
  type BoardSuggestionOptionDraft,
  type BoardSuggestionOptionRecord,
  type DecodeBoardSuggestionEdit,
  type GeometryOperation,
  type StoredBoardSuggestion,
} from '../domain/index.js';
import type { BoardEditPlanningReader, BoardSuggestionReader } from '../ports/index.js';
import { createSuggestionOverlay } from './board-suggestion-overlay.js';
import { planContentEdit } from './edit-content.js';
import { planGeometryEdit } from './edit-geometry.js';

export type SuggestionChangeGuard = (
  reader: BoardEditPlanningReader,
  changes: BoardChanges,
) => boolean;

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
const maximumOperations = 60;

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

  const operations = options.flatMap(({ edit, additionalEdits }) => [
    edit,
    ...(additionalEdits ?? []),
  ]);
  const bytes = operations.reduce((total, edit) => total + edit.bytes.byteLength, 0);
  if (bytes > maximumProposalBytes) {
    throw new BoardSuggestionError(400, '建议内容过大。');
  }
  if (options.some(({ additionalEdits }) => (additionalEdits?.length ?? 0) >= maximumOperations)) {
    throw new BoardSuggestionError(400, '建议方案的操作过多。');
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
      return operation.attachment ? [operation.attachment.source.objectId] : [];
    case 'paste':
    case 'removeCustomColor':
      return [];
    case 'transform':
      return operation.objects.map(({ target }) => target.objectId);
    case 'duplicate':
      return operation.targets.map(({ source }) => source.objectId);
    case 'style':
      return operation.targets.map(({ target }) => target.objectId);
    case 'lock':
    case 'delete':
    case 'reorder':
    case 'group':
    case 'ungroup':
    case 'arrange':
    case 'createSection':
      return operation.targets.map(({ objectId }) => objectId);
  }
}

export function operationFitsSource(
  request: BoardSuggestionOperation,
  sourceIds: ReadonlySet<string>,
): boolean {
  return scopedOperationTargets(request)?.every((id) => sourceIds.has(id)) === true;
}

export function scopedOperationTargets(
  request: BoardSuggestionOperation,
): readonly string[] | undefined {
  if (request.kind === 'content') {
    return [request.operation.objectId];
  }

  const operation = request.operation;
  const writesPalette =
    operation.kind === 'removeCustomColor' ||
    (operation.kind === 'style' && operation.rememberColor !== undefined);

  if (operation.kind === 'paste' || writesPalette) {
    return undefined;
  }

  return geometryTargets(operation);
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

export function suggestionWrittenIds(changes: BoardChanges): readonly string[] {
  return [
    ...new Set([
      ...(changes.objects?.map(({ objectId }) => objectId) ?? []),
      ...(changes.removedObjectIds ?? []),
      ...(changes.payloads?.map(({ objectId }) => objectId) ?? []),
      ...(changes.removedPayloadObjectIds ?? []),
      ...(changes.layerPlacement?.objectIds ?? []),
    ]),
  ];
}

function changesFitSource(changes: BoardChanges, sourceIds: ReadonlySet<string>): boolean {
  return suggestionWrittenIds(changes).every((id) => sourceIds.has(id));
}

function planScopedSuggestion(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  request: BoardSuggestionOperation,
  sourceIds: ReadonlySet<string>,
  authorizeChanges?: SuggestionChangeGuard,
): BoardEditDecision {
  if (!operationFitsSource(request, sourceIds)) {
    return { kind: 'rejected', reason: 'forbidden' };
  }

  const decision = planSuggestion(reader, board, request);
  if (decision.kind !== 'changes') {
    return decision;
  }

  const withinSource = changesFitSource(decision, sourceIds);
  const authorized = authorizeChanges?.(reader, decision);
  if (!withinSource || authorized === false) {
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

export function planSuggestionOption(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  option: BoardSuggestionOptionDraft,
  sourceIds: ReadonlySet<string>,
  decodeEdit: DecodeBoardSuggestionEdit,
  authorizeChanges?: SuggestionChangeGuard,
): BoardEditDecision {
  if (!option.additionalEdits?.length) {
    return planScopedSuggestion(
      reader,
      board,
      decodeEdit(option.edit),
      sourceIds,
      authorizeChanges,
    );
  }

  const staged = createSuggestionOverlay(reader, board.boardId, true);
  for (const edit of [option.edit, ...option.additionalEdits]) {
    const decision = planScopedSuggestion(
      staged.reader,
      board,
      decodeEdit(edit),
      sourceIds,
      authorizeChanges,
    );

    if (decision.kind !== 'changes') {
      return decision;
    }

    staged.stage(decision);
  }

  return staged.changes();
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
    activeOptionIds:
      proposal.reviewState?.applications.map(({ optionId }) => optionId) ??
      (acceptedOptionId ? [acceptedOptionId] : []),
  };
}

export function firstSubmission(proposal: StoredBoardSuggestion): BoardSuggestion {
  return {
    ...publicSuggestion(proposal),
    proposalVersion: 0n,
    acceptedOptionId: undefined,
    acceptedBoardRevision: undefined,
    rejected: false,
    activeOptionIds: [],
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
    const decision = planSuggestionOption(reader, board, option, sourceIds, decodeEdit);
    if (decision.kind === 'rejected' && decision.reason === 'forbidden') {
      throw new BoardSuggestionError(403, '建议操作超出已附加的白板对象。');
    }
    if (decision.kind !== 'changes') {
      throw new BoardSuggestionError(409, '建议方案的目标、基线或权限已变化。');
    }

    return {
      ...option,
      plannedFingerprint: changeFingerprint(decision, digest),
      footprint: {
        objectIds: suggestionWrittenIds(decision),
        editsOrder: !!decision.order || !!decision.removedObjectIds?.length,
      },
    };
  });
}
