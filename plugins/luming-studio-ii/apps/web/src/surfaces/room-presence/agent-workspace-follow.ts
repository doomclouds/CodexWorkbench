import type { BoardRoomAgentWorkspace } from '../../data/rooms/index.js';
import type { RoomPresenceCamera, RoomPresenceViewport } from './follow.js';

type WorkspaceArea = BoardRoomAgentWorkspace['areas'][number];
type WorkspaceBounds = WorkspaceArea['bounds'];
type SurfaceSize = Pick<RoomPresenceViewport, 'width' | 'height'>;

interface FollowArea extends WorkspaceArea {
  readonly key: string;
}

export interface AgentWorkspaceFollowFrame {
  readonly camera: RoomPresenceCamera;
  readonly target?: string;
}

const minimumFitZoom = 0.1;
const maximumFitZoom = 1;
const maximumMargin = 48;

function followAreas(workspaces: readonly BoardRoomAgentWorkspace[]): readonly FollowArea[] {
  return workspaces.flatMap(({ agentId, taskId, generation, areas }) =>
    areas.map((area) => ({
      ...area,
      key: JSON.stringify([agentId, taskId, generation, area.id]),
    })),
  );
}

function combineBounds(areas: readonly FollowArea[]): WorkspaceBounds | undefined {
  const [first, ...others] = areas;
  if (!first) {
    return undefined;
  }

  let { x, y } = first.bounds;
  let right = x + first.bounds.width;
  let bottom = y + first.bounds.height;
  for (const { bounds } of others) {
    x = Math.min(x, bounds.x);
    y = Math.min(y, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }

  return { x, y, width: right - x, height: bottom - y };
}

function fitZoom(bounds: WorkspaceBounds, local: SurfaceSize) {
  const margin = Math.min(maximumMargin, local.width / 6, local.height / 6);
  const width = (local.width - margin * 2) / bounds.width;
  const height = (local.height - margin * 2) / bounds.height;
  return Math.min(maximumFitZoom, width, height);
}

function hasScreenGap(areas: readonly FollowArea[], axis: 'x' | 'y', screenSize: number) {
  if (areas.length < 2) {
    return false;
  }

  const size = axis === 'x' ? 'width' : 'height';
  const sorted = areas.map(({ bounds }) => bounds).sort((a, b) => a[axis] - b[axis]);
  let edge = -Infinity;
  for (const bounds of sorted) {
    if (edge !== -Infinity && bounds[axis] - edge > screenSize) {
      return true;
    }

    edge = Math.max(edge, bounds[axis] + bounds[size]);
  }

  return false;
}

function viewCenter(camera: RoomPresenceCamera, local: SurfaceSize) {
  return {
    x: (local.width / 2 - camera.x) / camera.zoom,
    y: (local.height / 2 - camera.y) / camera.zoom,
  };
}

function centerCamera(x: number, y: number, zoom: number, local: SurfaceSize) {
  return { x: local.width / 2 - x * zoom, y: local.height / 2 - y * zoom, zoom };
}

function distanceTo(bounds: WorkspaceBounds, point: ReturnType<typeof viewCenter>) {
  const x = Math.max(bounds.x - point.x, point.x - bounds.x - bounds.width, 0);
  const y = Math.max(bounds.y - point.y, point.y - bounds.y - bounds.height, 0);
  return x * x + y * y;
}

function nearestInteriorCenter(start: number, size: number, visible: number, center: number) {
  const margin = Math.min(size, visible) / 2;
  return Math.max(start + margin, Math.min(center, start + size - margin));
}

function locateArea(
  bounds: WorkspaceBounds,
  local: SurfaceSize,
  current: RoomPresenceCamera,
): RoomPresenceCamera {
  const zoom = fitZoom(bounds, local);
  if (zoom >= minimumFitZoom) {
    return centerCamera(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, zoom, local);
  }

  const center = viewCenter(current, local);
  if (distanceTo(bounds, center) === 0) {
    return current;
  }

  const x = nearestInteriorCenter(bounds.x, bounds.width, local.width / current.zoom, center.x);
  const y = nearestInteriorCenter(bounds.y, bounds.height, local.height / current.zoom, center.y);
  return centerCamera(x, y, current.zoom, local);
}

function chosenArea(
  areas: readonly FollowArea[],
  center: ReturnType<typeof viewCenter>,
  previousTarget: string | undefined,
) {
  const active = areas.filter((area) => area.active);
  const candidates = active.length > 0 ? active : areas;
  let closest = candidates.find(({ key }) => key === previousTarget);
  if (closest) {
    return closest;
  }

  let distance = Infinity;
  for (const area of candidates) {
    const next = distanceTo(area.bounds, center);
    if (next < distance) {
      closest = area;
      distance = next;
    }
  }

  return closest;
}

export function fitAgentWorkspaceViewport(
  workspaces: readonly BoardRoomAgentWorkspace[],
  viewport: RoomPresenceViewport | undefined,
  previous?: AgentWorkspaceFollowFrame,
): AgentWorkspaceFollowFrame | undefined {
  if (!viewport || Math.min(viewport.width, viewport.height, viewport.zoom) <= 0) {
    return undefined;
  }

  const areas = followAreas(workspaces);
  const bounds = combineBounds(areas);
  if (!bounds) {
    return undefined;
  }

  const { x, y, zoom } = viewport;
  const current = previous?.camera ?? { x, y, zoom };
  const scattered =
    hasScreenGap(areas, 'x', viewport.width) || hasScreenGap(areas, 'y', viewport.height);

  if (!scattered && fitZoom(bounds, viewport) >= minimumFitZoom) {
    return { camera: locateArea(bounds, viewport, current) };
  }

  const target = chosenArea(areas, viewCenter(current, viewport), previous?.target);
  if (target) {
    return { camera: locateArea(target.bounds, viewport, current), target: target.key };
  }

  return undefined;
}
