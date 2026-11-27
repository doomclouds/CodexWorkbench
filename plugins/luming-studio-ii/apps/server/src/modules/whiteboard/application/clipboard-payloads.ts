import type {
  BoardEditAsset,
  BoardEditRejection,
  JsonObject,
  JsonValue,
  PayloadRecord,
} from '../domain/index.js';
import type { BoardEditWriter } from '../ports/index.js';

interface ClipboardResources {
  readonly sourceBoardId: string;
  readonly destinationBoardId: string;
  readonly assetNamespace: string;
  readonly ids: ReadonlyMap<string, string>;
  readonly writer: BoardEditWriter;
  readonly availableBytes: number;
}

interface CopiedPayloads {
  readonly payloads: readonly PayloadRecord[];
  readonly assets: readonly BoardEditAsset[];
}

const assetPrefix = '/studio-archive-assets/';
const assetPattern =
  /(?<![\w:/-])\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})(?![A-Za-z0-9_-])/gu;
const assetKinds = new Set(['image', 'video', 'link', 'document', 'embed']);
const maxDepth = 80;
const uriFields = new Set(['src', 'href', 'url', 'poster']);

class ClipboardDataError extends Error {
  constructor(readonly reason: BoardEditRejection) {
    super('Clipboard data could not be copied');
  }
}

function propertyValue(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function makeAssetResolver(scope: ClipboardResources) {
  const mapped = new Map<string, BoardEditAsset>();
  let budget = scope.availableBytes;

  function resolve(value: string): string {
    return value.replace(assetPattern, (_path, boardId: string, sourceId: string) => {
      if (boardId !== scope.sourceBoardId) {
        throw new ClipboardDataError('invalidEdit');
      }

      const found = mapped.get(sourceId);
      if (found) {
        return assetPrefix + scope.destinationBoardId + '/' + found.assetId;
      }

      const read = scope.writer.getExportAsset?.(boardId, sourceId, budget);
      if (!read) {
        throw new ClipboardDataError('objectNotFound');
      }
      if (read.kind === 'tooLarge') {
        throw new ClipboardDataError('tooLarge');
      }

      const assetId = 'paste-' + scope.assetNamespace + '-' + mapped.size;
      const bytes = Uint8Array.from(atob(read.asset.base64), (value) => value.charCodeAt(0));
      if (bytes.byteLength !== read.asset.byteLength || bytes.byteLength > budget) {
        throw new ClipboardDataError('tooLarge');
      }

      budget -= bytes.byteLength;
      mapped.set(sourceId, { assetId, mimeType: read.asset.mimeType, bytes });

      return assetPrefix + scope.destinationBoardId + '/' + assetId;
    });
  }

  return { resolve, assets: () => [...mapped.values()] };
}

function rebindAssets(value: JsonValue, resolve: (value: string) => string, depth = 0): JsonValue {
  if (depth >= maxDepth) {
    throw new ClipboardDataError('tooLarge');
  }
  if (typeof value === 'string') {
    return resolve(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rebindAssets(entry, resolve, depth + 1));
  }

  const record = propertyValue(value);

  return record
    ? Object.fromEntries(
        Object.entries(record).map(([key, child]) => [
          key,
          rebindAssets(child, resolve, depth + 1),
        ]),
      )
    : value;
}

function rebindMediaFields(
  value: JsonValue,
  resolve: (value: string) => string,
  depth = 0,
): JsonValue {
  if (depth >= maxDepth) {
    throw new ClipboardDataError('tooLarge');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rebindMediaFields(entry, resolve, depth + 1));
  }

  const record = propertyValue(value);
  if (!record) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => {
      const reference =
        typeof child === 'string' && uriFields.has(key) && child.startsWith(assetPrefix);

      return [key, reference ? resolve(child) : rebindMediaFields(child, resolve, depth + 1)];
    }),
  );
}

function rebindEmbed(data: JsonObject, resolve: (value: string) => string): JsonObject {
  const copy = { ...data };
  if (typeof data.html === 'string') {
    copy.html = resolve(data.html);
  }
  if (data.state !== undefined) {
    copy.state = rebindAssets(data.state, resolve);
  }

  return copy;
}

function todoSource(source: JsonObject, scope: ClipboardResources): JsonObject {
  const { boardId, objectId } = source;
  const currentBoard = boardId === undefined || boardId === scope.sourceBoardId;
  if (!currentBoard || typeof objectId !== 'string') {
    return source;
  }

  const copied = scope.ids.get(objectId);

  return copied === undefined
    ? { ...source, boardId: scope.sourceBoardId }
    : { ...source, boardId: scope.destinationBoardId, objectId: copied, version: '0' };
}

function rebindTodos(data: JsonObject, scope: ClipboardResources): JsonObject {
  if (!Array.isArray(data.items)) {
    return data;
  }

  const items = data.items.map((entry) => {
    const item = propertyValue(entry);
    const source = propertyValue(item?.sourceRef);

    return item && source ? { ...item, sourceRef: todoSource(source, scope) } : entry;
  });

  return { ...data, items };
}

function payloadData(
  payload: PayloadRecord,
  scope: ClipboardResources,
  resolve: (value: string) => string,
): JsonObject {
  const { data, bodyKind } = payload;
  if (bodyKind === 'todo') {
    return rebindTodos(data, scope);
  }
  if (!assetKinds.has(bodyKind) || scope.sourceBoardId === scope.destinationBoardId) {
    return data;
  }
  if (bodyKind === 'embed') {
    return rebindEmbed(data, resolve);
  }

  const resolved = propertyValue(rebindMediaFields(data, resolve));
  if (!resolved) {
    throw new ClipboardDataError('invalidEdit');
  }

  return resolved;
}

export function clipboardPayloads(
  bodies: readonly PayloadRecord[],
  scope: ClipboardResources,
): CopiedPayloads | BoardEditRejection {
  const references = makeAssetResolver(scope);
  const payloads: PayloadRecord[] = [];
  try {
    for (const payload of bodies) {
      const objectId = scope.ids.get(payload.objectId);
      if (!objectId) {
        return 'invalidEdit';
      }

      payloads.push({
        ...payload,
        objectId,
        payloadVersion: 0n,
        data: payloadData(payload, scope, references.resolve),
      });
    }
  } catch (error) {
    if (error instanceof ClipboardDataError) {
      return error.reason;
    }

    throw error;
  }

  return { payloads, assets: references.assets() };
}
