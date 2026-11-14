import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Board } from '../contracts/studio.js';
import { buildBoardHtml, buildBoardSvg, ExportError, extractRegionSvg, filenameFor, selectedElements, type ExportOptions } from './serialization.js';

export { buildBoardHtml, buildBoardSvg, ExportError, extractRegionSvg } from './serialization.js';
export interface ExportedArtifact { mimeType: string; filename: string; data: string; encoding?: 'base64' | 'utf8' }
let initialized: Promise<void> | undefined;
let fonts: Promise<Uint8Array[]> | undefined;
async function initializeRenderer(): Promise<void> {
  initialized ??= (async () => {
    const besideRuntime = fileURLToPath(new URL('./resvg.wasm', import.meta.url));
    let wasm: Uint8Array;
    try { wasm = await readFile(besideRuntime); }
    catch {
      try { wasm = await readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')); }
      catch { throw new ExportError('RENDERER_UNAVAILABLE', 'PNG 渲染资源缺失，请重新构建或更新插件。'); }
    }
    await initWasm(wasm);
  })();
  try { await initialized; } catch (error) { initialized = undefined; throw error; }
}
async function systemFontBuffers(): Promise<Uint8Array[]> {
  fonts ??= (async () => {
    const candidates = process.platform === 'win32'
      ? ['segoeui.ttf', 'msyh.ttc', 'consola.ttf'].map(name => join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', name))
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Menlo.ttc']
        : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
    const found = await Promise.all(candidates.map(async path => { try { return await readFile(path); } catch { return undefined; } }));
    return found.flatMap(value => value ? [new Uint8Array(value)] : []);
  })();
  return await fonts;
}
async function png(svg: string, options: ExportOptions): Promise<string> {
  if (/<foreignObject\b/i.test(svg)) throw new ExportError('EXPORT_BROWSER_REQUIRED', '完整 HTML 布局需要浏览器渲染，请在白板界面导出 PNG；也可以单独导出区域内的 SVG 图解。');
  if (/(?:href|xlink:href)\s*=\s*["'](?!#|data:image\/)/i.test(svg)) throw new ExportError('ASSET_NOT_EMBEDDED', 'PNG 导出包含尚未嵌入的外部资源，无法离线完整渲染。');
  await initializeRenderer();
  const fontBuffers = await systemFontBuffers();
  if (/<text\b/i.test(svg) && !fontBuffers.length) throw new ExportError('FONT_UNAVAILABLE', '未找到用于 PNG 渲染的系统字体，请使用 SVG 或从白板界面导出。');
  const scale = typeof options.scale === 'number' && Number.isFinite(options.scale) ? options.scale : 1;
  if (scale <= 0 || scale > 4) throw new ExportError('INVALID_EXPORT_SCALE', '导出缩放倍数必须大于 0 且不超过 4。');
  const renderer = new Resvg(svg, { font: { fontBuffers, defaultFontFamily: process.platform === 'win32' ? 'Microsoft YaHei' : process.platform === 'darwin' ? 'PingFang SC' : 'DejaVu Sans', defaultFontSize: 16 }, fitTo: { mode: 'zoom', value: scale } });
  try {
    const width = Math.ceil(renderer.width * scale); const height = Math.ceil(renderer.height * scale);
    if (width > 16384 || height > 16384 || width * height > 32_000_000) throw new ExportError('EXPORT_TOO_LARGE', 'PNG 超过 3200 万像素，请缩小范围或降低导出倍数。');
    const image = renderer.render();
    try { return Buffer.from(image.asPng()).toString('base64'); } finally { image.free(); }
  } finally { renderer.free(); }
}
export async function exportArtifact(board: Board, format: string, options: Record<string, unknown> = {}): Promise<ExportedArtifact> {
  const selected = selectedElements(board, options);
  const region = options.regionId ?? options.elementId;
  const oneRegion = region && selected.length === 1 && selected[0].type === 'html' ? selected[0] : undefined;
  const title = oneRegion?.text || board.artifact.title;
  if (format === 'json') return { mimeType: 'application/json', filename: filenameFor(title, 'json'), encoding: 'utf8', data: `${JSON.stringify({ ...board, elements: selected }, null, 2)}\n` };
  if (format === 'html') return { mimeType: 'text/html', filename: filenameFor(title, 'html'), encoding: 'utf8', data: oneRegion ? String(oneRegion.html ?? '') : buildBoardHtml(board, options) };
  if (format === 'svg' || format === 'png') {
    let svg = oneRegion ? extractRegionSvg(String(oneRegion.html ?? ''), oneRegion.id) : buildBoardSvg(board, options);
    if (!svg) {
      if (format === 'png') throw new ExportError('EXPORT_BROWSER_REQUIRED', '这个 HTML 区域需要浏览器排版，请在白板界面导出 PNG。');
      svg = buildBoardSvg(board, options);
    }
    if (format === 'svg') return { mimeType: 'image/svg+xml', filename: filenameFor(title, 'svg'), encoding: 'utf8', data: `${svg}\n` };
    return { mimeType: 'image/png', filename: filenameFor(title, 'png'), encoding: 'base64', data: await png(svg, options) };
  }
  throw new ExportError('UNSUPPORTED_EXPORT', '支持导出 HTML、SVG、PNG 和白板 JSON。');
}
