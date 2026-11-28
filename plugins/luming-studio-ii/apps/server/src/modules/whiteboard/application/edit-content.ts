import {
  canAdvanceVersion,
  editDocumentContent,
  editEmbedSource,
  editEmbedState,
  editImageCrop,
  editLinkContent,
  editStickerContent,
  editTableContent,
  editTextContent,
  editTodoContent,
  geometryInWorld,
  type BoardEditDecision,
  type BoardEditRejected,
  type BoardHeader,
  type BoardObject,
  type ContentOperation,
  type JsonObject,
  type JsonValue,
  type PayloadRecord,
  type TodoContentSource,
} from '../domain/index.js';
import type { BoardEditPlanningReader } from '../ports/index.js';
import { planGeometryEdit } from './edit-geometry.js';

const stableId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const sourceVersionPattern = /^(?:0|[1-9]\d{0,18})$/u;
const maxSourceVersion = (1n << 63n) - 1n;

interface ContentEditScope {
  readonly writer: BoardEditPlanningReader;
  readonly boardId: string;
  readonly object: BoardObject;
  readonly current: PayloadRecord;
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasBlock(blocks: JsonValue | undefined, blockId: string): boolean {
  const pending: JsonValue[] = Array.isArray(blocks) ? [...blocks] : [];
  while (pending.length) {
    const block = pending.pop();
    if (!isRecord(block)) {
      continue;
    }
    if (block.blockId === blockId) {
      return true;
    }

    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        pending.push(child);
      }
    }
  }

  return false;
}

function validSourceVersion(version: string | undefined): boolean {
  return (
    version === undefined ||
    (sourceVersionPattern.test(version) && BigInt(version) <= maxSourceVersion)
  );
}

function optionalStableId(value: string | undefined): boolean {
  return value === undefined || stableId.test(value);
}

function resolveSourceLocation(
  writer: BoardEditPlanningReader,
  boardId: string,
  { objectId, blockId, itemId }: TodoContentSource,
): boolean {
  if (blockId === undefined && itemId === undefined) {
    return writer.getObjects(boardId, [objectId]).length === 1;
  }

  const [payload] = writer.getPayloads(boardId, [objectId]);
  if (!payload) {
    return false;
  }
  if (blockId !== undefined) {
    return payload.bodyKind === 'document' && hasBlock(payload.data.blocks, blockId);
  }

  const { items } = payload.data;

  return (
    payload.bodyKind === 'todo' &&
    Array.isArray(items) &&
    items.some((row) => isRecord(row) && row.itemId === itemId)
  );
}

function validTodoSource(
  writer: BoardEditPlanningReader,
  boardId: string,
  source: TodoContentSource,
) {
  const { boardId: owner, objectId, blockId, itemId, version } = source;
  const sameBoard = owner === undefined || owner === boardId;
  const validIds = [objectId, blockId, itemId].every(optionalStableId);
  const unambiguous = blockId === undefined || itemId === undefined;
  if (!sameBoard || !validIds || !unambiguous) {
    return false;
  }
  if (!validSourceVersion(version)) {
    return false;
  }

  return resolveSourceLocation(writer, boardId, source);
}

function contentKinds(kind: ContentOperation['kind']) {
  switch (kind) {
    case 'embedSource':
    case 'embedState':
      return { objectKind: 'html', bodyKind: 'embed' };
    case 'crop':
      return { objectKind: 'image', bodyKind: 'image' };
    case 'document':
    case 'link':
    case 'sticker':
    case 'table':
    case 'text':
    case 'todo':
      return { objectKind: kind, bodyKind: kind };
  }
}

function objectTakesContent(kind: string, expected: string) {
  return (
    kind === expected ||
    (expected === 'text' && textObjects.has(kind)) ||
    (expected === 'html' && kind === 'diagram')
  );
}

const textObjects = new Set(['note', 'shape', 'section', 'connector']);

function contentGeometryLocked(
  writer: BoardEditPlanningReader,
  boardId: string,
  object: BoardObject,
) {
  const visited = new Set<string>();
  let candidate: BoardObject | undefined = object;
  while (candidate) {
    if (candidate.locked || visited.has(candidate.objectId)) {
      return true;
    }

    visited.add(candidate.objectId);
    const parentId: string | undefined = candidate.parentId;
    candidate = parentId === undefined ? undefined : writer.getObjects(boardId, [parentId])[0];
  }

  return false;
}

function assetLookup(writer: BoardEditPlanningReader, boardId: string) {
  const checked = new Map<string, boolean>();

  return (assetId: string) => {
    const current = checked.get(assetId);
    if (current !== undefined) {
      return current;
    }

    const found = writer.getExportAsset?.(boardId, assetId, 0) !== undefined;
    checked.set(assetId, found);

    return found;
  };
}

