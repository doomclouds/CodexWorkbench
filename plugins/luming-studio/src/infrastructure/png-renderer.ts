import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debuglog } from 'node:util';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { SvgPngRenderer } from '../core/ports/png-renderer.js';
import { ExportError } from '../shared/serialization.js';

let initialized: Promise<void> | undefined;
let fonts: Promise<Uint8Array[]> | undefined;
const debug = debuglog('luming-studio');

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

export const renderSvgPng: SvgPngRenderer = async (svg, options = {}, maxPixels = 32_000_000) => {
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
};
