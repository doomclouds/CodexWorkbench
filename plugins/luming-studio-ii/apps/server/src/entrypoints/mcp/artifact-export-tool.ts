import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardHistoryService,
  type ExportBoardVersionResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService,
  type ExportBoardBrowserPng,
  type ExportBoardFile,
  type ExportBoardRequestSchema,
  type ExportBoardResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  artifactIdentifier,
  artifactVersion,
  modelBoardId,
  modelVersion,
} from './artifact-tool-input.js';
import { BridgeError, invalidArgument } from './errors.js';
import { callModelRpc, modelToolFailure, type ModelToolOptions } from './model-tool.js';
import { bridgeMaximumResponseBytes } from './schema.js';

const coordinate = z.number().min(-10_000_000).max(10_000_000);
const extent = z.number().positive().max(10_000_000);
const exportSchema = z
  .object({
    artifactId: artifactIdentifier.optional(),
    boardId: artifactIdentifier.optional(),
    format: z.enum(['html', 'html-source', 'json', 'svg', 'png', 'zip']),
    regionId: artifactIdentifier.optional(),
    ids: z.array(artifactIdentifier).min(1).max(100).optional(),
    atRevision: artifactVersion.optional(),
    expectedRevision: artifactVersion.optional(),
    rect: z.object({ x: coordinate, y: coordinate, w: extent, h: extent }).strict().optional(),
    viewId: artifactIdentifier.optional(),
    includeImage: z.boolean().optional(),
    scale: z.number().min(0.1).max(4).optional(),
  })
  .strict();

type ExportInput = z.infer<typeof exportSchema>;
type Scope = MessageInitShape<typeof ExportBoardRequestSchema>['scope'];
type ExportResult = ExportBoardResponse['result'] | ExportBoardVersionResponse['result'];

const formats = {
  html: { wire: BoardExportFormat.HTML, mime: 'text/html', suffix: '.html' },
  'html-source': { wire: BoardExportFormat.HTML_SOURCE, mime: 'text/html', suffix: '.html' },
  json: { wire: BoardExportFormat.JSON, mime: 'application/json', suffix: '.json' },
  svg: { wire: BoardExportFormat.SVG, mime: 'image/svg+xml', suffix: '.svg' },
  png: { wire: BoardExportFormat.PNG, mime: 'image/png', suffix: '.png' },
  zip: { wire: BoardExportFormat.ZIP, mime: 'application/zip', suffix: '.studio.zip' },
} as const;
const imageReplyLimit = 768 * 1024;
const invalidFilename = /[\\/:*?"<>|\p{Cc}]/u;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function exportScope(input: ExportInput): Scope {
  const { ids, regionId, rect, format, atRevision } = input;
  if (Number(ids !== undefined) + Number(regionId !== undefined) + Number(rect !== undefined) > 1) {
    throw invalidArgument('导出范围只接受 ids、regionId 或 rect 中的一项。');
  }

  const customScale = input.scale !== undefined && input.scale !== 1;
  if (format !== 'png' && (rect || customScale)) {
    throw invalidArgument('矩形裁切和自定像素倍率仅用于 PNG 导出。');
  }

  const objectIds = ids ?? (regionId ? [regionId] : []);
  if (objectIds.length !== new Set(objectIds).size) {
    throw invalidArgument('选区不能包含重复的对象 ID。');
  }
  if (format === 'html-source' && objectIds.length !== 1) {
    throw invalidArgument('每次只下载一个 HTML 图解的原始源码。');
  }
  if (format === 'zip' && (objectIds.length || atRevision !== undefined)) {
    throw invalidArgument('完整 ZIP 备份适用于当前整板，可以另行导出某个历史版。');
  }

  return objectIds.length
    ? { case: 'selection', value: { objectIds } }
    : { case: 'whole', value: {} };
}

function browserResult(boardId: string, input: ExportInput, plan?: ExportBoardBrowserPng) {
  return {
    content: [],
    structuredContent: {
      ok: true,
      data: {
        kind: 'browserRenderRequired',
        artifactId: boardId,
        format: input.format,
        revision: plan?.revision.toString(),
        width: plan?.width,
        height: plan?.height,
        ...(plan && input.rect && { bounds: input.rect }),
        message: '这个导出需要在 Studio 白板浏览器中完成渲染，请从白板的导出入口下载文件。',
      },
    },
  };
}

async function getRevision(options: ModelToolOptions, boardId: string, signal: AbortSignal) {
  const { scene } = await callModelRpc(
    options,
    WhiteboardService.method.getBoardScene,
    { boardId },
    signal,
    4 * 1024 * 1024,
  );

  if (scene?.boardRevision === undefined || scene.boardId !== boardId) {
    throw new BridgeError('UNAVAILABLE', '无法确认该白板已保存的版本。');
  }

  return scene.boardRevision;
}

