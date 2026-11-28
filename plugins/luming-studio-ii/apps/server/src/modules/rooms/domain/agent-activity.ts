export interface AgentActivityBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AgentActivityArea {
  readonly id: string;
  readonly bounds: AgentActivityBounds;
}

interface WorkspaceArea extends AgentActivityArea {
  readonly active: boolean;
}

export type AgentActivityScope =
  | { readonly kind: 'objects'; readonly objectIds: readonly string[] }
  | { readonly kind: 'area'; readonly bounds: AgentActivityBounds };

export type AgentActivityPhase = 'preparing' | 'writing' | 'verifying';

export interface AgentWorkspace {
  readonly agentId: string;
  readonly taskId: string;
  readonly generation: string;
  readonly label: string;
  readonly phase: AgentActivityPhase;
  readonly scope: AgentActivityScope;
  readonly areas: readonly WorkspaceArea[];
  readonly expiresAtUnixMs: number;
  readonly lastProgressAtUnixMs?: number;
  readonly endedAtUnixMs?: number;
  readonly endReason?: AgentActivityEndReason;
}

export interface BeginAgentActivity {
  readonly kind: 'begin';
  readonly taskId: string;
  readonly label: string;
  readonly scope: AgentActivityScope;
  readonly previousGeneration?: string;
}

export interface UpdateAgentActivity {
  readonly kind: 'update';
  readonly taskId: string;
  readonly generation: string;
  readonly phase: AgentActivityPhase;
  readonly activeObjectIds: readonly string[];
}

export type AgentActivityOperation =
  | BeginAgentActivity
  | UpdateAgentActivity
  | { readonly kind: 'end'; readonly taskId: string; readonly generation: string }
  | { readonly kind: 'status'; readonly taskId: string };

export type AgentActivityEndReason = 'completed' | 'released' | 'expired';

type AgentActivityRejection =
  | 'invalid'
  | 'overlap'
  | 'capacity'
  | 'notFound'
  | 'generationChanged'
  | 'workspaceReleased';

export type AgentActivityResult =
  | { readonly kind: 'active'; readonly workspace: AgentWorkspace }
  | { readonly kind: 'ended'; readonly generation: string; readonly reason: AgentActivityEndReason }
  | { readonly kind: 'rejected'; readonly reason: AgentActivityRejection };

export const maxAgentActivityObjects = 24;
const declaredAreaId = '@area';
const coordinateLimit = 10_000_000;
const identifier = /^[A-Za-z0-9_.:-]{1,160}$/u;
const phases = new Set<AgentActivityPhase>(['preparing', 'writing', 'verifying']);

export function validAgentActivityId(value: string): boolean {
  return identifier.test(value);
}

function insideWorld(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= coordinateLimit;
}

function validBounds({ x, y, width, height }: AgentActivityBounds) {
  const withinLimits = [x, y, width, height, x + width, y + height].every(insideWorld);

  return withinLimits && width > 0 && height > 0;
}

export function validActivityObjectIds(ids: readonly string[]) {
  const bounded = ids.length <= maxAgentActivityObjects;
  const unique = new Set(ids).size === ids.length;

  return bounded && unique && ids.every(validAgentActivityId);
}

export function validActivityPhase(phase: AgentActivityPhase) {
  return phases.has(phase);
}

export function normalizedActivityScope(scope: AgentActivityScope): AgentActivityScope | undefined {
  if (scope.kind === 'area') {
    return validBounds(scope.bounds) ? { kind: 'area', bounds: { ...scope.bounds } } : undefined;
  }
  if (scope.objectIds.length && validActivityObjectIds(scope.objectIds)) {
    return { kind: 'objects', objectIds: [...scope.objectIds].sort() };
  }
}

function sameBounds(left: AgentActivityBounds, right: AgentActivityBounds) {
  const sameOrigin = left.x === right.x && left.y === right.y;
  const sameSize = left.width === right.width && left.height === right.height;

  return sameOrigin && sameSize;
}

export function sameActivityScope(left: AgentActivityScope, right: AgentActivityScope): boolean {
  if (left.kind === 'area' && right.kind === 'area') {
    return sameBounds(left.bounds, right.bounds);
  }
  if (left.kind !== 'objects' || right.kind !== 'objects') {
    return false;
  }

  return (
    left.objectIds.length === right.objectIds.length &&
    left.objectIds.every((id, index) => id === right.objectIds[index])
  );
}

function contains(outer: AgentActivityBounds, inner: AgentActivityBounds) {
  const insideX = inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;
  const insideY = inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height;

  return insideX && insideY;
}

function intersects(left: AgentActivityBounds, right: AgentActivityBounds) {
  const overlapsX = left.x < right.x + right.width && right.x < left.x + left.width;
  const overlapsY = left.y < right.y + right.height && right.y < left.y + left.height;

  return overlapsX && overlapsY;
}

export function projectedActivityAreas(
  scope: AgentActivityScope,
  metadata: readonly AgentActivityArea[],
): AgentWorkspace['areas'] | undefined {
  const ids = metadata.map(({ id }) => id);
  const validGeometry = metadata.every(({ bounds }) => validBounds(bounds));
  if (!validGeometry || !validActivityObjectIds(ids)) {
    return undefined;
  }

  const expected = scope.kind === 'objects' ? new Set(scope.objectIds) : undefined;
  const missingTargets =
    expected && (ids.length !== expected.size || ids.some((id) => !expected.has(id)));

  if (missingTargets) {
    return undefined;
  }

  const areas = metadata.map(({ id, bounds }) => ({ id, bounds: { ...bounds }, active: false }));
  if (scope.kind === 'area') {
    const withinScope = areas.filter(({ bounds }) => contains(scope.bounds, bounds));

    return [{ id: declaredAreaId, bounds: scope.bounds, active: false }, ...withinScope];
  }

  return areas;
}

export function overlappingWorkspaces(
  left: readonly AgentActivityArea[],
  right: readonly AgentActivityArea[],
): boolean {
  return left.some((area) =>
    right.some((other) => {
      const sameObject = area.id !== declaredAreaId && area.id === other.id;

      return sameObject || intersects(area.bounds, other.bounds);
    }),
  );
}
