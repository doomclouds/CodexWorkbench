import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService as wireService,
  type ExportBoardResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { WhiteboardPost } from './contracts.js';

export type ExportBoardFormat = 'json' | 'svg';

export type ExportBoardScope =
  | { readonly kind: 'whole' }
  | { readonly kind: 'selection'; readonly objectIds: readonly string[] };

export interface ExportBoardRequest {
  readonly boardId: string;
  readonly expectedRevision: bigint;
  readonly scope: ExportBoardScope;
  readonly format: ExportBoardFormat;
}

export interface ExportBoardFile {
  readonly filename: string;
  readonly mimeType: 'application/json' | 'image/svg+xml';
  readonly revision: bigint;
  readonly content: Uint8Array;
}

export type ExportBoardRejection =
  | 'invalidSelection'
  | 'unsupported'
  | 'assetUnavailable'
  | 'tooLarge';

export type ExportBoardResult =
  | { readonly kind: 'file'; readonly file: ExportBoardFile }
  | { readonly kind: 'stale'; readonly revision: bigint }
  | { readonly kind: 'rejected'; readonly reason: ExportBoardRejection };

export type ExportBoard = (
  request: ExportBoardRequest,
  signal?: AbortSignal,
) => Promise<ExportBoardResult>;

const formatTypes = {
  json: 'application/json',
  svg: 'image/svg+xml',
} as const;

const wireFormats = {
  json: BoardExportFormat.JSON,
  svg: BoardExportFormat.SVG,
};

const rejectionReasons = new Map<BoardExportRejectionReason, ExportBoardRejection>([
  [BoardExportRejectionReason.INVALID_SELECTION, 'invalidSelection'],
  [BoardExportRejectionReason.UNSUPPORTED, 'unsupported'],
  [BoardExportRejectionReason.ASSET_UNAVAILABLE, 'assetUnavailable'],
  [BoardExportRejectionReason.TOO_LARGE, 'tooLarge'],
]);

const exportMethod = wireService.method.exportBoard;
const exportPath = '/' + wireService.typeName + '/' + exportMethod.name;

function readExport(
  { result }: ExportBoardResponse,
  { expectedRevision, format }: ExportBoardRequest,
): ExportBoardResult {
  switch (result.case) {
    case 'file': {
      const { filename, revision, content } = result.value;
      const mimeType = formatTypes[format];
      if (revision !== expectedRevision) {
        throw new Error('导出文件版次与请求不一致。');
      }
      if (result.value.mimeType !== mimeType || !filename.endsWith('.' + format)) {
        throw new Error('导出文件格式与请求不一致。');
      }
      if (content.byteLength === 0) {
        throw new Error('导出服务返回了空文件。');
      }

      return { kind: 'file', file: { filename, mimeType, revision, content } };
    }
    case 'stale':
      return { kind: 'stale', revision: result.value.revision };
    case 'rejected': {
      const reason = rejectionReasons.get(result.value.reason);
      if (!reason) {
        throw new Error('导出服务返回了未知的拒绝原因。');
      }

      return { kind: 'rejected', reason };
    }
    case undefined:
      throw new Error('导出服务未返回处理结果。');
  }
}

export function createWhiteboardExportService(post: WhiteboardPost): ExportBoard {
  return async (request, signal) => {
    const { boardId, expectedRevision, format, scope } = request;
    const body = toBinary(
      exportMethod.input,
      create(exportMethod.input, {
        boardId,
        expectedRevision,
        format: wireFormats[format],
        scope:
          scope.kind === 'whole'
            ? { case: 'whole', value: {} }
            : { case: 'selection', value: { objectIds: [...scope.objectIds] } },
      }),
    );

    const response = await post(exportPath, body, signal);

    return readExport(
      fromBinary(exportMethod.output, response, { readUnknownFields: false }),
      request,
    );
  };
}
