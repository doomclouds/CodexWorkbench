import type { CatalogPosition, CatalogScope } from '../domain/index.js';

const cursorVersion = 1;
const maxCursorLength = 4_096;
const maxTimestamp = 9_223_372_036_854_775_807n;
const decimalTimestamp = /^(?:0|[1-9][0-9]{0,18})$/u;

export class CatalogQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogQueryError';
  }
}

function cursorRecord(cursor: string): Record<string, unknown> {
  if (cursor.length > maxCursorLength) {
    throw new CatalogQueryError('The catalog cursor is too long.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(cursor);
  } catch (cause) {
    throw new CatalogQueryError('The catalog cursor is malformed.', { cause });
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new CatalogQueryError('The catalog cursor is malformed.');
  }

  return decoded as Record<string, unknown>;
}

function cursorTimestamp(value: unknown): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !decimalTimestamp.test(value)) {
    throw new CatalogQueryError('The catalog cursor timestamp is invalid.');
  }

  const timestamp = BigInt(value);
  if (timestamp > maxTimestamp) {
    throw new CatalogQueryError('The catalog cursor timestamp is out of range.');
  }

  return timestamp;
}

export function readCatalogCursor(cursor: string, scope: CatalogScope): CatalogPosition {
  const values = cursorRecord(cursor);
  if (values.version !== cursorVersion || values.actorId !== scope.actorId) {
    throw new CatalogQueryError('The catalog cursor is invalid for this actor.');
  }
  if (values.query !== scope.query || values.order !== scope.order || values.view !== scope.view) {
    throw new CatalogQueryError('The catalog cursor belongs to another query.');
  }
  if (values.pinnedOnly !== (scope.pinnedOnly ? true : undefined)) {
    throw new CatalogQueryError('The catalog cursor belongs to another pin filter.');
  }

  const { boardId, title, pinned, updatedAtMillis } = values;
  if (typeof boardId !== 'string' || !boardId) {
    throw new CatalogQueryError('The catalog cursor board id is invalid.');
  }
  if (typeof title !== 'string' || typeof pinned !== 'boolean') {
    throw new CatalogQueryError('The catalog cursor position is invalid.');
  }

  const position = { boardId, title, pinned, updatedAtMillis: cursorTimestamp(updatedAtMillis) };
  if (scope.view !== 'trash') {
    return position;
  }

  const trashedAtMillis = cursorTimestamp(values.trashedAtMillis);
  if (trashedAtMillis === undefined) {
    throw new CatalogQueryError('The trash cursor timestamp is missing.');
  }

  return { ...position, trashedAtMillis };
}

export function writeCatalogCursor(scope: CatalogScope, position: CatalogPosition): string {
  const { actorId, query, order, view, pinnedOnly } = scope;
  const { boardId, title, pinned, updatedAtMillis, trashedAtMillis } = position;

  return JSON.stringify({
    version: cursorVersion,
    actorId,
    query,
    order,
    view,
    pinnedOnly: pinnedOnly ? true : undefined,
    boardId,
    title,
    pinned,
    updatedAtMillis: updatedAtMillis?.toString(),
    trashedAtMillis: trashedAtMillis?.toString(),
  });
}
