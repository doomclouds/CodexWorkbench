import type { BoardElement, Presence } from '../../../contracts/studio';
import { contains } from '../../../shared/whiteboard-geometry';
import type { Viewport } from '../../product-contract';
import {
  activeAgentTasks,
  agentElementBounds,
  combineActivityBounds,
  padActivityBounds,
  type ActivityBounds,
} from '../../shared/agent-activity';

const MIN_SCOPE_FIT_ZOOM = 0.1;

interface SurfaceSize {
  w: number;
  h: number;
}

interface WorkArea {
  key: string;
  bounds: ActivityBounds;
}

export interface AgentFollowFrame {
  viewport: Viewport;
  target?: string;
}

function workAreas(peer: Presence, elements: BoardElement[], now: number) {
  const tasks = activeAgentTasks(peer, now);
  const scopeIds = new Set(tasks.flatMap((task) => task.scope.ids ?? []));
  const editingIds = new Set(peer.context?.editingIds ?? []);
  const scoped = tasks.flatMap(({ taskId, generation, scope }) =>
    scope.rect ? [{ key: `task:${taskId}\0${generation}`, bounds: scope.rect }] : [],
  );
  const rectangles = scoped.map((area) => area.bounds);
  const editing: WorkArea[] = [];

  for (const element of elements) {
    const explicitlyScoped = scopeIds.has(element.id);
    const beingEdited = editingIds.has(element.id);
    if (!explicitlyScoped && !beingEdited) {
      continue;
    }

    const geometry = agentElementBounds(element, elements);
    const area = { key: `object:${element.id}`, bounds: padActivityBounds(geometry, 12) };
    if (explicitlyScoped) {
      scoped.push(area);
    }

    const withinWorkspace = explicitlyScoped || rectangles.some((rect) => contains(rect, geometry));
    if (beingEdited && withinWorkspace) {
      editing.push(area);
    }
  }

  return { scoped, editing };
}

function fitZoom(bounds: ActivityBounds, local: SurfaceSize) {
  const margin = Math.min(48, local.w / 6, local.h / 6);
  return Math.min(1, (local.w - margin * 2) / bounds.w, (local.h - margin * 2) / bounds.h);
}

function centeredViewport(x: number, y: number, zoom: number, local: SurfaceSize): Viewport {
  return { x: local.w / 2 - x * zoom, y: local.h / 2 - y * zoom, zoom };
}

function viewBounds(viewport: Viewport, local: SurfaceSize): ActivityBounds {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: local.w / viewport.zoom,
    h: local.h / viewport.zoom,
  };
}

function separatedByScreen(areas: WorkArea[], axis: 'x' | 'y', screenSize: number) {
  if (areas.length < 2) {
    return false;
  }

  const size = axis === 'x' ? 'w' : 'h';
  const intervals = areas.map((area) => area.bounds).sort((a, b) => a[axis] - b[axis]);
  let end = intervals[0]![axis] + intervals[0]![size];
  for (const interval of intervals.slice(1)) {
    if (interval[axis] - end > screenSize) {
      return true;
    }

    end = Math.max(end, interval[axis] + interval[size]);
  }

  return false;
}

function closestArea(areas: WorkArea[], current: ActivityBounds) {
  const x = current.x + current.w / 2;
  const y = current.y + current.h / 2;
  function distanceSquared({ bounds }: WorkArea) {
    const dx = Math.max(bounds.x - x, x - (bounds.x + bounds.w), 0);
    const dy = Math.max(bounds.y - y, y - (bounds.y + bounds.h), 0);
    return dx * dx + dy * dy;
  }

  return areas.reduce((closest, area) =>
    distanceSquared(area) < distanceSquared(closest) ? area : closest,
  );
}

function containsViewportCenter(bounds: ActivityBounds, visible: ActivityBounds) {
  const x = visible.x + visible.w / 2;
  const y = visible.y + visible.h / 2;
  const withinWidth = bounds.x <= x && x <= bounds.x + bounds.w;
  const withinHeight = bounds.y <= y && y <= bounds.y + bounds.h;
  return withinWidth && withinHeight;
}

function nearestInteriorCenter(
  start: number,
  span: number,
  visibleStart: number,
  visibleSpan: number,
) {
  const inset = Math.min(span, visibleSpan) / 2;
  const current = visibleStart + visibleSpan / 2;
  return Math.max(start + inset, Math.min(current, start + span - inset));
}

function locateArea(bounds: ActivityBounds, local: SurfaceSize, current: Viewport): Viewport {
  const zoom = fitZoom(bounds, local);
  if (zoom >= MIN_SCOPE_FIT_ZOOM) {
    return centeredViewport(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, zoom, local);
  }

  const visible = viewBounds(current, local);
  if (containsViewportCenter(bounds, visible)) {
    return current;
  }

  const x = nearestInteriorCenter(bounds.x, bounds.w, visible.x, visible.w);
  const y = nearestInteriorCenter(bounds.y, bounds.h, visible.y, visible.h);
  return centeredViewport(x, y, current.zoom, local);
}

export function agentFollowFrame(
  peer: Presence,
  elements: BoardElement[],
  now: number,
  local: SurfaceSize,
  viewport?: Viewport,
  previous?: AgentFollowFrame,
): AgentFollowFrame | undefined {
  const { scoped, editing } = workAreas(peer, elements, now);
  const bounds = combineActivityBounds(scoped.map((area) => area.bounds));
  if (!bounds) {
    return;
  }

  const current = previous?.viewport ?? viewport ?? { x: 0, y: 0, zoom: 1 };
  const scattered =
    separatedByScreen(scoped, 'x', local.w) || separatedByScreen(scoped, 'y', local.h);

  if (!scattered && fitZoom(bounds, local) >= MIN_SCOPE_FIT_ZOOM) {
    return { viewport: locateArea(bounds, local, current) };
  }

  const candidates = editing.length ? editing : scoped;
  const target =
    candidates.find((area) => area.key === previous?.target) ??
    closestArea(candidates, viewBounds(current, local));

  return { viewport: locateArea(target.bounds, local, current), target: target.key };
}
