import {
  canAdvanceVersion,
  type BoardChanges,
  type BoardEditDecision,
  type BoardHeader,
  type BoardObject,
  type BoardSuggestionApplicationState,
  type BoardSuggestionChoice,
  type BoardSuggestionClock,
  type BoardSuggestionFootprint,
  type BoardSuggestionObjectClocks,
  type BoardSuggestionReviewState,
  type DecodeBoardSuggestionEdit,
  type PayloadRecord,
  type StoredBoardSuggestion,
} from '../domain/index.js';
import type { BoardEditPlanningReader, BoardSuggestionReader } from '../ports/index.js';
import { createSuggestionOverlay } from './board-suggestion-overlay.js';
import {
  changeFingerprint,
  planSuggestionOption,
  suggestionWrittenIds,
} from './board-suggestion-plans.js';

type Digest = (input: string) => string;

interface SuggestionApplicationDraft {
  readonly optionId: string;
  readonly baselineBoardRevision: bigint;
  readonly footprint: BoardSuggestionFootprint;
  readonly inverse: BoardChanges;
}

export interface SuggestionReviewDraft {
  readonly previous: BoardSuggestionReviewState;
  readonly reversed: readonly BoardSuggestionApplicationState[];
  readonly application?: SuggestionApplicationDraft;
  readonly restoredObjects: readonly BoardObject[];
  readonly restoredPayloads: readonly PayloadRecord[];
  readonly restoredBoardRevision?: bigint;
}

interface SuggestionDecisionPlan {
  readonly decision: BoardEditDecision;
  readonly review?: SuggestionReviewDraft;
}

const noReview: BoardSuggestionReviewState = { applications: [], objectClocks: [] };
const unavailableVersion: SuggestionDecisionPlan = {
  decision: { kind: 'rejected', reason: 'versionUnavailable' },
};

function lexicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) =>
    typeof child === 'bigint' ? child.toString() : child,
  );
}

export function suggestionFootprint(changes: BoardChanges): BoardSuggestionFootprint {
  const payloadIds = [
    ...(changes.payloads?.map(({ objectId }) => objectId) ?? []),
    ...(changes.removedPayloadObjectIds ?? []),
    ...(changes.removedObjectIds ?? []),
  ];

  return {
    objectIds: suggestionWrittenIds(changes),
    editsOrder: !!changes.order || !!changes.removedObjectIds?.length,
    payloadIds: [...new Set(payloadIds)],
  };
}

function readSnapshot(
  reader: BoardEditPlanningReader,
  boardId: string,
  footprint: BoardSuggestionFootprint,
): BoardChanges {
  const objects = reader.getObjects(boardId, footprint.objectIds);
  const found = new Set(objects.map(({ objectId }) => objectId));
  const payloadIds = footprint.payloadIds ?? [];
  const payloads = reader.getPayloads(boardId, payloadIds);
  const loadedPayloads = new Set(payloads.map(({ objectId }) => objectId));

  return {
    kind: 'changes',
    objects,
    payloads,
    removedObjectIds: footprint.objectIds.filter((id) => !found.has(id)),
    removedPayloadObjectIds: payloadIds.filter((id) => found.has(id) && !loadedPayloads.has(id)),
    order: footprint.editsOrder
      ? reader.listObjects(boardId).map(({ objectId }) => objectId)
      : undefined,
  };
}

function scopesOverlap(left: BoardSuggestionFootprint, right: BoardSuggestionFootprint): boolean {
  if (left.editsOrder && right.editsOrder) {
    return true;
  }

  const ids = new Set(left.objectIds);

  return right.objectIds.some((id) => ids.has(id));
}

function clockOf(physical: bigint, alias?: BoardSuggestionClock): bigint {
  return alias?.physical === physical ? alias.logical : physical;
}

function aliasedReader(
  reader: BoardEditPlanningReader,
  boardId: string,
  state: BoardSuggestionReviewState,
): BoardEditPlanningReader {
  const aliases = new Map(state.objectClocks.map((clock) => [clock.objectId, clock]));

  function withClocks(id: string, objects: readonly BoardObject[]): readonly BoardObject[] {
    if (id !== boardId) {
      return objects;
    }

    return objects.map((object) => {
      const clock = aliases.get(object.objectId);

      return {
        ...object,
        geometryVersion: clockOf(object.geometryVersion, clock?.geometry),
        payloadVersion:
          object.payloadVersion === undefined
            ? undefined
            : clockOf(object.payloadVersion, clock?.payload),
      };
    });
  }

  return {
    ...reader,
    getObjects: (id, ids) => withClocks(id, reader.getObjects(id, ids)),
    listObjects: (id, limit) => withClocks(id, reader.listObjects(id, limit)),
    listGroupObjects: (id, group) => withClocks(id, reader.listGroupObjects(id, group)),
    listChildObjects: (id, parent) => withClocks(id, reader.listChildObjects(id, parent)),
    listRelatedConnectors: (id, ids) => withClocks(id, reader.listRelatedConnectors(id, ids)),
    getPayloads(id, ids) {
      const payloads = reader.getPayloads(id, ids);
      if (id !== boardId) {
        return payloads;
      }

      return payloads.map((payload) => ({
        ...payload,
        payloadVersion: clockOf(payload.payloadVersion, aliases.get(payload.objectId)?.payload),
      }));
    },
  };
}

