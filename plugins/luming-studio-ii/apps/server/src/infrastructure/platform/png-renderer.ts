import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const maxSide = 16_384;
const maxPixels = 32_000_000;

let renderer: Promise<void> | undefined;
let fonts: Promise<Uint8Array[]> | undefined;

function fileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readOptional(path: string | URL) {
  try {
    return await readFile(path);
  } catch (error) {
    if (!fileMissing(error)) {
      throw error;
    }

    return undefined;
  }
}

async function initialize() {
  const bundled = await readOptional(new URL('./resvg.wasm', import.meta.url));
  const source =
    bundled ?? (await readFile(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
  await initWasm(source);
}

function fontConfiguration() {
  if (process.platform === 'win32') {
    const directory = join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts');
    const paths = ['msyh.ttc', 'segoeui.ttf', 'consola.ttf'].map((name) => join(directory, name));

    return { paths, defaultFontFamily: 'Microsoft YaHei' };
  }
  if (process.platform === 'darwin') {
    const paths = [
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
    ];

    return { paths, defaultFontFamily: 'PingFang SC' };
  }

  const paths = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];

  return { paths, defaultFontFamily: 'DejaVu Sans' };
}

async function readFonts() {
  const files = await Promise.all(fontConfiguration().paths.map(readOptional));

  return files.flatMap((bytes) => (bytes ? [bytes] : []));
}

function validImageSize(width: number, height: number) {
  const validWidth = width > 0 && width <= maxSide;
  const validHeight = height > 0 && height <= maxSide;

  return validWidth && validHeight && width * height <= maxPixels;
}

function withinCanvasLimit(svg: string) {
  const dimensions = /^<svg [^>]*\bwidth="([^"]+)" height="([^"]+)"/u.exec(svg);
  const width = Number(dimensions?.[1]);
  const height = Number(dimensions?.[2]);

  return validImageSize(Math.ceil(width), Math.ceil(height));
}

async function openSvg(svg: string, requireFont: boolean) {
  if (!withinCanvasLimit(svg)) {
    return undefined;
  }

  renderer ??= initialize();
  fonts ??= readFonts();
  const [fontBuffers] = await Promise.all([fonts, renderer]);
  if (requireFont && fontBuffers.length === 0 && /<text\b/u.test(svg)) {
    throw new Error('PNG export requires a readable system font for its text.');
  }

  const { defaultFontFamily } = fontConfiguration();
  return new Resvg(svg, { font: { fontBuffers, defaultFontFamily } });
}

export async function renderSvgPng(svg: string): Promise<Uint8Array | undefined> {
  const resvg = await openSvg(svg, true);
  if (!resvg) {
    return undefined;
  }

  try {
    if (!validImageSize(resvg.width, resvg.height)) {
      return undefined;
    }

    const image = resvg.render();
    try {
      return Uint8Array.from(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

export async function validateSvgUpload(svg: string): Promise<boolean> {
  try {
    const resvg = await openSvg(svg, false);
    if (!resvg) {
      return false;
    }

    try {
      return validImageSize(resvg.width, resvg.height);
    } finally {
      resvg.free();
    }
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('SVG data parsing failed'))) {
      throw error;
    }

    return false;
  }
}
