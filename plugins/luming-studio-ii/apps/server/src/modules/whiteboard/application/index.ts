import type {
  Actor,
  BoardScene,
  CommandReceipt,
  ExportBoardCommand,
  ExportBoardFileCommand,
  ExportBoardResult,
  ExportRenderCommand,
  MoveCommand,
  PayloadResult,
} from '../domain/index.js';
import type { WhiteboardRepository } from '../ports/index.js';
import { payloadResult, requireAccess, WhiteboardAccessError } from './board-read.js';
import { executeBoardExport } from './export-board.js';
import { renderExportPng, type SvgPngRenderer } from './export-png.js';
import { executeMove } from './move-objects.js';

export { createBoardBackup } from './export-backup.js';

export { BoardSuggestionError, createBoardSuggestionApplication } from './board-suggestions.js';
export type { BoardSuggestionApplication } from './board-suggestions.js';
export type {
  BoardReviewActor,
  BoardReviewOrigin,
  BoardReviewSource,
  BoardSuggestion,
  BoardSuggestionEdit,
  BoardSuggestionOptionDraft,
  BoardSuggestionPreview,
} from '../domain/index.js';
export type { BoardCreationAttachment } from '../domain/index.js';
export type {
  Actor,
  Appearance,
  BoardAccess,
  BoardEditReceipt,
  BoardEditRejection,
  BoardHeader,
  BoardObject,
  BoardScene,
  BoardVersionSummary,
  ContentOperation,
  CommandReceipt,
  ConnectorDetail,
  ConnectorEndpoint,
  ConnectorHead,
  ConnectorPort,
  ExportBoardCommand,
  ExportBoardFileCommand,
  ExportBoardResult,
  Geometry,
  GeometryDetail,
  GeometryLayerDirection,
  GeometryObjectChange,
  GeometryOperation,
  GeometryTransformKind,
  ImageOperation,
  VideoOperation,
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
  TodoContentEdit,
  TodoContentPlacement,
  TodoContentSource,
} from '../domain/index.js';
export { createBoardEditorApplication, type BoardEditorApplication } from './board-editor.js';
export {
  createBoardHistoryApplication,
  type BoardHistoryApplication,
  type BoardHistoryPage,
  type BoardVersionExportResult,
  type RestoreBoardVersionCommand,
} from './board-history.js';
export { WhiteboardAccessError } from './board-read.js';

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
  exportBoardFile(actor: Actor, command: ExportBoardFileCommand): Promise<ExportBoardResult>;
}

interface WhiteboardFileResources {
  readonly renderPng?: SvgPngRenderer;
  readonly exportArchive?: (
    actor: Actor,
    command: ExportBoardFileCommand,
  ) => Promise<ExportBoardResult>;
}

export function createWhiteboardApplication(
  repository: WhiteboardRepository,
  now?: () => number,
  files: WhiteboardFileResources = {},
): WhiteboardApplication {
  function exportBoard(actor: Actor, command: ExportRenderCommand) {
    return executeBoardExport(repository, actor, command, requireAccess, (reader) => {
      const board = reader.getBoard(command.boardId);
      if (!board) {
        throw new WhiteboardAccessError();
      }

      return board;
    });
  }

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
      return repository.write((writer) => executeMove(writer, actor, command, now));
    },
    getCommandReceipt(actor, boardId, commandId) {
      return repository.read((reader) => {
        requireAccess(reader, actor, boardId);

        return reader.getReceipt(boardId, actor.id, commandId)?.receipt;
      });
    },
    exportBoard,
    async exportBoardFile(actor, command) {
      const { format } = command;
      if (format === 'zip') {
        return files.exportArchive?.(actor, command) ?? { kind: 'rejected', reason: 'unsupported' };
      }

      if (format === 'png') {
        const source = exportBoard(actor, { ...command, format });

        return renderExportPng(source, files.renderPng, () => {
          repository.read((reader) => requireAccess(reader, actor, command.boardId));
        });
      }

      return exportBoard(actor, { ...command, format });
    },
  };
}
