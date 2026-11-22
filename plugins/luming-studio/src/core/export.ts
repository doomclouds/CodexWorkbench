import type { Board, BoardElement } from '../contracts/studio.js';
import type { SvgPngRenderer } from './ports/png-renderer.js';
import {
  buildBoardHtml,
  buildBoardSvg,
  ExportError,
  extractRegionSvg,
  filenameFor,
  isHtmlRegionElement,
  selectedElements,
  type ExportOptions,
} from '../shared/serialization.js';
import { documentHtml } from '../shared/document-serialization.js';
import { documentSurface } from '../shared/document-surface.js';

export {
  buildBoardHtml,
  buildBoardSvg,
  ExportError,
  extractRegionSvg,
} from '../shared/serialization.js';

export interface ExportedArtifact {
  mimeType: string;
  filename: string;
  data: string;
  encoding?: 'base64' | 'utf8';
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
  renderSvgPng: SvgPngRenderer,
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
  renderSvgPng: SvgPngRenderer,
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
    return exportImage(renderSvgPng, board, format, title, options, oneRegion);
  }

  throw new ExportError('UNSUPPORTED_EXPORT', '支持导出 HTML、SVG、PNG 和白板 JSON。');
}
