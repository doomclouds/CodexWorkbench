import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debuglog } from 'node:util';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Board, BoardElement } from '../contracts/studio.js';
import {
  buildBoardHtml,
  buildBoardSvg,
  ExportError,
  extractRegionSvg,
  filenameFor,
  isHtmlRegionElement,
  selectedElements,
  type ExportOptions,
} from './serialization.js';
import { documentHtml } from './products/document-serialization.js';
import { documentSurface } from './products/document-surface.js';

export { buildBoardHtml, buildBoardSvg, ExportError, extractRegionSvg } from './serialization.js';

export interface ExportedArtifact {
  mimeType: string;
  filename: string;
  data: string;
  encoding?: 'base64' | 'utf8';
}

let initialized: Promise<void> | undefined;
let fonts: Promise<Uint8Array[]> | undefined;
const debug = debuglog('agentero-studio');

async function loadRendererWasm(): Promise<Uint8Array> {
  const besideRuntime = fileURLToPath(new URL('./resvg.wasm', import.meta.url));
  try {
    return await readFile(besideRuntime);
  } catch (runtimeError) {
    debug('PNG renderer falling back to the development package: %s', errorKind(runtimeError));
    try {
      const installed = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
      return await readFile(installed);
    } catch (error) {
      throw new ExportError('RENDERER_UNAVAILABLE', 'PNG 渲染资源缺失，请重新构建或更新插件。', {
        cause: error,
      });
    }
  }
}

function errorKind(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error;
  }

  return 'code' in error ? String(error.code) : error.name;
}

async function initializeRenderer(): Promise<void> {
  initialized ??= loadRendererWasm().then((wasm) => initWasm(wasm));
  try {
    await initialized;
  } catch (error) {
    initialized = undefined;
    throw error;
  }
}

function fontCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['segoeui.ttf', 'msyh.ttc', 'consola.ttf'].map((name) =>
      join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', name),
    );
  }
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/System/Library/Fonts/Menlo.ttc',
    ];
  }

  return [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  ];
}

function systemFontFamily(): string {
  if (process.platform === 'win32') {
    return 'Microsoft YaHei';
  }
  if (process.platform === 'darwin') {
    return 'PingFang SC';
  }

  return 'DejaVu Sans';
}

async function systemFontBuffers(): Promise<Uint8Array[]> {
  fonts ??= (async () => {
    const found = await Promise.all(
      fontCandidates().map(async (path) => {
        try {
          return await readFile(path);
        } catch (error) {
          debug('System font candidate could not be loaded: %s', errorKind(error));
          return undefined;
        }
      }),
    );

    return found.flatMap((value) => (value ? [new Uint8Array(value)] : []));
  })();

  return await fonts;
}

