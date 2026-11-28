import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
  type ExportBoardRequest,
  type ExportBoardResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type {
  ExportBoardFileCommand,
  ExportBoardResult,
  WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { asyncUnaryRoute, type RouteEntry } from './unary-route.js';

type ExportResponse = MessageInitShape<typeof ExportBoardResponseSchema>;
type Rejected = Extract<ExportBoardResult, { kind: 'rejected' }>;

const rejectionByReason: Readonly<Record<Rejected['reason'], BoardExportRejectionReason>> = {
  invalidSelection: BoardExportRejectionReason.INVALID_SELECTION,
  unsupported: BoardExportRejectionReason.UNSUPPORTED,
  assetUnavailable: BoardExportRejectionReason.ASSET_UNAVAILABLE,
  tooLarge: BoardExportRejectionReason.TOO_LARGE,
};

const formatByWire = new Map<BoardExportFormat, ExportBoardFileCommand['format']>([
  [BoardExportFormat.JSON, 'json'],
  [BoardExportFormat.SVG, 'svg'],
  [BoardExportFormat.PNG, 'png'],
  [BoardExportFormat.HTML, 'html'],
  [BoardExportFormat.HTML_SOURCE, 'html-source'],
  [BoardExportFormat.ZIP, 'zip'],
]);

export function toExportFormat(format: BoardExportFormat): ExportBoardFileCommand['format'] {
  const value = formatByWire.get(format);
  if (value) {
    return value;
  }

  throw new HttpRequestError(400, 'A supported board export format is required');
}

export function toExportScope(scope: ExportBoardRequest['scope']): ExportBoardFileCommand['scope'] {
  switch (scope.case) {
    case 'whole':
      return { kind: 'whole' };
    case 'selection':
      return { kind: 'selection', objectIds: scope.value.objectIds };
    case undefined:
      throw new HttpRequestError(400, 'A board export scope is required');
  }
}

export function toExportOptions(
  request: Pick<ExportBoardRequest, 'scope' | 'format' | 'rectangle' | 'scale'>,
) {
  const { scope, format, rectangle, scale } = request;
  if (rectangle && (format !== BoardExportFormat.PNG || scope.case !== 'whole')) {
    throw new HttpRequestError(400, 'A crop rectangle requires PNG and the whole board scope');
  }

  if (rectangle) {
    const { x, y, width, height } = rectangle;
    const bounds = [x, y, x + width, y + height];
    const finiteBounds = bounds.every((value) => Number.isFinite(value));
    if (!finiteBounds || x + width <= x || y + height <= y) {
      throw new HttpRequestError(
        400,
        'A crop rectangle requires finite bounds and positive dimensions',
      );
    }
  }
  if (scale !== undefined) {
    const validScale = Number.isFinite(scale) && scale >= 0.1 && scale <= 4;
    if (!validScale || (scale !== 1 && format !== BoardExportFormat.PNG)) {
      throw new HttpRequestError(400, 'Custom PNG export scale must be between 0.1 and 4');
    }
  }

  return {
    scope: toExportScope(scope),
    format: toExportFormat(format),
    rectangle,
    scale,
  };
}

function toExportCommand(request: ExportBoardRequest): ExportBoardFileCommand {
  if (request.expectedRevision === undefined) {
    throw new HttpRequestError(400, 'A saved board revision is required');
  }

  return {
    boardId: requireId(request.boardId),
    expectedRevision: request.expectedRevision,
    ...toExportOptions(request),
  };
}

export function toExportResponse(result: ExportBoardResult): ExportResponse {
  switch (result.kind) {
    case 'file': {
      const { filename, mimeType, revision, content } = result;

      return { result: { case: 'file', value: { filename, mimeType, revision, content } } };
    }
    case 'stale':
      return { result: { case: 'stale', value: { revision: result.revision } } };
    case 'browserPng': {
      const { filename, revision, width, height, svgTemplate, regions } = result;

      return {
        result: {
          case: 'browserPng',
          value: { filename, revision, width, height, svgTemplate, regions: [...regions] },
        },
      };
    }
    case 'rejected':
      return {
        result: { case: 'rejected', value: { reason: rejectionByReason[result.reason] } },
      };
  }
}

export function createExportRoute(application: WhiteboardApplication): RouteEntry {
  return asyncUnaryRoute(WhiteboardService.method.exportBoard, async (actor, request) => {
    const result = await application.exportBoardFile(actor, toExportCommand(request));
    if (result.kind === 'file' || result.kind === 'browserPng') {
      actor.authorize?.(request);
    }

    return toExportResponse(result);
  });
}
