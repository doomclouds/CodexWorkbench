import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
  type ExportBoardRequest,
  type ExportBoardResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type {
  ExportBoardCommand,
  ExportBoardResult,
  WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

type ExportResponse = MessageInitShape<typeof ExportBoardResponseSchema>;
type Rejected = Extract<ExportBoardResult, { kind: 'rejected' }>;

const rejectionByReason: Readonly<Record<Rejected['reason'], BoardExportRejectionReason>> = {
  invalidSelection: BoardExportRejectionReason.INVALID_SELECTION,
  unsupported: BoardExportRejectionReason.UNSUPPORTED,
  assetUnavailable: BoardExportRejectionReason.ASSET_UNAVAILABLE,
  tooLarge: BoardExportRejectionReason.TOO_LARGE,
};

function toExportFormat(format: BoardExportFormat): ExportBoardCommand['format'] {
  if (format === BoardExportFormat.JSON) {
    return 'json';
  }
  if (format === BoardExportFormat.SVG) {
    return 'svg';
  }

  throw new HttpRequestError(400, 'A supported board export format is required');
}

function toExportScope(scope: ExportBoardRequest['scope']): ExportBoardCommand['scope'] {
  switch (scope.case) {
    case 'whole':
      return { kind: 'whole' };
    case 'selection':
      return { kind: 'selection', objectIds: scope.value.objectIds };
    case undefined:
      throw new HttpRequestError(400, 'A board export scope is required');
  }
}

function toExportCommand(request: ExportBoardRequest): ExportBoardCommand {
  if (request.expectedRevision === undefined) {
    throw new HttpRequestError(400, 'A saved board revision is required');
  }

  return {
    boardId: requireId(request.boardId),
    expectedRevision: request.expectedRevision,
    scope: toExportScope(request.scope),
    format: toExportFormat(request.format),
  };
}

function toExportResponse(result: ExportBoardResult): ExportResponse {
  switch (result.kind) {
    case 'file': {
      const { filename, mimeType, revision, content } = result;

      return { result: { case: 'file', value: { filename, mimeType, revision, content } } };
    }
    case 'stale':
      return { result: { case: 'stale', value: { revision: result.revision } } };
    case 'rejected':
      return {
        result: { case: 'rejected', value: { reason: rejectionByReason[result.reason] } },
      };
  }
}

export function createExportRoute(application: WhiteboardApplication): RouteEntry {
  return unaryRoute(WhiteboardService.method.exportBoard, (actor, request) =>
    toExportResponse(application.exportBoard(actor, toExportCommand(request))),
  );
}