function comparableGeometry({
  kind,
  geometry,
  parentId,
  groupId,
  locked,
  appearance,
  detail,
}: BoardObject) {
  return { kind, geometry, parentId, groupId, locked, appearance, detail };
}

function advancesGeometry(before: BoardObject | undefined, after: BoardObject): boolean {
  return (
    !before || lexicalJson(comparableGeometry(before)) !== lexicalJson(comparableGeometry(after))
  );
}

function clockBase(boardRevision: bigint, logical: bigint, current?: bigint): bigint {
  return current ?? (boardRevision > logical ? boardRevision : logical);
}

function nextClock(boardRevision: bigint, logical: bigint, current?: bigint): bigint {
  return clockBase(boardRevision, logical, current) + 1n;
}

function materialize(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  changes: BoardChanges,
): BoardEditDecision {
  const objects = reader.getObjects(
    board.boardId,
    changes.objects?.map(({ objectId }) => objectId) ?? [],
  );
  const payloads = reader.getPayloads(
    board.boardId,
    changes.payloads?.map(({ objectId }) => objectId) ?? [],
  );
  const metadata = new Map(objects.map((object) => [object.objectId, object]));
  const bodies = new Map(payloads.map((payload) => [payload.objectId, payload]));
  const exhaustedPayload = changes.payloads?.some(
    (payload) =>
      !canAdvanceVersion(
        clockBase(
          board.revision,
          payload.payloadVersion,
          bodies.get(payload.objectId)?.payloadVersion,
        ),
      ),
  );
  const exhaustedGeometry = changes.objects?.some((object) => {
    const live = metadata.get(object.objectId);

    return (
      advancesGeometry(live, object) &&
      !canAdvanceVersion(clockBase(board.revision, object.geometryVersion, live?.geometryVersion))
    );
  });

  if (exhaustedGeometry || exhaustedPayload) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const updatedPayloads = changes.payloads?.map((payload) => ({
    ...payload,
    payloadVersion: nextClock(
      board.revision,
      payload.payloadVersion,
      bodies.get(payload.objectId)?.payloadVersion,
    ),
  }));
  const versions = new Map(
    updatedPayloads?.map(({ objectId, payloadVersion }) => [objectId, payloadVersion]),
  );
  const removedBodies = new Set(changes.removedPayloadObjectIds);

  return {
    ...changes,
    payloads: updatedPayloads,
    objects: changes.objects?.map((object) => {
      const live = metadata.get(object.objectId);
      const payloadVersion = removedBodies.has(object.objectId)
        ? undefined
        : (versions.get(object.objectId) ?? live?.payloadVersion ?? object.payloadVersion);

      return {
        ...object,
        payloadVersion,
        geometryVersion: advancesGeometry(live, object)
          ? nextClock(board.revision, object.geometryVersion, live?.geometryVersion)
          : (live?.geometryVersion ?? object.geometryVersion),
      };
    }),
  };
}

function conflict(revision: bigint): SuggestionDecisionPlan {
  return { decision: { kind: 'conflict', boardRevision: revision } };
}

function stillOwnsUndo(
  reader: BoardEditPlanningReader,
  board: BoardHeader,
  application: BoardSuggestionApplicationState,
  digest: Digest,
): boolean {
  const now = readSnapshot(reader, board.boardId, application.footprint);

  return changeFingerprint(now, digest) === application.afterFingerprint;
}

function lockedThroughParents(
  reader: BoardEditPlanningReader,
  boardId: string,
  object: BoardObject,
  restoredUnlocks: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let current: BoardObject | undefined = object;
  while (current) {
    const protectedLock = current.locked && !restoredUnlocks.has(current.objectId);
    if (protectedLock || visited.has(current.objectId)) {
      return true;
    }

    visited.add(current.objectId);
    current = current.parentId ? reader.getObjects(boardId, [current.parentId])[0] : undefined;
  }

  return false;
}

