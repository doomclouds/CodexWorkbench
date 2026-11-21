import type {
  AgentActivityScope,
  AgentTask,
  AgentTaskBinding,
  BoardElement,
} from '../../contracts/studio.js';
import type { WhiteboardContent } from '../products/whiteboard.js';
import { arrowGeometry, arrowLabelBox } from '../products/whiteboard-geometry.js';
import { safeId, same, StudioError } from './common.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface AgentWorkspace {
  actorId: string;
  task: AgentTask;
}

export function taskBinding(
  input: Record<string, unknown>,
  required = false,
): AgentTaskBinding | undefined {
  if (input.taskId === undefined && input.generation === undefined) {
    if (required) {
      throw new StudioError(
        'TASK_REQUIRED',
        'Agent 修改白板前须先声明工作区域，并传入返回的 taskId 与 generation。',
      );
    }

    return;
  }
  if (input.taskId === undefined || input.generation === undefined) {
    throw new StudioError('INVALID_ARGUMENT', 'taskId 与 generation 必须成对提供。');
  }

  return {
    taskId: safeId(input.taskId, '任务 ID'),
    generation: safeId(input.generation, '任务代次'),
  };
}

export function sameTaskScope(left: AgentActivityScope, right: AgentActivityScope): boolean {
  return (
    same([...(left.ids ?? [])].sort(), [...(right.ids ?? [])].sort()) && same(left.rect, right.rect)
  );
}

function bounds(points: readonly { x: number; y: number }[], padding = 0): Rect {
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new StudioError('TASK_SCOPE', '对象的实际几何无效，无法确认工作范围。');
    }

    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }

  return {
    x: x - padding,
    y: y - padding,
    w: Math.max(0, right - x) + 2 * padding,
    h: Math.max(0, bottom - y) + 2 * padding,
  };
}

