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
import { publishBoardContentChange, type BoardChangePublication } from './board-content-changes.js';
import {
  payloadResult,
  requireAccess,
  requireBoardContentAccess,
  WhiteboardAccessError,
} from './board-read.js';
import { executeBoardExport } from './export-board.js';
import { renderExportPng, type SvgPngRenderer } from './export-png.js';
import { executeMove } from './move-objects.js';

export { createBoardBackup } from './export-backup.js';
export { prepareBoardAsset, readArchivedSvgImage } from './prepare-board-image.js';
export { agentWriteBounds } from './agent-board-write-scope.js';
export {
  createBoardAgentWriteApplication,
  maximumAgentBoardWriteOperations,
  type BoardAgentWriteApplication,
} from './agent-board-write.js';

export { BoardSuggestionError, createBoardSuggestionApplication } from './board-suggestions.js';
export type { BoardContentChange } from './board-content-changes.js';
export type { BoardSuggestionApplication } from './board-suggestions.js';
export type {
  BoardReviewActor,
  BoardReviewOrigin,
  BoardReviewSource,
  BoardSuggestion,
  BoardSuggestionEdit,
  BoardSuggestionOptionDraft,
  BoardSuggestionOperation,
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
  getBoardScene(actor: Actor, boardId: string, allowTrashedOwner?: boolean): BoardScene;
  getObjectPayloads(
    actor: Actor,
    boardId: string,
    objectIds: readonly string[],
    allowTrashedOwner?: boolean,
  ): readonly PayloadResult[];
  moveObjects(actor: Actor, command: MoveCommand): CommandReceipt;
  getCommandReceipt(actor: Actor, boardId: string, commandId: string): CommandReceipt | undefined;
  exportBoard(actor: Actor, command: ExportBoardCommand): ExportBoardResult;
  exportBoardFile(actor: Actor, command: ExportBoardFileCommand): Promise<ExportBoardResult>;
}

interface WhiteboardApplicationOptions {
  readonly boardChanges?: BoardChangePublication;
  readonly renderPng?: SvgPngRenderer;
  readonly exportArchive?: (
    actor: Actor,
    command: ExportBoardFileCommand,
  ) => Promise<ExportBoardResult>;
}

export function createWhiteboardApplication(
  repository: WhiteboardRepository,
  now?: () => number,
  { boardChanges, renderPng, exportArchive }: WhiteboardApplicationOptions = {},
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
    getBoardScene(actor, boardId, allowTrashedOwner = false) {
      return repository.read((reader) => {
        const access = requireBoardContentAccess(reader, actor, boardId, allowTrashedOwner);
        const board = reader.getBoard(boardId);
        if (!board) {
          throw new WhiteboardAccessError();
        }

        return {
          board,
          access,
          objects: reader.listObjects(boardId),
          customColors: reader.getBoardCustomColors(boardId),
        };
      });
    },
    getObjectPayloads(actor, boardId, objectIds, allowTrashedOwner = false) {
      return repository.read((reader) => {
        requireBoardContentAccess(reader, actor, boardId, allowTrashedOwner);
        if (!objectIds.length) {
          return [];
        }

        const payloads = reader.getPayloads(boardId, [...new Set(objectIds)]);
        const byId = new Map(payloads.map((payload) => [payload.objectId, payload]));

        return objectIds.map((id) => payloadResult(id, byId.get(id)));
      });
    },
    moveObjects(actor, command) {
      const receipt = repository.write((writer) => executeMove(writer, actor, command, now));

      return publishBoardContentChange(receipt, boardChanges);
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
        return exportArchive?.(actor, command) ?? { kind: 'rejected', reason: 'unsupported' };
      }

      if (format === 'png') {
        const source = exportBoard(actor, { ...command, format });

        return renderExportPng(source, renderPng, () => {
          repository.read((reader) => requireAccess(reader, actor, command.boardId));
        });
      }

      return exportBoard(actor, { ...command, format });
    },
  };
}