function protectedGeometry(object: BoardObject) {
  const { locked: _locked, ...changed } = comparableGeometry(object);

  return lexicalJson(changed);
}

function undoChangesLockedGeometry(
  reader: BoardEditPlanningReader,
  boardId: string,
  application: BoardSuggestionApplicationState,
): boolean {
  const saved = application.inverse.objects ?? [];
  const current = reader.getObjects(
    boardId,
    saved.map(({ objectId }) => objectId),
  );
  const byId = new Map(current.map((object) => [object.objectId, object]));
  const restoredUnlocks = new Set(
    saved.filter(({ locked }) => !locked).map(({ objectId }) => objectId),
  );

  return saved.some((object) => {
    const live = byId.get(object.objectId);
    if (!live || protectedGeometry(live) === protectedGeometry(object)) {
      return false;
    }

    return lockedThroughParents(reader, boardId, live, restoredUnlocks);
  });
}

function reviewBoardRevision(
  board: BoardHeader,
  state: BoardSuggestionReviewState,
  reversed: readonly BoardSuggestionApplicationState[],
): bigint {
  const matching = reversed.find(({ footprint }) => footprint.editsOrder);

  return matching?.baselineBoardRevision ?? clockOf(board.revision, state.boardClock);
}

interface ReviewOptions {
  readonly reader: BoardSuggestionReader;
  readonly board: BoardHeader;
  readonly proposal: StoredBoardSuggestion;
  readonly choice: BoardSuggestionChoice;
  readonly decodeEdit: DecodeBoardSuggestionEdit;
  readonly digest: Digest;
  readonly applying: boolean;
}

export function prepareSuggestionDecision({
  reader,
  board,
  proposal,
  choice,
  decodeEdit,
  digest,
  applying,
}: ReviewOptions): SuggestionDecisionPlan {
  const option = proposal.options.find(({ optionId }) => optionId === choice.optionId);
  if (!option) {
    return unavailableVersion;
  }
  if (proposal.proposalVersion !== choice.expectedProposalVersion) {
    return conflict(board.revision);
  }
  if (proposal.rejected) {
    return { decision: { kind: 'rejected', reason: 'invalidEdit' } };
  }

  const source = reader.getReviewSource(board.boardId, proposal.sourceId);
  if (!source) {
    return { decision: { kind: 'rejected', reason: 'forbidden' } };
  }

  return prepareFromSource(
    { reader, board, proposal, choice, decodeEdit, digest, applying },
    new Set(source.objectIds),
    option,
  );
}

function prepareFromSource(
  { reader, board, proposal, choice, decodeEdit, digest, applying }: ReviewOptions,
  sourceIds: ReadonlySet<string>,
  option: StoredBoardSuggestion['options'][number],
): SuggestionDecisionPlan {
  if (proposal.acceptedOptionId && !proposal.reviewState) {
    return unavailableVersion;
  }

  const state = proposal.reviewState ?? noReview;
  const selected = state.applications.find(({ optionId }) => optionId === choice.optionId);
  if (selected && !applying) {
    return { decision: { kind: 'changes' } };
  }

  const reversed = selected
    ? [selected]
    : state.applications.filter(
        ({ footprint }) => !option.footprint || scopesOverlap(footprint, option.footprint),
      );

  if (reversed.some((application) => !stillOwnsUndo(reader, board, application, digest))) {
    return conflict(board.revision);
  }
  if (reversed.some(({ footprint }) => footprint.objectIds.some((id) => !sourceIds.has(id)))) {
    return { decision: { kind: 'rejected', reason: 'forbidden' } };
  }
  if (
    reversed.some((application) => undoChangesLockedGeometry(reader, board.boardId, application))
  ) {
    return { decision: { kind: 'rejected', reason: 'geometryLocked' } };
  }

  const working = createSuggestionOverlay(
    aliasedReader(reader, board.boardId, state),
    board.boardId,
    false,
  );

  for (const application of reversed) {
    working.stage(application.inverse);
  }

  const logicalRevision = reviewBoardRevision(board, state, reversed);
  const restored = working.changes();
  if (selected) {
    return {
      decision: materialize(reader, board, restored),
      review: {
        previous: state,
        reversed,
        restoredObjects: restored.objects ?? [],
        restoredPayloads: restored.payloads ?? [],
        restoredBoardRevision: restored.order && logicalRevision,
      },
    };
  }

  return prepareCandidate(
    { reader, board, proposal, choice, decodeEdit, digest, applying },
    sourceIds,
    option,
    { working, state, reversed, logicalRevision, restored },
  );
}

interface CandidateStage {
  readonly working: ReturnType<typeof createSuggestionOverlay>;
  readonly state: BoardSuggestionReviewState;
  readonly reversed: readonly BoardSuggestionApplicationState[];
  readonly logicalRevision: bigint;
  readonly restored: BoardChanges;
}

