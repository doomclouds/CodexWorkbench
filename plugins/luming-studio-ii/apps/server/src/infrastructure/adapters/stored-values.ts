import type { JsonObject } from '../../modules/whiteboard/ports/index.js';

const maxSqliteInteger = 9_223_372_036_854_775_807n;
const versionPattern = /^(?:0|[1-9][0-9]{0,18})$/u;

export function storedText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid stored text for ${field}.`);
  }

  return value;
}

export function storedNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid stored number for ${field}.`);
  }

  return value;
}

export function storedBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid stored boolean for ${field}.`);
  }

  return value;
}

export function storedSqliteBool(value: unknown, field: string): boolean {
  if (value !== 0n && value !== 1n) {
    throw new Error(`Invalid stored SQLite boolean for ${field}.`);
  }

  return value === 1n;
}

export function storedVersion(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > maxSqliteInteger) {
    throw new Error(`Invalid stored version for ${field}.`);
  }

  return value;
}

export function storedDecimalVersion(value: unknown, field: string): bigint {
  const text = storedText(value, field);
  if (!versionPattern.test(text)) {
    throw new Error(`Invalid stored decimal version for ${field}.`);
  }

  return storedVersion(BigInt(text), field);
}

export function storedRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid stored object for ${field}.`);
  }

  return value as Record<string, unknown>;
}

export function storedArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid stored array for ${field}.`);
  }

  return value;
}

export function decodeJson(text: unknown, field: string): unknown {
  return JSON.parse(storedText(text, field), (_key, value: unknown) =>
    typeof value === 'number' ? storedNumber(value, field) : value,
  );
}

export function decodePayload(text: unknown): JsonObject {
  return storedRecord(decodeJson(text, 'body_json'), 'body_json') as JsonObject;
}
