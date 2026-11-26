import { toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardHistoryService,
  BoardVersionKind,
  type BoardVersionSummarySchema,
  type ExportBoardVersionResponseSchema,
  type RestoreBoardVersionRequest,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import type {
  BoardHistoryApplication,
  BoardVersionExportResult,
  BoardVersionSummary,
  RestoreBoardVersionCommand,
} from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { toExportFormat, toExportResponse, toExportScope } from './export-route.js';
import { toPayloadResult } from './payload.js';
import { HttpRequestError, requireId } from './request.js';
import { toBoardScene } from './scene.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

const versionKind: Record<BoardVersionSummary['kind'], BoardVersionKind> = {
  baseline: BoardVersionKind.BASELINE,
  geometry: BoardVersionKind.GEOMETRY,
  content: BoardVersionKind.CONTENT,
  image: BoardVersionKind.IMAGE,
  restore: BoardVersionKind.RESTORE,
};
const maxPayloadIds = 500;

function requireRevision(revision: bigint | undefined): bigint {
  if (revision === undefined) {
    throw new HttpRequestError(400, 'A saved board revision is required');
  }

  return revision;
}

function requirePayloadIds(ids: readonly string[]): readonly string[] {
  if (ids.length > maxPayloadIds) {
    throw new HttpRequestError(400, 'Too many historical object payloads requested');
  }

  return ids.map(requireId);
}

function toVersionSummary(
  version: BoardVersionSummary,
): MessageInitShape<typeof BoardVersionSummarySchema> {
  const { kind, savedAtMillis, ...summary } = version;

  return {
    ...summary,
    kind: versionKind[kind],
    savedAtMillis: savedAtMillis === undefined ? undefined : BigInt(savedAtMillis),
  };
}

function toRestoreCommand(request: RestoreBoardVersionRequest): RestoreBoardVersionCommand {
  return {
    boardId: requireId(request.boardId),
    commandId: requireId(request.commandId),
    revision: requireRevision(request.revision),
    expectedCurrentRevision: requireRevision(request.expectedCurrentRevision),
    scope: toExportScope(request.scope),
  };
}

function toVersionExport(
  result: BoardVersionExportResult,
): MessageInitShape<typeof ExportBoardVersionResponseSchema> {
  if (result.kind !== 'unavailable') {
    const { result: encoded } = toExportResponse(result);
    if (encoded?.case === 'file' || encoded?.case === 'rejected') {
      return { result: encoded };
    }
  }

  return { result: { case: 'unavailable', value: true } };
}

export function createBoardHistoryRoutes(
  application: BoardHistoryApplication,
  digest: (body: Uint8Array) => string,
): readonly RouteEntry[] {
  const {
    listBoardVersions,
    getBoardVersionScene,
    getBoardVersionPayloads,
    restoreBoardVersion,
    exportBoardVersion,
  } = BoardHistoryService.method;

  return [
    unaryRoute(listBoardVersions, (actor, request) => {
      const result = application.listVersions(
        actor,
        requireId(request.boardId),
        request.beforeRevision,
        request.limit,
      );

      return { ...result, versions: result.versions.map(toVersionSummary) };
    }),
    unaryRoute(getBoardVersionScene, (actor, request) => {
      const scene = application.getVersionScene(
        actor,
        requireId(request.boardId),
        requireRevision(request.revision),
      );

      return { scene: scene && toBoardScene(scene) };
    }),
    unaryRoute(getBoardVersionPayloads, (actor, request) => {
      const boardId = requireId(request.boardId);
      const revision = requireRevision(request.revision);
      const results = application.getVersionPayloads(
        actor,
        boardId,
        revision,
        requirePayloadIds(request.objectIds),
      );

      return {
        boardId,
        revision,
        unavailable: results === undefined,
        results: results?.map(toPayloadResult),
      };
    }),
    unaryRoute(restoreBoardVersion, (actor, request) => {
      const command = toRestoreCommand(request);
      const signature = 'restore:' + digest(toBinary(restoreBoardVersion.input, request));

      return { receipt: toBoardEditReceipt(application.restoreVersion(actor, command, signature)) };
    }),
    unaryRoute(exportBoardVersion, (actor, request) =>
      toVersionExport(
        application.exportVersion(actor, {
          boardId: requireId(request.boardId),
          expectedRevision: requireRevision(request.revision),
          scope: toExportScope(request.scope),
          format: toExportFormat(request.format),
        }),
      ),
    ),
  ];
}
