import type { WhiteboardObject, WhiteboardPayload, WhiteboardPayloadResult } from './contracts.js';

export interface PayloadRequest {
  readonly id: string;
  readonly version: bigint;
}

interface CachedPayload {
  readonly version: bigint;
  readonly payload?: WhiteboardPayload;
}

export type PayloadCache = ReadonlyMap<string, CachedPayload>;

const batchLimit = 48;
const cacheLimit = 256;
const inlineTextKinds = new Set(['text', 'note', 'shape', 'section', 'connector']);

export function missingPayloads(
  visible: readonly string[],
  objects: ReadonlyMap<string, WhiteboardObject>,
  cache: PayloadCache,
): readonly PayloadRequest[] {
  const requests: PayloadRequest[] = [];
  for (const id of visible) {
    const version = objects.get(id)?.payloadVersion;
    const cached = cache.get(id);

    if (version === undefined || (cached && cached.version >= version)) {
      continue;
    }

    requests.push({ id, version });
    if (requests.length === batchLimit) {
      break;
    }
  }

  return requests;
}

function cachePayload(
  result: WhiteboardPayloadResult,
  requested: ReadonlyMap<string, bigint>,
  objects: ReadonlyMap<string, WhiteboardObject>,
): CachedPayload | undefined {
  const id = result.kind === 'loaded' ? result.payload.id : result.id;
  const version = requested.get(id);
  const current = objects.get(id)?.payloadVersion;
  if (version === undefined || current === undefined) {
    return undefined;
  }
  if (result.kind === 'unavailable') {
    return current === version ? { version } : undefined;
  }
  if (result.payload.version >= current) {
    return { version: result.payload.version, payload: result.payload };
  }
  if (current > version) {
    return undefined;
  }

  throw new Error('服务返回了旧版对象正文。');
}

export function mergePayloadCache(
  cache: PayloadCache,
  visible: readonly string[],
  objects: ReadonlyMap<string, WhiteboardObject>,
  requests: readonly PayloadRequest[],
  results: readonly WhiteboardPayloadResult[],
): PayloadCache {
  const requested = new Map(requests.map(({ id, version }) => [id, version]));
  const next = new Map(cache);
  for (const result of results) {
    const cached = cachePayload(result, requested, objects);
    if (cached) {
      const id = result.kind === 'loaded' ? result.payload.id : result.id;
      next.delete(id);
      next.set(id, cached);
    }
  }

  const retained = new Set(visible);
  for (const id of next.keys()) {
    if (next.size <= cacheLimit) {
      break;
    }

    if (!retained.has(id)) {
      next.delete(id);
    }
  }

  return next;
}

function retainWhileRefreshing(object: WhiteboardObject, payload: WhiteboardPayload) {
  const { kind } = payload.body;
  if (kind === 'text') {
    return inlineTextKinds.has(object.kind);
  }

  return (kind === 'document' || kind === 'table') && kind === object.kind;
}

export function visiblePayloads(
  cache: PayloadCache,
  objects: ReadonlyMap<string, WhiteboardObject>,
): ReadonlyMap<string, WhiteboardPayload> {
  const projected = new Map<string, WhiteboardPayload>();
  for (const [id, { payload, version: cachedVersion }] of cache) {
    const object = objects.get(id);
    const version = object?.payloadVersion;
    if (!payload || !object || version === undefined) {
      continue;
    }

    if (cachedVersion >= version || retainWhileRefreshing(object, payload)) {
      projected.set(id, payload);
    }
  }

  return projected;
}
