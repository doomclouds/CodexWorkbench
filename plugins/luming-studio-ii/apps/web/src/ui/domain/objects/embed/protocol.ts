import type {
  EmbedJson as Json,
  EmbedNavigationEvent as HtmlNavigationEvent,
  EmbedRuntimeOptions,
  EmbedSelection as HtmlSelection,
} from './contracts.js';
import { isEmbedJson } from './state.js';

interface HtmlFramePoint {
  x: number;
  y: number;
}
type HtmlFrameIdentity = Pick<EmbedRuntimeOptions, 'channel' | 'regionId' | 'sourceRevision'>;

export function readAuthenticatedFrameMessage(value: unknown, expected: HtmlFrameIdentity) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Record<string, unknown>;
  const sameFrame =
    input.channel === expected.channel &&
    input.regionId === expected.regionId &&
    input.sourceRevision === expected.sourceRevision;

  return sameFrame ? input : null;
}

function readFrameMessage(value: unknown, expected: HtmlFrameIdentity, type: string) {
  const input = readAuthenticatedFrameMessage(value, expected);

  return input?.type === type ? input : null;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function readPoint(value: unknown, minimum: number, maximum: number): HtmlFramePoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const { x, y } = value as Record<string, unknown>;
  if (!finiteInRange(x, minimum, maximum) || !finiteInRange(y, minimum, maximum)) {
    return null;
  }

  return { x, y };
}

function readPan(input: Record<string, unknown>): HtmlNavigationEvent | null {
  const { phase, pointerId, screenX, screenY } = input;
  const hasPhase = ['start', 'move', 'end', 'cancel'].includes(String(phase));
  const validPointer =
    typeof pointerId === 'number' && Number.isSafeInteger(pointerId) && pointerId >= 0;

  if (!hasPhase || !validPointer) {
    return null;
  }
  if (!finiteInRange(screenX, -1e7, 1e7) || !finiteInRange(screenY, -1e7, 1e7)) {
    return null;
  }

  return {
    kind: 'pan',
    phase: phase as 'start' | 'move' | 'end' | 'cancel',
    pointerId,
    screenX,
    screenY,
  };
}

function readZoom(input: Record<string, unknown>): HtmlNavigationEvent | null {
  const point = readPoint(input, 0, 1);
  const { deltaY, deltaMode } = input;
  if (!point || !finiteInRange(deltaY, -1e7, 1e7) || ![0, 1, 2].includes(deltaMode as number)) {
    return null;
  }

  return { kind: 'zoom', ...point, deltaY, deltaMode: deltaMode as number };
}

export function validateHtmlNavigationMessage(
  value: unknown,
  expected: HtmlFrameIdentity,
): HtmlNavigationEvent | null {
  const input = readFrameMessage(value, expected, 'studio-html-navigation');
  switch (input?.kind) {
    case 'space':
      return typeof input.held === 'boolean' ? { kind: 'space', held: input.held } : null;
    case 'pan':
      return readPan(input);
    case 'zoom':
      return readZoom(input);
    default:
      return null;
  }
}

export type HtmlFrameSelection = HtmlSelection & { point?: HtmlFramePoint };

const invalidTargetCharacter = /\p{Cc}/u;

function readSelectionRect(value: unknown): NonNullable<HtmlSelection['rect']> | null {
  const origin = readPoint(value, -1e7, 1e7);
  if (!origin) {
    return null;
  }

  const { w, h } = value as Record<string, unknown>;
  if (!finiteInRange(w, 0, 1e7) || !finiteInRange(h, 0, 1e7)) {
    return null;
  }

  return { ...origin, w, h };
}

function isSelectionText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isTargetId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 192) {
    return false;
  }

  return Boolean(value.trim()) && !invalidTargetCharacter.test(value);
}

export function validateHtmlAnnotationLocations(
  value: unknown,
  expected: HtmlFrameIdentity,
  sequence: number,
  requestedIds: ReadonlySet<string>,
): ReadonlyMap<string, HtmlFramePoint | null> | null {
  const input = readFrameMessage(value, expected, 'studio-html-annotation-locations');
  const points = input?.points;
  if (input?.sequence !== sequence || !Array.isArray(points) || points.length > requestedIds.size) {
    return null;
  }

  const locations = new Map<string, HtmlFramePoint | null>();
  for (const raw of points) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const { id, point } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !requestedIds.has(id) || locations.has(id)) {
      return null;
    }

    const position = readPoint(point, 0, 1);
    if (point !== null && !position) {
      return null;
    }

    locations.set(id, position);
  }

  return locations;
}

