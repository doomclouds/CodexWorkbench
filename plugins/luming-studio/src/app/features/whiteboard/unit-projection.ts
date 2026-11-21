import type {
  Board,
  BoardElement,
  StudioEvent,
  StudioUnitEvent,
  StudioUnitPatch,
} from '../../../contracts/studio.js';

function remoteRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasFiniteBounds(element: BoardElement) {
  return [element.x, element.y, element.w, element.h].every(Number.isFinite);
}

function replacesElementVersion(current: BoardElement, patch: StudioUnitPatch) {
  const { baseVersion, version } = patch;
  const matchesBase =
    Number.isSafeInteger(baseVersion) && baseVersion >= 1 && current.version === baseVersion;

  return matchesBase && Number.isSafeInteger(version) && version > baseVersion;
}

function applyRemoteElementPatch(elements: BoardElement[], id: string, patch?: StudioUnitPatch) {
  if (id.startsWith('$') || !patch) {
    return false;
  }

  const index = elements.findIndex((element) => element.id === id);
  const current = elements[index];
  if (!current || !replacesElementVersion(current, patch)) {
    return false;
  }

  const { changes, removedKeys } = patch;
  if (!remoteRecord(changes) || !Array.isArray(removedKeys)) {
    return false;
  }

  const reserved = ['id', 'type', 'version'];
  if (Object.keys(changes).some((key) => reserved.includes(key))) {
    return false;
  }
  if (
    removedKeys.some(
      (key) => typeof key !== 'string' || reserved.includes(key) || Object.hasOwn(changes, key),
    )
  ) {
    return false;
  }

  const next: BoardElement = { ...current, ...changes, version: patch.version };
  for (const key of removedKeys) {
    delete next[key];
  }
  if (!hasFiniteBounds(next) || next.w < 0 || next.h < 0) {
    return false;
  }

  elements[index] = next;
  return true;
}

function applyRemoteElementSnapshot(
  projection: WhiteboardProjection,
  id: string,
  snapshot: unknown,
): boolean {
  const { elements } = projection;
  if (snapshot === null) {
    projection.elements = elements.filter((element) => element.id !== id);
    return true;
  }
  const element = snapshot as BoardElement | undefined;
  if (!element || element.id !== id || typeof element.type !== 'string') {
    return false;
  }
  if (!Number.isSafeInteger(element.version) || !hasFiniteBounds(element)) {
    return false;
  }

  const index = elements.findIndex((element) => element.id === id);
  if (index >= 0) {
    elements[index] = element;
  } else {
    elements.push(element);
  }
  return true;
}

function readRemoteOrder(value: unknown) {
  const next = value as { ids?: unknown; version?: unknown } | null;
  if (!next || !Array.isArray(next.ids) || !next.ids.every((id) => typeof id === 'string')) {
    return;
  }
  if (!Number.isSafeInteger(next.version)) {
    return;
  }

  return { ids: next.ids as string[], version: Number(next.version) };
}

interface WhiteboardProjection {
  elements: BoardElement[];
  style: Board['style'];
  motion: Board['motion'];
  orderVersion: Board['orderVersion'];
  order?: string[];
}

function applyRemoteUnit(projection: WhiteboardProjection, unit: StudioUnitEvent) {
  if ('patch' in unit) {
    return applyRemoteElementPatch(projection.elements, unit.id, unit.patch);
  }

  switch (unit.id) {
    case '$style':
      if (!remoteRecord(unit.after)) {
        return false;
      }

      projection.style = unit.after as Board['style'];
      return true;
    case '$motion':
      if (unit.after !== null && !remoteRecord(unit.after)) {
        return false;
      }

      projection.motion = (unit.after as Board['motion']) ?? undefined;
      return true;
    case '$order': {
      const order = readRemoteOrder(unit.after);
      if (!order) {
        return false;
      }

      projection.order = order.ids;
      projection.orderVersion = order.version;
      return true;
    }
    default:
      return (
        !unit.id.startsWith('$') && applyRemoteElementSnapshot(projection, unit.id, unit.after)
      );
  }
}

function reorderRemoteElements(elements: BoardElement[], order: string[]) {
  if (new Set(order).size !== order.length || order.length !== elements.length) {
    return;
  }

  const byId = new Map(elements.map((element) => [element.id, element]));
  if (order.some((id) => !byId.has(id))) {
    return;
  }

  return order.map((id) => byId.get(id)!);
}

export function applyWhiteboardRemoteEvent(board: Board, event: StudioEvent): Board | undefined {
  const { artifact, units, revision } = event;
  if (!artifact || revision !== board.artifact.revision + 1 || artifact.revision !== revision) {
    return;
  }
  if (event.artifactId !== board.artifact.id || !Array.isArray(units) || !units.length) {
    return;
  }

  const projection: WhiteboardProjection = {
    elements: [...board.elements],
    style: board.style,
    motion: board.motion,
    orderVersion: board.orderVersion,
  };

  for (const unit of units) {
    if (!applyRemoteUnit(projection, unit)) {
      return;
    }
  }
  const { order, style, motion, orderVersion } = projection;
  const elements = order ? reorderRemoteElements(projection.elements, order) : projection.elements;
  if (elements) {
    return { ...board, artifact, elements, style, motion, orderVersion };
  }
}
