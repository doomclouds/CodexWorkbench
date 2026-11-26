import type {
  Actor,
  BoardAccess,
  BoardScene,
  CommandReceipt,
  ExportBoardCommand,
  ExportBoardResult,
  MoveCommand,
  PayloadRecord,
  PayloadResult,
} from '../domain/index.js';
import { isSupportedPayload } from '../domain/index.js';
import type { WhiteboardReader, WhiteboardRepository } from '../ports/index.js';
import { executeBoardExport } from './export-board.js';
import { executeMove } from './move-objects.js';

export type {
  Actor,
  Appearance,
  BoardAccess,
  BoardHeader,
  BoardObject,
  BoardScene,
  CommandReceipt,
  ConnectorDetail,
  ConnectorEndpoint,
  ConnectorHead,
  ConnectorPort,
  ExportBoardCommand,
  ExportBoardResult,
  Geometry,
  GeometryDetail,
  JsonObject,
  JsonValue,
  MoveApplied,
  MoveCommand,
  MoveConflict,
  MoveDelta,
  MoveOutcome,
  MoveRejected,
  MoveRejectionReason,
  MoveTarget,
  PayloadRecord,
  PayloadResult,
  Point,
} from '../domain/index.js';

export interface WhiteboardApplication {
  getBoardScene(actor: Actor, boardId: string): BoardScene;
  getObjectPayloads(
    actor: Actor,
    boardId: string,
    objectIds: readonly string[],
  ): readonly PayloadResult[];
  moveObjects(actor: Actor, command: MoveCommand): CommandReceipt;
  getCommandReceipt(actor: Actor, boardId: string, commandId: string): CommandReceipt | undefined;
  exportBoard(actor: Actor, command: ExportBoardCommand): ExportBoardResult;
}

export class WhiteboardAccessError extends Error {
  constructor() {
    super('Whiteboard access denied');
    this.name = 'WhiteboardAccessError';
  }
}

function requireAccess(reader: WhiteboardReader, actor: Actor, boardId: string): BoardAccess {
  const access = reader.getAccess(boardId, actor.id);
  if (!access) {
    throw new WhiteboardAccessError();
  }

  return access;
}

function payloadResult(objectId: string, payload: PayloadRecord | undefined): PayloadResult {
  if (!payload) {
    return { kind: 'unavailable', objectId, reason: 'notFound' };
  }
  if (!isSupportedPayload(payload.bodyKind)) {
    return { kind: 'unavailable', objectId, reason: 'unsupportedKind' };
  }

  return { kind: 'payload', payload };
}

export function createWhiteboardApplication(
  repository: WhiteboardRepository,
): WhiteboardApplication {
  return {
    getBoardScene(actor, boardId) {
      return repository.read((reader) => {
        const access = requireAccess(reader, actor, boardId);
        const board = reader.getBoard(boardId);
        if (!board) {
          throw new WhiteboardAccessError();
        }

        return { board, access, objects: reader.listObjects(boardId) };
      });
    },
    getObjectPayloads(actor, boardId, objectIds) {
      return repository.read((reader) => {
        requireAccess(reader, actor, boardId);
        if (!objectIds.length) {
          return [];
        }

        const payloads = reader.getPayloads(boardId, [...new Set(objectIds)]);
        const byId = new Map(payloads.map((payload) => [payload.objectId, payload]));

        return objectIds.map((id) => payloadResult(id, byId.get(id)));
      });
    },
    moveObjects(actor, command) {
      return repository.write((writer) => executeMove(writer, actor, command));
    },
    getCommandReceipt(actor, boardId, commandId) {
      return repository.read((reader) => {
        requireAccess(reader, actor, boardId);

        return reader.getReceipt(boardId, actor.id, commandId)?.receipt;
      });
    },
    exportBoard(actor, command) {
      return executeBoardExport(repository, actor, command, requireAccess, (reader) => {
        const board = reader.getBoard(command.boardId);
        if (!board) {
          throw new WhiteboardAccessError();
        }

        return board;
      });
    },
  };
}
