import { DEFAULT_STYLE, type Board, type BoardElement } from '../../contracts/studio.js';
import {
  boardBounds,
  buildBoardSvg,
  ExportError,
  filenameFor,
  isHtmlRegionElement,
  type ExportOptions,
} from '../../shared/serialization.js';
import type { ExportBytes } from '../ports/export-copy-store.js';
import { MAX_THUMBNAIL_BYTES } from '../shared/thumbnails.js';

const WIDTH = 560;
const HEIGHT = 320;
const PADDING = 16;
const MAX_OVERVIEW_OBJECTS = 160;
const MAX_WORLD_COORDINATE = 1_000_000;
const MAX_LABEL_LENGTH = 60;

const REGION_LABELS: Partial<Record<BoardElement['type'], string>> = {
  html: 'HTML 区域',
  diagram: '图解',
  document: '文档',
  todo: '任务清单',
  image: '图片',
  table: '表格',
};

function embeddedSourceExceedsBudget(board: Board): boolean {
  let bytes = 0;
  for (const element of board.elements) {
    if (isHtmlRegionElement(element) && typeof element.html === 'string') {
      bytes += Buffer.byteLength(element.html);
    }
    if (typeof element.src === 'string' && element.src.startsWith('data:')) {
      bytes += Buffer.byteLength(element.src);
    }
    if (bytes > MAX_THUMBNAIL_BYTES) {
      return true;
    }
  }

  return false;
}

function coordinate(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_WORLD_COORDINATE, Math.max(minimum, value))
    : fallback;
}

function overviewGeometry(element: BoardElement, index: number): BoardElement {
  return {
    id: `preview-${index}`,
    type: 'shape',
    version: element.version,
    x: coordinate(element.x, -MAX_WORLD_COORDINATE, 0),
    y: coordinate(element.y, -MAX_WORLD_COORDINATE, 0),
    w: coordinate(element.w, 1, 220),
    h: coordinate(element.h, 1, 120),
    ...(Number.isFinite(element.rotation) ? { rotation: element.rotation! % 360 } : {}),
  };
}

function color(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function overviewLabel(element: BoardElement, width: number, height: number): string | undefined {
  if (width < 64 || height < 26) {
    return;
  }

  const snippet = typeof element.html === 'string' ? element.html.slice(0, 2_048) : '';
  const heading = snippet.match(/<(?:title|h1)\b[^>]*>([^]*?)<\/(?:title|h1)>/i)?.[1];
  const text = typeof element.text === 'string' ? element.text : undefined;
  const value = text || heading?.replace(/<[^>]*>/g, '') || REGION_LABELS[element.type];

  return value
    ?.slice(0, MAX_LABEL_LENGTH)
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/\s+/g, ' ')
    .trim();
}

function overviewElements(board: Board, style: Board['style']): BoardElement[] {
  const geometry = board.elements.map(overviewGeometry);
  const bounds = boardBounds(geometry, 0);
  const scale = Math.min(
    (WIDTH - PADDING * 2) / bounds.width,
    (HEIGHT - PADDING * 2) / bounds.height,
  );
  const offsetX = (WIDTH - bounds.width * scale) / 2;
  const offsetY = (HEIGHT - bounds.height * scale) / 2;
  const count = Math.min(MAX_OVERVIEW_OBJECTS, geometry.length);

  return Array.from({ length: count }, (_, slot) => {
    const index = Math.floor((slot * geometry.length) / count);
    const frame = geometry[index]!;
    const source = board.elements[index]!;
    const w = Math.max(1, frame.w * scale);
    const h = Math.max(1, frame.h * scale);

    return {
      ...frame,
      x: offsetX + (frame.x - bounds.x) * scale,
      y: offsetY + (frame.y - bounds.y) * scale,
      w,
      h,
      kind: 'roundrect',
      fill: color(source.fill, style.paper),
      stroke: color(source.stroke, style.muted),
      strokeWidth: 1,
      color: style.ink,
      fontSize: 12,
      text: overviewLabel(source, w, h),
    };
  });
}

function overview(board: Board): ExportBytes {
  const style = {
    ...DEFAULT_STYLE,
    paper: color(board.style.paper, DEFAULT_STYLE.paper),
    ink: color(board.style.ink, DEFAULT_STYLE.ink),
    muted: color(board.style.muted, DEFAULT_STYLE.muted),
  };
  const viewport = {
    width: WIDTH,
    height: HEIGHT,
    bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  };
  const artifact = { ...board.artifact, title: board.artifact.title.slice(0, MAX_LABEL_LENGTH) };
  const projected = { artifact, style, elements: overviewElements(board, style) };

  return {
    filename: filenameFor(board.artifact.title, 'svg'),
    mimeType: 'image/svg+xml',
    encoding: 'utf8',
    data: buildBoardSvg(projected, {}, viewport),
  };
}

async function renderDetailed(render: (options: ExportOptions) => Promise<ExportBytes>) {
  try {
    return await render({ padding: PADDING, svgRegions: true });
  } catch (error) {
    if (!(error instanceof ExportError) || error.code !== 'EXPORT_BROWSER_REQUIRED') {
      throw error;
    }

    return render({ padding: PADDING });
  }
}

export async function whiteboardThumbnail(
  board: Board,
  render: (options: ExportOptions) => Promise<ExportBytes>,
): Promise<ExportBytes> {
  if (embeddedSourceExceedsBudget(board)) {
    return overview(board);
  }

  const detailed = await renderDetailed(render);

  return Buffer.byteLength(detailed.data) > MAX_THUMBNAIL_BYTES ? overview(board) : detailed;
}
