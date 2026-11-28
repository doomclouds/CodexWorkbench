import { captureVectorRegion, loadRenderResource } from './vector-region.js';

type BrowserVectorRegion = Parameters<typeof captureVectorRegion>[0] & { readonly index: number };

interface BrowserVectorSource {
  readonly width: number;
  readonly height: number;
  readonly svgTemplate: string;
  readonly regions: readonly BrowserVectorRegion[];
}

const maxRenderSide = 16_384;
const maxRenderPixels = 32_000_000;
const maxSvgSize = 64 * 1024 * 1024;
const renderTimeout = 15_000;
const pngMimeType = 'image/png';
const markerPattern =
  /<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" data-studio-png-region="(\d+)"><\/div>|<g data-studio-png-region="(\d+)"><\/g>/gu;

function checkSize(width: number, height: number): void {
  const validWidth = width > 0 && width <= maxRenderSide;
  const validHeight = height > 0 && height <= maxRenderSide;
  if (!validWidth || !validHeight || width * height > maxRenderPixels) {
    throw new Error('PNG 超过尺寸上限。请缩小导出范围。');
  }
}

async function collectSvg(source: BrowserVectorSource, signal: AbortSignal): Promise<string> {
  const { svgTemplate, regions } = source;
  const placeholders = new Map<number, boolean>();
  for (const [, staticId, scriptedId] of svgTemplate.matchAll(markerPattern)) {
    const id = Number(staticId ?? scriptedId);
    if (placeholders.has(id)) {
      throw new Error('图解排版区域与已保存的白板不匹配。');
    }

    placeholders.set(id, scriptedId !== undefined);
  }
  if (placeholders.size !== regions.length) {
    throw new Error('PNG 排版区域与已保存的白板不匹配。');
  }

  const markup = new Map<number, string>();
  let size = svgTemplate.length;
  for (const region of regions) {
    signal.throwIfAborted();
    checkSize(region.width, region.height);
    if (placeholders.get(region.index) !== (region.scripted === true)) {
      throw new Error('图解排版区域与已保存的白板不匹配。');
    }

    placeholders.delete(region.index);
    const regionMarkup = await captureVectorRegion(region, signal);
    size += regionMarkup.length;
    if (size > maxSvgSize) {
      throw new Error('图解排版内容超过上限。请缩小导出范围。');
    }

    markup.set(region.index, regionMarkup);
  }

  return svgTemplate.replaceAll(
    markerPattern,
    (_marker, staticId?: string, scriptedId?: string) => {
      const key = Number(staticId ?? scriptedId);
      const region = markup.get(key);
      if (region === undefined) {
        throw new Error('图解排版区域与已保存的白板不匹配。');
      }

      markup.delete(key);

      return region;
    },
  );
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('PNG 编码失败。'));
      }
    }, pngMimeType);
  });
}

async function renderPng(svg: string, width: number, height: number, signal: AbortSignal) {
  checkSize(width, height);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const image = new Image();
  await loadRenderResource(
    image,
    () => {
      image.src = url;
    },
    signal,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器无法创建 PNG 画布。');
  }

  try {
    signal.throwIfAborted();
    context.drawImage(image, 0, 0, width, height);
    const blob = await encodePng(canvas);
    signal.throwIfAborted();

    return new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new Error('浏览器无法读取图片像素。请尝试导出 HTML。', { cause: error });
    }

    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function renderBrowserVectorExport(
  source: BrowserVectorSource,
  format: 'png' | 'svg',
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(renderTimeout);
  const rendering = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const svg = await collectSvg(source, rendering);
  rendering.throwIfAborted();
  if (format === 'svg') {
    return new TextEncoder().encode(svg);
  }

  return renderPng(svg, Math.ceil(source.width), Math.ceil(source.height), rendering);
}