export function workspaceElementBounds(
  element: BoardElement,
  elements: readonly BoardElement[],
): Rect {
  if (element.type === 'arrow') {
    const route = arrowGeometry(element, elements);
    const path = bounds(route.points, Number(element.strokeWidth ?? element.width ?? 1.4) / 2);
    const label = arrowLabelBox(element, route.label);

    return label
      ? bounds([
          { x: path.x, y: path.y },
          { x: path.x + path.w, y: path.y + path.h },
          { x: label.x, y: label.y },
          { x: label.x + label.w, y: label.y + label.h },
        ])
      : path;
  }

  const angle = (Number(element.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const center = { x: element.x + element.w / 2, y: element.y + element.h / 2 };
  const turn = (x: number, y: number) => ({
    x: center.x + x * c - y * s,
    y: center.y + x * s + y * c,
  });

  if (element.type === 'stroke' && element.points?.length) {
    if (element.points.length % 2) {
      throw new StudioError('TASK_SCOPE', '笔迹坐标不完整，无法确认工作范围。');
    }

    const points = [];
    for (let index = 0; index < element.points.length; index += 2) {
      points.push(
        turn(element.points[index]! - element.w / 2, element.points[index + 1]! - element.h / 2),
      );
    }

    return bounds(points, Number(element.strokeWidth ?? element.width ?? 3) / 2);
  }

  return bounds([
    turn(-element.w / 2, -element.h / 2),
    turn(element.w / 2, -element.h / 2),
    turn(element.w / 2, element.h / 2),
    turn(-element.w / 2, element.h / 2),
  ]);
}

function contains(outer: Rect, inner: Rect): boolean {
  const epsilon = 1e-7;

  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.w <= outer.x + outer.w + epsilon &&
    inner.y + inner.h <= outer.y + outer.h + epsilon
  );
}

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function scopeAreas(scope: AgentActivityScope, elements: readonly BoardElement[]): Rect[] {
  const ids = new Set(scope.ids ?? []);
  const areas = elements
    .filter((element) => ids.has(element.id))
    .map((element) => workspaceElementBounds(element, elements));

  if (scope.rect) {
    areas.push(scope.rect);
  }

  return areas;
}

function owns(
  scope: AgentActivityScope,
  element: BoardElement,
  elements: readonly BoardElement[],
): boolean {
  return (
    !!scope.ids?.includes(element.id) ||
    (!!scope.rect && contains(scope.rect, workspaceElementBounds(element, elements)))
  );
}

export function assertWorkspaceAvailable(
  scope: AgentActivityScope,
  actorId: string,
  others: readonly AgentWorkspace[],
  elements: readonly BoardElement[],
): void {
  const ids = new Set(scope.ids ?? []);
  const areas = scopeAreas(scope, elements);
  for (const other of others) {
    if (other.actorId === actorId) {
      continue;
    }

    const otherAreas = scopeAreas(other.task.scope, elements);
    if (
      (other.task.scope.ids ?? []).some((id) => ids.has(id)) ||
      areas.some((area) => otherAreas.some((otherArea) => overlaps(area, otherArea)))
    ) {
      throw new StudioError(
        'TASK_SCOPE_CONFLICT',
        '工作范围与另一位 Agent 的有效任务重叠，请先协调或结束原任务。',
        { taskId: other.task.taskId, actorId: other.actorId },
      );
    }
  }
}

export function workspaceReadRelated(
  scope: AgentActivityScope,
  elements: readonly BoardElement[],
  ids: readonly string[],
): boolean {
  return elements.some((element) => ids.includes(element.id) && owns(scope, element, elements));
}

function changesWholeBoard(
  before: WhiteboardContent,
  after: WhiteboardContent,
  operations: readonly Record<string, unknown>[],
): boolean {
  if (!same(before.style, after.style) || !same(before.motion, after.motion)) {
    return true;
  }

  return operations.some((operation) => {
    if (['style', 'motion'].includes(String(operation.op))) {
      return true;
    }

    return operation.op === 'restore' && operation.id === undefined && operation.ids === undefined;
  });
}

function restoresGlobalUnit(operation: Record<string, unknown>): boolean {
  if (operation.op !== 'restore') {
    return false;
  }
  if (String(operation.id ?? '').startsWith('$')) {
    return true;
  }

  const ids = operation.ids;

  return Array.isArray(ids) && ids.some((id) => typeof id === 'string' && id.startsWith('$'));
}

function changedArrowRoute(
  element: BoardElement,
  next: BoardElement | undefined,
  before: readonly BoardElement[],
  after: readonly BoardElement[],
): boolean {
  if (!next || element.type !== 'arrow' || next.type !== 'arrow') {
    return false;
  }

  return !same(arrowGeometry(element, before).points, arrowGeometry(next, after).points);
}

function assertReferencesOwned(
  previous: BoardElement | undefined,
  next: BoardElement | undefined,
  scope: AgentActivityScope,
  elements: readonly BoardElement[],
): void {
  if (!next) {
    return;
  }

  const sameReferences = previous?.parentId === next.parentId && previous?.groupId === next.groupId;
  if (previous && sameReferences) {
    return;
  }

  for (const referenced of elements) {
    const sharesGroup = next.groupId && referenced.groupId === next.groupId;
    const referencesPeer = sharesGroup && referenced.id !== next.id;
    if (referenced.id !== next.parentId && !referencesPeer) {
      continue;
    }
    if (!owns(scope, referenced, elements)) {
      throw new StudioError('TASK_SCOPE', '不能通过父分区或分组把工作范围连接到未授权对象。', {
        elementId: next.id,
        referenceId: referenced.id,
      });
    }
  }
}

export function assertWorkspaceMutation(
  before: WhiteboardContent,
  after: WhiteboardContent,
  operations: readonly Record<string, unknown>[],
  task: AgentTask,
  actorId: string,
  others: readonly AgentWorkspace[],
): void {
  assertWorkspaceAvailable(task.scope, actorId, others, before.elements);
  assertWorkspaceAvailable(task.scope, actorId, others, after.elements);
  const coversBoard = () =>
    before.elements.every((element) => owns(task.scope, element, before.elements)) &&
    after.elements.every((element) => owns(task.scope, element, after.elements));

  if (changesWholeBoard(before, after, operations) && (others.length || !coversBoard())) {
    throw new StudioError(
      'TASK_SCOPE',
      '整体样式、动画或整板恢复需要覆盖整块白板，且不能有其他有效任务。',
    );
  }

  const previousElements = new Map(before.elements.map((element) => [element.id, element]));
  const nextElements = new Map(after.elements.map((element) => [element.id, element]));
  const affected = new Set(
    [...previousElements.keys(), ...nextElements.keys()].filter(
      (id) => !same(previousElements.get(id), nextElements.get(id)),
    ),
  );

  for (const element of before.elements) {
    const next = nextElements.get(element.id);
    if (changedArrowRoute(element, next, before.elements, after.elements)) {
      affected.add(element.id);
    }
    if (next?.parentId && previousElements.has(next.parentId) && !nextElements.has(next.parentId)) {
      affected.add(next.id);
    }
  }

  for (const id of affected) {
    const previous = previousElements.get(id);
    const next = nextElements.get(id);
    const previousOutside = previous && !owns(task.scope, previous, before.elements);
    if (previousOutside || (next && !owns(task.scope, next, after.elements))) {
      throw new StudioError(
        'TASK_SCOPE',
        '本次修改超出已声明的工作对象或完整几何范围，请先结束并重新声明合适范围。',
        { elementId: id },
      );
    }

    assertReferencesOwned(previous, next, task.scope, after.elements);
  }

  if (operations.some(restoresGlobalUnit) && (others.length || !coversBoard())) {
    throw new StudioError('TASK_SCOPE', '恢复整体内容单元需要覆盖整块白板，且不能有其他有效任务。');
  }
}
