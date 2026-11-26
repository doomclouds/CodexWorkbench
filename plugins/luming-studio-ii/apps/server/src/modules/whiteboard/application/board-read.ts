import {
  isSupportedPayload,
  type Actor,
  type BoardAccess,
  type PayloadRecord,
  type PayloadResult,
} from '../domain/index.js';
import type { WhiteboardReader } from '../ports/index.js';

export class WhiteboardAccessError extends Error {
  constructor() {
    super('Whiteboard access denied');
    this.name = 'WhiteboardAccessError';
  }
}

export function requireAccess(
  reader: WhiteboardReader,
  actor: Actor,
  boardId: string,
): BoardAccess {
  const access = reader.getAccess(boardId, actor.id);
  if (!access) {
    throw new WhiteboardAccessError();
  }

  return access;
}

export function payloadResult(objectId: string, payload: PayloadRecord | undefined): PayloadResult {
  if (!payload) {
    return { kind: 'unavailable', objectId, reason: 'notFound' };
  }
  if (!isSupportedPayload(payload.bodyKind)) {
    return { kind: 'unavailable', objectId, reason: 'unsupportedKind' };
  }

  return { kind: 'payload', payload };
}