function updatedPayload(
  { writer, boardId, object, current }: ContentEditScope,
  operation: ContentOperation,
) {
  switch (operation.kind) {
    case 'document':
      return editDocumentContent(operation.data, current.data, {
        boardId,
        hasAsset: assetLookup(writer, boardId),
      });
    case 'todo':
      return editTodoContent(current.data, operation.edits, (source) =>
        validTodoSource(writer, boardId, source),
      );
    case 'text':
      return editTextContent(operation.data, current.data);
    case 'table':
      return editTableContent(
        object,
        current.data,
        operation,
        contentGeometryLocked(writer, boardId, object),
      );
    case 'embedSource':
      return editEmbedSource(current, operation);
    case 'embedState':
      return editEmbedState(current, object.label, operation.state);
    case 'sticker':
      return editStickerContent(current.data, operation.selection);
    case 'link':
      return editLinkContent(operation.title, operation.href);
    case 'crop':
      return editImageCrop(current.data, object.label, operation, {
        boardId,
        hasAsset: assetLookup(writer, boardId),
      });
  }
}

function contentVersionConflict(
  board: BoardHeader,
  object: BoardObject,
  current: PayloadRecord,
): BoardEditDecision {
  return {
    kind: 'conflict',
    boardRevision: board.revision,
    objects: [object],
    payloads: [current],
  };
}

function withTableFrame(
  { writer, boardId, object }: ContentEditScope,
  width: number | undefined,
  height: number | undefined,
  requiresUnlock: boolean,
): BoardObject | BoardEditRejected {
  if (requiresUnlock && contentGeometryLocked(writer, boardId, object)) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (!canAdvanceVersion(object.geometryVersion)) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  const geometry = {
    ...object.geometry,
    width: width ?? object.geometry.width,
    height: height ?? object.geometry.height,
  };

  if (!geometryInWorld(geometry)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  return { ...object, geometry, geometryVersion: object.geometryVersion + 1n };
}

function clearStandaloneText(
  writer: BoardEditPlanningReader,
  board: BoardHeader,
  object: BoardObject,
  text: JsonValue | undefined,
) {
  const isEmpty = typeof text === 'string' && !text.trim();
  if (object.kind !== 'text' || !isEmpty) {
    return { kind: 'rejected' as const, reason: 'invalidEdit' as const };
  }

  return planGeometryEdit(writer, board, {
    kind: 'delete',
    targets: [{ objectId: object.objectId, expectedGeometryVersion: object.geometryVersion }],
  });
}

export function planContentEdit(
  writer: BoardEditPlanningReader,
  board: BoardHeader,
  operation: ContentOperation,
): BoardEditDecision {
  const { boardId } = board;
  const { objectId, expectedPayloadVersion } = operation;
  const [object] = writer.getObjects(boardId, [objectId]);
  if (!object) {
    return { kind: 'rejected', reason: 'objectNotFound' };
  }

  const { objectKind, bodyKind } = contentKinds(operation.kind);
  if (!objectTakesContent(object.kind, objectKind)) {
    return { kind: 'rejected', reason: 'unsupportedKind' };
  }

  const [current] = writer.getPayloads(boardId, [objectId]);
  if (!current || current.bodyKind !== bodyKind) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (current.payloadVersion !== expectedPayloadVersion) {
    return contentVersionConflict(board, object, current);
  }
  if (!canAdvanceVersion(current.payloadVersion) || !canAdvanceVersion(board.revision)) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (operation.kind === 'text' && operation.deleteEmpty) {
    return clearStandaloneText(writer, board, object, operation.data.text);
  }

  const editingIcon = operation.kind === 'sticker' && operation.selection.kind === 'icon';
  const needsUnlockedObject = editingIcon || operation.kind === 'crop';
  if (needsUnlockedObject && contentGeometryLocked(writer, boardId, object)) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }

  const scope = { writer, boardId, object, current };
  const planned = updatedPayload(scope, operation);
  if (planned.kind === 'rejected') {
    return planned;
  }
  if (planned.kind === 'conflict') {
    return contentVersionConflict(board, object, current);
  }

  const revised =
    planned.geometryWidth === undefined && planned.geometryHeight === undefined
      ? object
      : withTableFrame(
          scope,
          planned.geometryWidth,
          planned.geometryHeight,
          Boolean(planned.requiresGeometryUnlock),
        );

  if ('reason' in revised) {
    return revised;
  }

  const payloadVersion = current.payloadVersion + 1n;

  return {
    kind: 'changes',
    objects: [{ ...revised, label: planned.label, payloadVersion }],
    payloads: [{ ...current, payloadVersion, data: planned.data }],
  };
}
