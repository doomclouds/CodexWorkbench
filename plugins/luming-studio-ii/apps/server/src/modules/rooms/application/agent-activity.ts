import {
  normalizedActivityScope,
  overlappingWorkspaces,
  projectedActivityAreas,
  sameActivityScope,
  validActivityObjectIds,
  validActivityPhase,
  validAgentActivityId,
} from '../domain/index.js';
import type {
  AgentActivityArea,
  AgentActivityEndReason,
  AgentActivityOperation,
  AgentActivityResult,
  AgentActivityScope,
  AgentWorkspace,
  BeginAgentActivity,
  UpdateAgentActivity,
} from '../domain/index.js';

export interface AgentActivityOptions {
  readonly now: () => number;
  readonly mintGeneration: () => string;
  readonly resolveScope: (
    boardId: string,
    ownerId: string,
    scope: AgentActivityScope,
  ) => readonly AgentActivityArea[] | undefined;
}

export interface AgentActivityPrincipal {
  readonly boardId: string;
  readonly ownerId: string;
  readonly agentId: string;
}

export interface ReleaseAgentActivity extends AgentActivityPrincipal {
  readonly taskId: string;
  readonly generation: string;
}

export interface AgentActivity {
  change(principal: AgentActivityPrincipal, operation: AgentActivityOperation): AgentActivityResult;
  release(request: ReleaseAgentActivity): AgentActivityResult;
  snapshot(boardId: string, ownerId?: string): readonly AgentWorkspace[];
  visibleSnapshot(boardId: string): readonly AgentWorkspace[];
  onlineAgentIds(boardId: string): readonly string[];
  readingAgentIds(boardId: string): readonly string[];
  setReadPresence(principal: AgentActivityPrincipal, activityId: string, reading: boolean): void;
  withdraw(principal: Pick<AgentActivityPrincipal, 'ownerId' | 'agentId'>): readonly string[];
}

interface LiveWorkspace {
  readonly kind: 'active';
  readonly ownerId: string;
  readonly workspace: AgentWorkspace;
  readonly precedingGeneration?: string;
}

interface RetiredWorkspace {
  readonly kind: 'ended';
  readonly generation: string;
  readonly reason: AgentActivityEndReason;
  readonly display?: AgentWorkspace;
  readonly presence?: AgentPresence;
}

interface AgentPresence {
  readonly agentId: string;
  readonly ownerId: string;
  readonly idleUntil: number;
}

interface ReadPresence extends AgentActivityPrincipal {
  readonly reading: boolean;
  readonly expiresAt: number;
}

type Workspace = LiveWorkspace | RetiredWorkspace;
type BoardWorkspaces = Map<string, Workspace>;
type Rejection = Extract<AgentActivityResult, { readonly kind: 'rejected' }>['reason'];

const leaseMs = 10 * 60_000;
const idleMs = 20_000;
const readPresenceMs = 120_000;
const maxReads = 128;
const terminalDisplayMs = 4_000;
const maxBoardWorkspaces = 12;
const maxAgentWorkspaces = 6;
const maxBoardHistory = 256;
const maxStored = 8192;
const maxLabelLength = 120;
const invalidLabel = /\p{Cc}/u;
const emptyWorkspaces: readonly AgentWorkspace[] = [];

function taskKey({ ownerId, agentId }: AgentActivityPrincipal, taskId: string): string {
  return JSON.stringify([ownerId, agentId, taskId]);
}

function validPrincipal({ boardId, ownerId, agentId }: AgentActivityPrincipal) {
  const distinct = ownerId !== agentId;

  return distinct && [boardId, ownerId, agentId].every(validAgentActivityId);
}

function rejected(reason: Rejection): AgentActivityResult {
  return { kind: 'rejected', reason };
}

function resultOf(record: Workspace): AgentActivityResult {
  if (record.kind === 'active') {
    return { kind: 'active', workspace: record.workspace };
  }

  return { kind: 'ended', generation: record.generation, reason: record.reason };
}

function retire(
  { ownerId, workspace }: LiveWorkspace,
  reason: AgentActivityEndReason,
  endedAtUnixMs: number,
): RetiredWorkspace {
  return {
    kind: 'ended',
    generation: workspace.generation,
    reason,
    display: { ...workspace, endedAtUnixMs, endReason: reason },
    presence: { ownerId, agentId: workspace.agentId, idleUntil: endedAtUnixMs + idleMs },
  };
}