export function validateHtmlSelectionMessage(
  value: unknown,
  expected: HtmlFrameIdentity,
  annotationTargets?: ReadonlySet<string>,
): HtmlFrameSelection | null {
  const input = readFrameMessage(value, expected, 'studio-html-selection');
  if (!input) {
    return null;
  }
  if (
    !Array.isArray(input.targetIds) ||
    input.targetIds.length > 64 ||
    !input.targetIds.every(isTargetId)
  ) {
    return null;
  }

  const targetIds = new Set(input.targetIds as string[]);
  if (targetIds.size !== input.targetIds.length) {
    return null;
  }
  if (annotationTargets && [...targetIds].some((id) => !annotationTargets.has(id))) {
    return null;
  }

  const { quote, excerpt, selector } = input;
  if (!isSelectionText(quote, 4000) || !isSelectionText(excerpt, 16000)) {
    return null;
  }
  if (selector !== undefined && !isSelectionText(selector, 1200)) {
    return null;
  }

  const point = input.point === undefined ? undefined : readPoint(input.point, -1e7, 1e7);
  const rect = input.rect === undefined ? undefined : readSelectionRect(input.rect);
  if (point === null || rect === null) {
    return null;
  }

  return {
    regionId: expected.regionId,
    sourceRevision: expected.sourceRevision,
    targetIds: [...targetIds],
    quote,
    excerpt,
    ...(selector !== undefined ? { selector } : {}),
    ...(rect ? { rect } : {}),
    ...(point ? { point } : {}),
  };
}

export interface HtmlScrollPosition {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}

export interface HtmlPointerPosition {
  x: number;
  y: number;
}

export function validateHtmlPointerMessage(
  value: unknown,
  expected: HtmlFrameIdentity,
): { point: HtmlPointerPosition | null } | null {
  const input = readFrameMessage(value, expected, 'studio-html-pointer');
  if (!input) {
    return null;
  }
  if (input.point === null) {
    return { point: null };
  }

  const point = readPoint(input.point, 0, 1);
  return point ? { point } : null;
}

export function validateHtmlScrollMessage(
  value: unknown,
  expected: HtmlFrameIdentity,
): HtmlScrollPosition | null {
  const input = readFrameMessage(value, expected, 'studio-html-scroll');
  if (!input) {
    return null;
  }
  if (!['x', 'y', 'maxX', 'maxY'].every((key) => finiteInRange(input[key], 0, 1e7))) {
    return null;
  }

  const position = {
    x: input.x as number,
    y: input.y as number,
    maxX: input.maxX as number,
    maxY: input.maxY as number,
  };

  return position.x <= position.maxX && position.y <= position.maxY ? position : null;
}

export interface HtmlStateSave {
  state: Json;
  baseVersion: number;
  saveId: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function validateHtmlStateMessage(
  value: unknown,
  expected: HtmlFrameIdentity,
): HtmlStateSave | null {
  const input = readFrameMessage(value, expected, 'studio-html-state');
  if (!input) {
    return null;
  }

  const { baseVersion, saveId } = input;
  const validVersion =
    typeof baseVersion === 'number' && Number.isSafeInteger(baseVersion) && baseVersion >= 0;

  if (!validVersion || !isPositiveInteger(saveId)) {
    return null;
  }
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) {
    return null;
  }

  try {
    const encoded = JSON.stringify(input.state);
    if (new TextEncoder().encode(encoded).byteLength > 65536) {
      return null;
    }
    if (!isEmbedJson(input.state)) {
      return null;
    }

    return {
      state: JSON.parse(encoded) as Json,
      baseVersion,
      saveId,
    };
  } catch (error) {
    const invalidJson =
      error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError;

    if (!invalidJson) {
      console.error('无法读取嵌入状态。', error);
    }
    return null;
  }
}
