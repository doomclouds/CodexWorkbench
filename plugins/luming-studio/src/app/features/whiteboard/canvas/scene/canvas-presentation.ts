import type { BoardElement } from '../../../../../contracts/studio.js';
import { contains } from './canvas-model.js';

type Size = { w: number; h: number };
type Bounds = Size & { x: number; y: number };
export type TableDetail = 'full' | 'preview' | 'outline';
type SectionTitleDetail = { mode: 'full' } | { mode: 'overview'; width: number };

export const overviewSectionTitle = { fontSize: 12, height: 16, gap: 4 };

export function projectedSize(size: Size, zoom: number): Size {
  return { w: size.w * zoom, h: size.h * zoom };
}

export function canReadCanvasText(size: Size, fontSize: number, zoom: number): boolean {
  return size.w >= 32 && size.h >= 12 && fontSize * zoom >= 8;
}

export function showHtmlCaption(element: BoardElement, zoom: number): boolean {
  return element.type === 'html' && zoom >= 0.5 && element.w * zoom >= 96;
}

function overviewObstacles(elements: readonly BoardElement[], zoom: number) {
  if (zoom >= 1) {
    return [];
  }

  return elements
    .filter((element) =>
      ['container', 'html', 'diagram', 'document', 'todo'].includes(element.type),
    )
    .map((element) =>
      showHtmlCaption(element, zoom)
        ? { ...element, y: element.y - 28, h: element.h + 28 }
        : element,
    );
}

function overlapsBounds(left: Bounds, right: Bounds) {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function availableCaptionWidth(
  section: BoardElement,
  occupied: readonly BoardElement[],
  zoom: number,
  minimumWidth: number,
) {
  const { height, gap } = overviewSectionTitle;
  const caption = {
    x: section.x,
    y: section.y - (height + gap) / zoom,
    w: section.w,
    h: height / zoom,
  };

  for (const region of occupied) {
    const enclosingContainer =
      region.type === 'container' && contains(region, section) && contains(region, caption);

    if (region.id === section.id || !overlapsBounds(region, caption) || enclosingContainer) {
      continue;
    }

    caption.w = Math.max(0, region.x - section.x - gap / zoom);
    if (caption.w * zoom < minimumWidth) {
      break;
    }
  }

  return caption.w;
}

export function sectionTitleDetails(
  elements: readonly BoardElement[],
  zoom: number,
): Map<string, SectionTitleDetail> {
  const details = new Map<string, SectionTitleDetail>();
  const sections = elements.filter((element) => element.type === 'container');
  const { fontSize: minimumFont } = overviewSectionTitle;
  const minimumWidth = minimumFont * 2.5;

  const occupied = overviewObstacles(elements, zoom);
  for (const section of sections) {
    const size = projectedSize(section, zoom);
    const fontSize = section.fontSize ?? 17;
    if (canReadCanvasText(size, fontSize, zoom) && (zoom >= 1 || fontSize * zoom >= minimumFont)) {
      details.set(section.id, { mode: 'full' });
      continue;
    }

    const tooSmallForCaption = size.w < minimumWidth || size.h < 12;
    if (zoom >= 1 || tooSmallForCaption || !section.text?.trim()) {
      continue;
    }

    const width = availableCaptionWidth(section, occupied, zoom, minimumWidth);
    if (width * zoom >= minimumWidth) {
      details.set(section.id, { mode: 'overview', width });
    }
  }

  return details;
}

export function tableDetail(size: Size, fontSize: number, zoom: number): TableDetail {
  if (size.w < 96 || size.h < 44) {
    return 'outline';
  }
  if (size.w < 240 || size.h < 96 || fontSize * zoom < 8) {
    return 'preview';
  }

  return 'full';
}

export function mediaControlsFit(size: Size): boolean {
  return size.w >= 128 && size.h >= 72;
}

export function overviewStrokeWidth(width: number, zoom: number): number {
  return zoom < 0.5 ? Math.max(width, 0.7 / zoom) : width;
}

export function canvasGridSpacing(zoom: number): number {
  const spacing = 24 * zoom;

  return spacing >= 8 ? spacing : spacing * 2 ** Math.ceil(Math.log2(8 / spacing));
}