function currentRecord(board: BoardWorkspaces, key: string, now: number) {
  const record = board.get(key);
  const expired = record?.kind === 'active' && record.workspace.expiresAtUnixMs <= now;
  if (!expired) {
    return record;
  }

  const retired = retire(record, 'expired', record.workspace.expiresAtUnixMs);
  board.set(key, retired);

  return retired;
}

function liveWorkspaces(
  board: BoardWorkspaces | undefined,
  now: number,
  ownerId?: string,
): readonly AgentWorkspace[] {
  if (!board) {
    return emptyWorkspaces;
  }

  const workspaces: AgentWorkspace[] = [];
  for (const record of board.values()) {
    if (record.kind !== 'active' || record.workspace.expiresAtUnixMs <= now) {
      continue;
    }

    if (ownerId === undefined || record.ownerId === ownerId) {
      workspaces.push(record.workspace);
    }
  }

  return workspaces.length ? workspaces : emptyWorkspaces;
}

function visibleWorkspaces(board: BoardWorkspaces | undefined, now: number) {
  if (!board) {
    return emptyWorkspaces;
  }

  const active = liveWorkspaces(board, now);
  const ended: AgentWorkspace[] = [];
  for (const key of board.keys()) {
    const record = currentRecord(board, key, now);
    if (record?.kind !== 'ended' || !record.display) {
      continue;
    }

    const { display, ...receipt } = record;
    if ((display.endedAtUnixMs ?? 0) + terminalDisplayMs > now) {
      ended.push(display);
    } else {
      board.set(key, receipt);
    }
  }

  if (!ended.length) {
    return active;
  }

  ended.sort((a, b) => (b.endedAtUnixMs ?? 0) - (a.endedAtUnixMs ?? 0));

  return [...active, ...ended.slice(0, Math.max(0, maxBoardWorkspaces - active.length))];
}

function onlineAgentIds(board: BoardWorkspaces | undefined, now: number) {
  const agents = new Set<string>();
  for (const key of board?.keys() ?? []) {
    const record = board && currentRecord(board, key, now);
    if (record?.kind === 'active') {
      agents.add(record.workspace.agentId);
    } else if (record?.presence && record.presence.idleUntil > now) {
      agents.add(record.presence.agentId);
    }
  }

  return [...agents].sort();
}

function priorBegin(
  record: Workspace | undefined,
  input: BeginAgentActivity,
  scope: AgentActivityScope,
) {
  const priorGeneration = input.previousGeneration;
  if (!record) {
    return priorGeneration === undefined ? undefined : rejected('generationChanged');
  }

  if (record.kind === 'ended') {
    if (record.reason === 'released') {
      return rejected('workspaceReleased');
    }

    return record.generation === priorGeneration ? undefined : rejected('generationChanged');
  }

  const alreadyActive =
    priorGeneration === undefined || record.workspace.generation === priorGeneration;
  const repeatsRenewal = record.precedingGeneration === priorGeneration;
  if (!alreadyActive && !repeatsRenewal) {
    return rejected('generationChanged');
  }

  return sameActivityScope(record.workspace.scope, scope) ? resultOf(record) : rejected('invalid');
}

function labelOf(raw: string) {
  const label = raw.trim();

  if (label.length > maxLabelLength || invalidLabel.test(label)) {
    return undefined;
  }

  return label || 'Agent';
}

function sameFocus(workspace: AgentWorkspace, focused: ReadonlySet<string>) {
  const active = workspace.areas.filter(({ active: selected }) => selected);

  return active.length === focused.size && active.every(({ id }) => focused.has(id));
}

function focusedAreas(areas: AgentWorkspace['areas'], focused: ReadonlySet<string>) {
  const next = areas.map((area) => ({ ...area, active: focused.has(area.id) }));

  return next.filter(({ active }) => active).length === focused.size ? next : undefined;
}