async function requestExport(
  options: ModelToolOptions,
  input: ExportInput,
  boardId: string,
  scope: Scope,
  revision: bigint,
  signal: AbortSignal,
): Promise<ExportResult> {
  const format = formats[input.format].wire;
  const { rect, scale } = input;
  const rectangle = rect && { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
  const request = { boardId, scope, format, rectangle, scale };
  if (input.atRevision !== undefined) {
    const result = await callModelRpc(
      options,
      BoardHistoryService.method.exportBoardVersion,
      { ...request, revision },
      signal,
      bridgeMaximumResponseBytes,
    );

    return result.result;
  }
  const result = await callModelRpc(
    options,
    WhiteboardService.method.exportBoard,
    { ...request, expectedRevision: revision },
    signal,
    bridgeMaximumResponseBytes,
  );

  return result.result;
}

const exportRejections = new Map<BoardExportRejectionReason, [string, string]>([
  [
    BoardExportRejectionReason.INVALID_SELECTION,
    ['INVALID_SELECTION', '部分对象已经失效，请重新读取选区。'],
  ],
  [BoardExportRejectionReason.UNSUPPORTED, ['UNSUPPORTED', '当前内容和范围无法生成所选格式。']],
  [
    BoardExportRejectionReason.ASSET_UNAVAILABLE,
    ['ASSET_UNAVAILABLE', '某些资源不可用，请核对白板中的图片、视频或图解。'],
  ],
  [BoardExportRejectionReason.TOO_LARGE, ['TOO_LARGE', '导出超出大小限制，请缩小范围。']],
]);

function exportError(code: string, message: string, revision?: bigint) {
  return {
    content: [],
    isError: true,
    structuredContent: {
      ok: false,
      error: { code, message, currentRevision: revision?.toString() },
    },
  };
}

interface ExportDelivery {
  readonly boardId: string;
  readonly input: ExportInput;
  readonly revision: bigint;
  readonly file: ExportBoardFile;
}

function pngMetadata(content: Uint8Array) {
  const png = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature)) {
    throw new BridgeError('UNAVAILABLE', '导出服务未返回有效的 PNG 文件。');
  }

  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function deliver(
  options: ModelToolOptions,
  { boardId, input, revision, file }: ExportDelivery,
  signal: AbortSignal,
) {
  const { filename, mimeType, content } = file;
  const format = formats[input.format];
  const validFilename = filename.endsWith(format.suffix) && !invalidFilename.test(filename);
  const validContent = mimeType === format.mime && content.byteLength > 0;
  if (file.revision !== revision || !validFilename || !validContent) {
    throw new BridgeError('UNAVAILABLE', '导出回执的文件或版次不匹配。');
  }
  if (!options.writeExportFile) {
    throw new BridgeError('UNAVAILABLE', '当前宿主无法写出下载文件，请从 Studio 白板导出。');
  }

  const dimensions = input.format === 'png' && pngMetadata(content);
  const downloadPath = await options.writeExportFile(filename, content, signal);
  const selected = input.ids || input.regionId || input.rect;
  const inline =
    input.format === 'png' &&
    input.includeImage !== false &&
    Boolean(selected) &&
    content.byteLength <= imageReplyLimit;
  const message = inline
    ? [{ type: 'image' as const, mimeType, data: Buffer.from(content).toString('base64') }]
    : [];

  return {
    content: message,
    structuredContent: {
      ok: true,
      data: {
        kind: 'file',
        artifactId: boardId,
        revision: revision.toString(),
        filename,
        mimeType,
        size: content.byteLength,
        downloadPath,
        ...dimensions,
        ...(input.rect && { bounds: input.rect }),
      },
    },
  };
}

async function exportArtifact(options: ModelToolOptions, input: ExportInput, signal: AbortSignal) {
  const boardId = modelBoardId(input);
  if (input.viewId) {
    return browserResult(boardId, input);
  }

  const scope = exportScope(input);
  if (input.atRevision !== undefined && input.expectedRevision !== undefined) {
    throw invalidArgument('历史版次与当前版次检查不能同时指定。');
  }

  const revision =
    modelVersion(input.atRevision ?? input.expectedRevision) ??
    (await getRevision(options, boardId, signal));
  const result = await requestExport(options, input, boardId, scope, revision, signal);
  switch (result.case) {
    case 'file':
      return deliver(options, { boardId, input, revision, file: result.value }, signal);
    case 'browserPng':
      return browserResult(boardId, input, result.value);
    case 'stale':
      return exportError('CONFLICT', '白板已有更新，请重新读取后导出。', result.value.revision);
    case 'unavailable':
      return exportError('NOT_FOUND', '该历史版本已经不可用。');
    case 'rejected': {
      if (input.rect && result.value.reason === BoardExportRejectionReason.INVALID_SELECTION) {
        return exportError('EMPTY_CAPTURE', '指定范围内没有可绘制的白板对象。');
      }

      const [code, message] = exportRejections.get(result.value.reason) ?? [
        'UNAVAILABLE',
        '导出请求被拒绝。',
      ];

      return exportError(code, message);
    }
    case undefined:
      return exportError('UNAVAILABLE', '导出服务未返回结果。');
  }
}

export function registerArtifactExportTool(server: McpServer, options: ModelToolOptions) {
  server.registerTool(
    'artifact_export',
    {
      title: '导出白板作品',
      description:
        '按当前或指定历史版次导出整板、对象 ID 选区或单个图解源码。PNG 支持按世界坐标矩形裁切和像素倍率。需要浏览器渲染时提示通过已打开的 Studio 白板完成。ZIP 仅限有权限的当前整板。',
      inputSchema: exportSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        return await exportArtifact(options, input, signal);
      } catch (error) {
        return modelToolFailure(error, options.onError);
      }
    },
  );
}
