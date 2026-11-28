import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService as wireService,
  type ExportBoardBrowserPng,
  type ExportBoardFile as WireExportBoardFile,
  type ExportBoardRequestSchema,
  type ExportBoardResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { WhiteboardPost } from './contracts.js';

export type ExportBoardFormat = 'png' | 'svg' | 'html' | 'html-source' | 'json' | 'zip';

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
  readonly mimeType: (typeof formats)[ExportBoardFormat]['mimeType'];
  readonly revision: bigint;
  readonly content: Uint8Array;
}

export interface BoardDownloadNotice {
  readonly kind: 'requested' | 'unavailable';
  readonly message: string;
}

type BoardDownloadResult = BoardDownloadNotice | void;

export interface RequestBoardDownload {
  (file: ExportBoardFile, signal?: AbortSignal): BoardDownloadResult | Promise<BoardDownloadResult>;
  readonly confirmation?: 'host';
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

type BrowserVectorFormat = Extract<ExportBoardFormat, 'png' | 'svg'>;

export type RenderBrowserVectorExport = (
  source: ExportBoardBrowserPng,
  format: BrowserVectorFormat,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

const formats = {
  png: { mimeType: 'image/png', suffix: '.png' },
  svg: { mimeType: 'image/svg+xml', suffix: '.svg' },
  html: { mimeType: 'text/html', suffix: '.html' },
  'html-source': { mimeType: 'text/html', suffix: '.html' },
  json: { mimeType: 'application/json', suffix: '.json' },
  zip: { mimeType: 'application/zip', suffix: '.studio.zip' },
} as const;

export const wireFormats = {
  png: BoardExportFormat.PNG,
  html: BoardExportFormat.HTML,
  'html-source': BoardExportFormat.HTML_SOURCE,
  json: BoardExportFormat.JSON,
  svg: BoardExportFormat.SVG,
  zip: BoardExportFormat.ZIP,
};

const rejectionReasons = new Map<BoardExportRejectionReason, ExportBoardRejection>([
  [BoardExportRejectionReason.INVALID_SELECTION, 'invalidSelection'],
  [BoardExportRejectionReason.UNSUPPORTED, 'unsupported'],
  [BoardExportRejectionReason.ASSET_UNAVAILABLE, 'assetUnavailable'],
  [BoardExportRejectionReason.TOO_LARGE, 'tooLarge'],
]);

const exportMethod = wireService.method.exportBoard;
const exportPath = '/' + wireService.typeName + '/' + exportMethod.name;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export function writeExportScope(
  scope: ExportBoardScope,
): MessageInitShape<typeof ExportBoardRequestSchema>['scope'] {
  return scope.kind === 'whole'
    ? { case: 'whole', value: {} }
    : { case: 'selection', value: { objectIds: [...scope.objectIds] } };
}

export function readExportFile(
  { filename, revision, content, mimeType }: WireExportBoardFile,
  expectedRevision: bigint,
  format: ExportBoardFormat,
): ExportBoardFile {
  const expected = formats[format];
  if (revision !== expectedRevision) {
    throw new Error('导出文件版次与请求不一致。');
  }
  if (mimeType !== expected.mimeType || !filename.endsWith(expected.suffix)) {
    throw new Error('导出文件格式与请求不一致。');
  }
  if (content.byteLength === 0) {
    throw new Error('导出服务返回了空文件。');
  }

  return { filename, mimeType, revision, content };
}

export function readExportRejection(value: BoardExportRejectionReason): ExportBoardRejection {
  const reason = rejectionReasons.get(value);
  if (!reason) {
    throw new Error('导出服务返回了未知的拒绝原因。');
  }

  return reason;
}

export async function readBrowserVectorFile(
  source: ExportBoardBrowserPng,
  expectedRevision: bigint,
  format: ExportBoardFormat,
  render: RenderBrowserVectorExport | undefined,
  signal?: AbortSignal,
): Promise<ExportBoardFile> {
  const { filename, revision, svgTemplate, regions } = source;
  if (revision !== expectedRevision) {
    throw new Error('导出文件版次与请求不一致。');
  }

  const vectorFormat = format === 'png' || format === 'svg';
  if (!vectorFormat || !filename.endsWith('.' + format)) {
    throw new Error('导出文件格式与请求不一致。');
  }
  if (!svgTemplate || !regions.length) {
    throw new Error('导出服务未提供完整的图片排版内容。');
  }
  if (!render) {
    throw new Error('当前打开方式无法渲染此图片。请在浏览器打开或导出 HTML。');
  }

  signal?.throwIfAborted();
  const content = await render(source, format, signal);
  signal?.throwIfAborted();
  if (format === 'png' && !pngSignature.every((byte, index) => byte === content[index])) {
    throw new Error('浏览器未返回有效的 PNG 图片。');
  }
  if (format === 'svg' && !new TextDecoder().decode(content.subarray(0, 256)).startsWith('<svg ')) {
    throw new Error('浏览器未返回有效的 SVG 图片。');
  }

  return { filename, mimeType: formats[format].mimeType, revision, content };
}

async function readExport(
  { result }: ExportBoardResponse,
  { expectedRevision, format }: ExportBoardRequest,
  render: RenderBrowserVectorExport | undefined,
  signal?: AbortSignal,
): Promise<ExportBoardResult> {
  switch (result.case) {
    case 'file':
      return { kind: 'file', file: readExportFile(result.value, expectedRevision, format) };
    case 'browserPng':
      return {
        kind: 'file',
        file: await readBrowserVectorFile(result.value, expectedRevision, format, render, signal),
      };
    case 'stale':
      return { kind: 'stale', revision: result.value.revision };
    case 'rejected':
      return { kind: 'rejected', reason: readExportRejection(result.value.reason) };
    case undefined:
      throw new Error('导出服务未返回处理结果。');
  }
}

export function createWhiteboardExportService(
  post: WhiteboardPost,
  render?: RenderBrowserVectorExport,
): ExportBoard {
  return async (request, signal) => {
    const { boardId, expectedRevision, format, scope } = request;
    const body = toBinary(
      exportMethod.input,
      create(exportMethod.input, {
        boardId,
        expectedRevision,
        format: wireFormats[format],
        scope: writeExportScope(scope),
      }),
    );

    const response = await post(exportPath, body, signal);

    return readExport(
      fromBinary(exportMethod.output, response, { readUnknownFields: false }),
      request,
      render,
      signal,
    );
  };
}