export function createAgentActivity(options: AgentActivityOptions): AgentActivity {
  const boards = new Map<string, BoardWorkspaces>();
  const disconnected = new Map<string, number>();
  const reads = new Map<string, ReadPresence>();
  let stored = 0;

  function boardFor(boardId: string): BoardWorkspaces {
    const known = boards.get(boardId);
    if (known) {
      return known;
    }

    const board: BoardWorkspaces = new Map();
    boards.set(boardId, board);

    return board;
  }

  function resolve(
    principal: AgentActivityPrincipal,
    scope: AgentActivityScope,
    focus: readonly string[] = [],
  ) {
    const { boardId, ownerId } = principal;
    const metadataScope =
      scope.kind === 'area' && focus.length
        ? { kind: 'objects' as const, objectIds: focus }
        : scope;
    const metadata = options.resolveScope(boardId, ownerId, metadataScope);

    return metadata && projectedActivityAreas(scope, metadata);
  }

  function begin(principal: AgentActivityPrincipal, input: BeginAgentActivity, now: number) {
    const scope = normalizedActivityScope(input.scope);
    const label = labelOf(input.label);
    if (!scope || label === undefined) {
      return rejected('invalid');
    }

    const key = taskKey(principal, input.taskId);
    const known = boards.get(principal.boardId);
    const record = known && currentRecord(known, key, now);
    const existing = priorBegin(record, input, scope);
    if (existing) {
      return existing;
    }

    const capacity = stored < maxStored && (known?.size ?? 0) < maxBoardHistory;
    if (!record && !capacity) {
      return rejected('capacity');
    }

    const active = liveWorkspaces(known, now, principal.ownerId);
    const own = active.filter(({ agentId }) => agentId === principal.agentId);
    if (active.length >= maxBoardWorkspaces || own.length >= maxAgentWorkspaces) {
      return rejected('capacity');
    }

    const areas = resolve(principal, scope);
    if (!areas) {
      return rejected('invalid');
    }
    if (active.some((workspace) => overlappingWorkspaces(workspace.areas, areas))) {
      return rejected('overlap');
    }

    const board = boardFor(principal.boardId);

    const workspace: AgentWorkspace = {
      agentId: principal.agentId,
      taskId: input.taskId,
      generation: options.mintGeneration(),
      label,
      scope,
      phase: 'preparing',
      areas,
      expiresAtUnixMs: now + leaseMs,
      lastProgressAtUnixMs: now,
    };
    board.set(key, {
      kind: 'active',
      ownerId: principal.ownerId,
      precedingGeneration: input.previousGeneration,
      workspace,
    });

    if (!record) {
      stored += 1;
    }

    return { kind: 'active', workspace } as const;
  }

  function update(
    principal: AgentActivityPrincipal,
    board: BoardWorkspaces,
    record: LiveWorkspace,
    input: UpdateAgentActivity,
    now: number,
  ) {
    const { workspace } = record;
    const { phase, activeObjectIds } = input;
    if (!validActivityPhase(phase) || !validActivityObjectIds(activeObjectIds)) {
      return rejected('invalid');
    }

    const focused = new Set(activeObjectIds);
    if (phase === workspace.phase && sameFocus(workspace, focused)) {
      return resultOf(record);
    }

    const resolved = resolve(principal, workspace.scope, activeObjectIds);
    const areas = resolved && focusedAreas(resolved, focused);
    if (!areas) {
      return rejected('invalid');
    }

    const others = liveWorkspaces(board, now, principal.ownerId).filter(
      (other) => other !== workspace,
    );

    if (others.some((other) => overlappingWorkspaces(other.areas, areas))) {
      return rejected('overlap');
    }

    const changed = {
      ...workspace,
      phase,
      areas,
      expiresAtUnixMs: now + leaseMs,
      lastProgressAtUnixMs: now,
    };
    board.set(taskKey(principal, input.taskId), { ...record, workspace: changed });

    return { kind: 'active', workspace: changed } as const;
  }

  function close(
    board: BoardWorkspaces,
    record: LiveWorkspace,
    key: string,
    reason: AgentActivityEndReason,
    now: number,
  ) {
    const terminal = retire(record, reason, now);
    board.set(key, terminal);

    return resultOf(terminal);
  }

  function change(
    principal: AgentActivityPrincipal,
    operation: AgentActivityOperation,
  ): AgentActivityResult {
    const { taskId } = operation;
    if (!validPrincipal(principal) || !validAgentActivityId(taskId)) {
      return rejected('invalid');
    }

    const now = options.now();
    if (isDisconnected(principal, now)) {
      return rejected('workspaceReleased');
    }
    if (operation.kind === 'begin') {
      return begin(principal, operation, now);
    }

    const board = boards.get(principal.boardId);
    const key = taskKey(principal, taskId);
    const record = board && currentRecord(board, key, now);
    if (!board || !record) {
      return rejected('notFound');
    }
    if (operation.kind === 'status') {
      return resultOf(record);
    }

    const generation = record.kind === 'active' ? record.workspace.generation : record.generation;
    if (generation !== operation.generation) {
      return rejected('generationChanged');
    }
    if (record.kind === 'ended') {
      return operation.kind === 'end' ? resultOf(record) : rejected('generationChanged');
    }
    if (operation.kind === 'end') {
      return close(board, record, key, 'completed', now);
    }

    return update(principal, board, record, operation, now);
  }

  function release(request: ReleaseAgentActivity): AgentActivityResult {
    const { boardId, taskId, generation } = request;
    if (!validPrincipal(request) || !validAgentActivityId(taskId)) {
      return rejected('invalid');
    }

    const board = boards.get(boardId);
    const key = taskKey(request, taskId);
    const now = options.now();
    const record = board && currentRecord(board, key, now);
    if (!board || !record) {
      return rejected('notFound');
    }
    if (record.kind === 'ended') {
      return record.generation === generation ? resultOf(record) : rejected('generationChanged');
    }
    if (record.workspace.generation !== generation) {
      return rejected('generationChanged');
    }

    return close(board, record, key, 'released', now);
  }

  function withdraw({ ownerId, agentId }: Pick<AgentActivityPrincipal, 'ownerId' | 'agentId'>) {
    const now = options.now();
    rememberDisconnect(ownerId, agentId, now);
    const affected = new Set<string>();
    for (const [key, read] of reads) {
      if (read.ownerId === ownerId && read.agentId === agentId) {
        reads.delete(key);
        affected.add(read.boardId);
      }
    }
    for (const [boardId, board] of boards) {
      for (const key of board.keys()) {
        const record = currentRecord(board, key, now);
        const ended = disconnectWorkspace(record, ownerId, agentId, now);
        if (ended) {
          const { presence: _presence, ...receipt } = ended;
          board.set(key, receipt);
          affected.add(boardId);
        }
      }
    }

    return [...affected];
  }

  function isDisconnected({ ownerId, agentId }: AgentActivityPrincipal, now: number) {
    return (disconnected.get(JSON.stringify([ownerId, agentId])) ?? 0) > now;
  }

  function setReadPresence(
    principal: AgentActivityPrincipal,
    activityId: string,
    reading: boolean,
  ) {
    const now = options.now();
    if (!validPrincipal(principal) || !validAgentActivityId(activityId)) {
      return;
    }
    if (isDisconnected(principal, now)) {
      return;
    }

    for (const [id, read] of reads) {
      if (read.expiresAt <= now) {
        reads.delete(id);
      }
    }

    const { boardId, ownerId, agentId } = principal;
    const key = JSON.stringify([boardId, ownerId, agentId, activityId]);
    const previous = reads.get(key);
    const starting = reading && !previous && reads.size < maxReads;
    const finishing = !reading && previous?.reading;
    if (starting || finishing) {
      reads.set(key, {
        ...principal,
        reading,
        expiresAt: now + (reading ? readPresenceMs : idleMs),
      });
    }
  }

  function readAgentIds(boardId: string, now: number, readingOnly = false) {
    const ids = new Set<string>();
    for (const read of reads.values()) {
      const active = read.boardId === boardId && read.expiresAt > now;
      if (active && (!readingOnly || read.reading)) {
        ids.add(read.agentId);
      }
    }

    return ids;
  }

  function roster(boardId: string) {
    const now = options.now();
    const present = readAgentIds(boardId, now);
    for (const agentId of onlineAgentIds(boards.get(boardId), now)) {
      present.add(agentId);
    }

    return [...present].sort();
  }

  function rememberDisconnect(ownerId: string, agentId: string, now: number) {
    for (const [id, deadline] of disconnected) {
      if (deadline <= now) {
        disconnected.delete(id);
      }
    }

    disconnected.set(JSON.stringify([ownerId, agentId]), now + leaseMs);
    if (disconnected.size > maxStored) {
      const earliest = disconnected.keys().next().value;
      if (earliest !== undefined) {
        disconnected.delete(earliest);
      }
    }
  }

  return {
    change,
    release,
    snapshot: (boardId, ownerId) => liveWorkspaces(boards.get(boardId), options.now(), ownerId),
    visibleSnapshot: (boardId) => visibleWorkspaces(boards.get(boardId), options.now()),
    onlineAgentIds: roster,
    readingAgentIds: (boardId) => [...readAgentIds(boardId, options.now(), true)].sort(),
    setReadPresence,
    withdraw,
  };
}

function disconnectWorkspace(
  workspace: Workspace | undefined,
  ownerId: string,
  agentId: string,
  now: number,
): RetiredWorkspace | undefined {
  if (workspace?.kind === 'active') {
    return workspace.ownerId === ownerId && workspace.workspace.agentId === agentId
      ? retire(workspace, 'released', now)
      : undefined;
  }

  const presence = workspace?.presence;
  return presence?.ownerId === ownerId && presence.agentId === agentId ? workspace : undefined;
}
