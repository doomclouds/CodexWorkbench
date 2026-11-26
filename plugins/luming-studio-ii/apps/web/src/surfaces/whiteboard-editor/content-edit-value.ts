import type { WhiteboardJson } from '../../data/whiteboard/index.js';

export const maxContentTreeDepth = 64;

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function list(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isJson(value: unknown, depth = 0): value is WhiteboardJson {
  if (depth >= maxContentTreeDepth) {
    return false;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (list(value)) {
    return value.every((item) => isJson(item, depth + 1));
  }

  return record(value) && Object.values(value).every((item) => isJson(item, depth + 1));
}
