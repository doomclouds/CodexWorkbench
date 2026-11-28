import {
  sectionOverview,
  showsIdleHtmlCaption,
  usesSectionOverview,
} from './adapters/caption-metrics.js';
import type { CanvasObjectKind, CanvasRect } from './contracts.js';
import type { ProjectedCanvasObject, SceneIndex } from './scene/index.js';
import { rectContainsRect } from './viewport/index.js';

const captionObstacles = new Set<CanvasObjectKind>([
  'section',
  'html',
  'document',
  'todo',
  'diagram',
  'chart',
]);
const htmlCaptionLift = 28;

function availableWidth(index: SceneIndex, section: ProjectedCanvasObject, zoom: number) {
  const { x, y, width } = section.geometry;
  const gap = sectionOverview.gap / zoom;
  const height = sectionOverview.height / zoom;
  const caption: CanvasRect = { x, y: y - gap - height, width, height };
  const query = zoom >= 0.5 ? { ...caption, height: height + htmlCaptionLift } : caption;
  let available = width;

  for (const { projected, bounds } of index.queryEntries(query)) {
    const { id, kind } = projected.object;
    if (id === section.object.id || !captionObstacles.has(kind)) {
      continue;
    }

    const top =
      kind === 'html' && showsIdleHtmlCaption(projected.geometry.width, zoom)
        ? bounds.y - htmlCaptionLift
        : bounds.y;
    const outsideX = bounds.x >= x + available || bounds.x + bounds.width <= x;
    const outsideY = top >= caption.y + height || bounds.y + bounds.height <= caption.y;

    if (outsideX || outsideY) {
      continue;
    }

    const enclosing =
      kind === 'section' &&
      rectContainsRect(bounds, section.geometry) &&
      rectContainsRect(bounds, caption);

    if (!enclosing) {
      available = Math.max(0, bounds.x - x - gap);
      if (available * zoom < sectionOverview.minimumWidth) {
        return 0;
      }
    }
  }

  return available;
}

export function sectionCaptionWidths(
  index: SceneIndex,
  objects: readonly ProjectedCanvasObject[],
  zoom: number,
) {
  const widths = new Map<string, number>();
  if (!usesSectionOverview(zoom)) {
    return widths;
  }

  for (const section of objects) {
    const { object, geometry } = section;
    const fits =
      geometry.width * zoom >= sectionOverview.minimumWidth && geometry.height * zoom >= 12;

    if (object.kind !== 'section' || !object.label.trim() || !fits) {
      continue;
    }

    const width = availableWidth(index, section, zoom);
    if (width < geometry.width) {
      widths.set(object.id, width);
    }
  }

  return widths;
}