function prepareCandidate(
  { reader, board, choice, decodeEdit, digest }: ReviewOptions,
  sourceIds: ReadonlySet<string>,
  option: StoredBoardSuggestion['options'][number],
  { working, state, reversed, logicalRevision, restored }: CandidateStage,
): SuggestionDecisionPlan {
  const logicalBoard = { ...board, revision: logicalRevision };
  const decision = planSuggestionOption(
    working.reader,
    logicalBoard,
    option,
    sourceIds,
    decodeEdit,
  );

  if (decision.kind !== 'changes') {
    return { decision };
  }
  if (changeFingerprint(decision, digest) !== option.plannedFingerprint) {
    return conflict(board.revision);
  }

  const footprint = suggestionFootprint(decision);
  const inverse = readSnapshot(working.reader, board.boardId, footprint);
  working.stage(decision);
  const carriesLogicalClocks = state.objectClocks.length > 0 || reversed.length > 0;
  const logical = reversed.length ? working.changes() : decision;
  const selectedGeometry = new Set(
    decision.objects
      ?.filter((object) => {
        const before = inverse.objects?.find(({ objectId }) => objectId === object.objectId);

        return object.geometryVersion !== before?.geometryVersion;
      })
      .map(({ objectId }) => objectId),
  );
  const selectedPayloads = new Set(footprint.payloadIds);

  return {
    decision: carriesLogicalClocks ? materialize(reader, board, logical) : decision,
    review: {
      previous: state,
      reversed,
      application: {
        optionId: choice.optionId,
        baselineBoardRevision: logicalRevision,
        footprint,
        inverse,
      },
      restoredObjects:
        restored.objects?.filter(({ objectId }) => !selectedGeometry.has(objectId)) ?? [],
      restoredPayloads:
        restored.payloads?.filter(({ objectId }) => !selectedPayloads.has(objectId)) ?? [],
      restoredBoardRevision: !footprint.editsOrder && restored.order ? logicalRevision : undefined,
    },
  };
}

function chooseClock(physical: bigint, logical: bigint): BoardSuggestionClock | undefined {
  return physical === logical ? undefined : { physical, logical };
}

function restoredClocks(
  reader: BoardEditPlanningReader,
  boardId: string,
  draft: SuggestionReviewDraft,
): readonly BoardSuggestionObjectClocks[] {
  const clocks = new Map(draft.previous.objectClocks.map((clock) => [clock.objectId, clock]));
  const objects = new Map(
    reader
      .getObjects(
        boardId,
        draft.restoredObjects.map(({ objectId }) => objectId),
      )
      .map((object) => [object.objectId, object]),
  );

  for (const { objectId, geometryVersion } of draft.restoredObjects) {
    const live = objects.get(objectId)?.geometryVersion;
    if (live !== undefined) {
      clocks.set(objectId, {
        ...clocks.get(objectId),
        objectId,
        geometry: chooseClock(live, geometryVersion),
      });
    }
  }

  const payloads = new Map(
    reader
      .getPayloads(
        boardId,
        draft.restoredPayloads.map(({ objectId }) => objectId),
      )
      .map((payload) => [payload.objectId, payload]),
  );

  for (const { objectId, payloadVersion } of draft.restoredPayloads) {
    const live = payloads.get(objectId)?.payloadVersion;
    if (live !== undefined) {
      clocks.set(objectId, {
        ...clocks.get(objectId),
        objectId,
        payload: chooseClock(live, payloadVersion),
      });
    }
  }

  return [...clocks.values()].filter(({ geometry, payload }) => !!geometry || !!payload);
}

export function finishSuggestionDecision(
  reader: BoardEditPlanningReader,
  boardId: string,
  receivedRevision: bigint,
  draft: SuggestionReviewDraft,
  digest: Digest,
): BoardSuggestionReviewState {
  const replaced = new Set(draft.reversed.map(({ optionId }) => optionId));
  const remaining = draft.previous.applications.filter(({ optionId }) => !replaced.has(optionId));
  const application = draft.application;
  if (application) {
    const after = readSnapshot(reader, boardId, application.footprint);
    remaining.push({
      ...application,
      boardRevision: receivedRevision,
      afterFingerprint: changeFingerprint(after, digest),
    });
  }

  return {
    applications: remaining,
    objectClocks: restoredClocks(reader, boardId, draft),
    boardClock:
      draft.restoredBoardRevision === undefined
        ? draft.previous.boardClock
        : chooseClock(receivedRevision, draft.restoredBoardRevision),
  };
}
