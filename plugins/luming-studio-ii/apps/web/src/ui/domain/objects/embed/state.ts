import type { EmbedJson as Json } from './contracts.js';

export function isEmbedJson(value: unknown, depth = 0): value is Json {
  if (depth > 16) {
    return false;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((child: unknown) => isEmbedJson(child, depth + 1));
  }

  return Boolean(
    value &&
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Object]' &&
    Object.values(value).every((child: unknown) => isEmbedJson(child, depth + 1)),
  );
}

export function rebaseHtmlState(
  base: Json,
  local: Json,
  accepted: Json,
): { state: Json; conflicted: boolean } {
  let conflicted = false;
  const isRecord = (value: Json | undefined): value is Record<string, Json> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const replay = (
    before: Json | undefined,
    after: Json | undefined,
    current: Json | undefined,
  ): Json | undefined => {
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return current;
    }
    if (
      JSON.stringify(after) === JSON.stringify(current) ||
      JSON.stringify(before) === JSON.stringify(current)
    ) {
      return after;
    }
    if (isRecord(before) && isRecord(after) && isRecord(current)) {
      return Object.fromEntries(
        [
          ...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(current)]),
        ].flatMap((key) => {
          const value = replay(
            Object.hasOwn(before, key) ? before[key] : undefined,
            Object.hasOwn(after, key) ? after[key] : undefined,
            Object.hasOwn(current, key) ? current[key] : undefined,
          );

          return value === undefined ? [] : [[key, value]];
        }),
      );
    }

    conflicted = true;
    return after;
  };
  const state = replay(base, local, accepted) ?? null;
  return { state, conflicted };
}