export async function renderSvgPng(
  svg: string,
  options: Pick<ExportOptions, 'scale'> = {},
  maxPixels = 32_000_000,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  if (/<foreignObject\b/i.test(svg)) {
    throw new ExportError(
      'EXPORT_BROWSER_REQUIRED',
      '完整 HTML 布局需要浏览器渲染，请在白板界面导出 PNG；也可以单独导出区域内的 SVG 图解。',
    );
  }
  if (/(?:href|xlink:href)\s*=\s*["'](?!#|data:image\/)/i.test(svg)) {
    throw new ExportError(
      'ASSET_NOT_EMBEDDED',
      'PNG 导出包含尚未嵌入的外部资源，无法离线完整渲染。',
    );
  }

  await initializeRenderer();
  const fontBuffers = await systemFontBuffers();
  if (/<text\b/i.test(svg) && !fontBuffers.length) {
    throw new ExportError(
      'FONT_UNAVAILABLE',
      '未找到用于 PNG 渲染的系统字体，请使用 SVG 或从白板界面导出。',
    );
  }

  const scale =
    typeof options.scale === 'number' && Number.isFinite(options.scale) ? options.scale : 1;

  if (scale <= 0 || scale > 4) {
    throw new ExportError('INVALID_EXPORT_SCALE', '导出缩放倍数必须大于 0 且不超过 4。');
  }

  const renderer = new Resvg(svg, {
    font: {
      fontBuffers,
      defaultFontFamily: systemFontFamily(),
      defaultFontSize: 16,
    },
    fitTo: { mode: 'zoom', value: scale },
  });

  try {
    const width = Math.ceil(renderer.width * scale);
    const height = Math.ceil(renderer.height * scale);
    if (width > 16384 || height > 16384 || width * height > maxPixels) {
      throw new ExportError('EXPORT_TOO_LARGE', 'PNG 超过像素上限，请缩小范围或降低导出倍数。');
    }

    const image = renderer.render();
    try {
      if (image.width * image.height > maxPixels) {
        throw new ExportError('EXPORT_TOO_LARGE', 'PNG 超过像素上限，请缩小范围或降低导出倍数。');
      }

      return { bytes: Buffer.from(image.asPng()), width: image.width, height: image.height };
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}

function exportHtml(
  board: Board,
  title: string,
  options: ExportOptions,
  region?: BoardElement,
  document?: BoardElement,
): string {
  if (document?.document) {
    return documentHtml(document.document, title, documentSurface(document, board.style));
  }
  if (region) {
    return String(region.html ?? '');
  }

  return buildBoardHtml(board, options);
}

async function exportImage(
  board: Board,
  format: 'svg' | 'png',
  title: string,
  options: ExportOptions,
  region?: BoardElement,
): Promise<ExportedArtifact> {
  let svg = region
    ? extractRegionSvg(String(region.html ?? ''), region.id)
    : buildBoardSvg(board, options);

  if (!svg && format === 'png') {
    throw new ExportError(
      'EXPORT_BROWSER_REQUIRED',
      '这个 HTML 区域需要浏览器排版，请在白板界面导出 PNG。',
    );
  }

  svg ||= buildBoardSvg(board, options);
  if (format === 'svg') {
    return {
      mimeType: 'image/svg+xml',
      filename: filenameFor(title, 'svg'),
      encoding: 'utf8',
      data: `${svg}\n`,
    };
  }

  const { bytes } = await renderSvgPng(svg, options);
  return {
    mimeType: 'image/png',
    filename: filenameFor(title, 'png'),
    encoding: 'base64',
    data: bytes.toString('base64'),
  };
}

function exportTarget(board: Board, options: ExportOptions) {
  const selected = selectedElements(board, options);
  const region = options.regionId ?? options.elementId;
  const single = selected.length === 1 ? selected[0] : undefined;
  const oneRegion = region && single && isHtmlRegionElement(single) ? single : undefined;
  const selectedById = region || (Array.isArray(options.ids) && options.ids.length === 1);
  const oneDocument = single?.type === 'document' && selectedById ? single : undefined;
  const title = oneRegion?.text || oneDocument?.text || board.artifact.title;
  return { selected, oneRegion, oneDocument, title };
}

export async function exportArtifact(
  board: Board,
  format: string,
  options: Record<string, unknown> = {},
): Promise<ExportedArtifact> {
  const { selected, oneRegion, oneDocument, title } = exportTarget(board, options);
  if (format === 'json') {
    return {
      mimeType: 'application/json',
      filename: filenameFor(title, 'json'),
      encoding: 'utf8',
      data: `${JSON.stringify({ ...board, elements: selected }, null, 2)}\n`,
    };
  }
  if (format === 'html') {
    return {
      mimeType: 'text/html',
      filename: filenameFor(title, 'html'),
      encoding: 'utf8',
      data: exportHtml(board, title, options, oneRegion, oneDocument),
    };
  }
  if (oneDocument && (format === 'svg' || format === 'png')) {
    throw new ExportError(
      'UNSUPPORTED_DOCUMENT_EXPORT',
      '文档全文请导出 HTML 或 JSON；白板图片只表示区域内的可见摘要。',
    );
  }
  if (format === 'svg' || format === 'png') {
    return exportImage(board, format, title, options, oneRegion);
  }

  throw new ExportError('UNSUPPORTED_EXPORT', '支持导出 HTML、SVG、PNG 和白板 JSON。');
}
