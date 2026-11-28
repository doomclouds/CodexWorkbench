import {
  embedCaptionGap,
  embedCaptionHeight,
  hasEmbedCaption,
  sectionOverview,
  usesSectionOverview,
  type EmbedCaptionPlacement,
} from './adapters/caption-metrics.js';
import type { CanvasGeometry, CanvasObject, CanvasRect } from './contracts.js';
import type { ProjectedCanvasObject, SceneIndex } from './scene/index.js';
import { rectContainsRect } from './viewport/index.js';

interface CaptionLayout {
  readonly sectionWidths: ReadonlyMap<string, number>;
  readonly embedPlacements: ReadonlyMap<string, EmbedCaptionPlacement>;
}

function above(geometry: CanvasGeometry, height: number, gap: number): CanvasRect {
  const { x, y, width } = geometry;

  return { x, y: y - gap - height, width, height };
}

function intersects(a: CanvasRect, b: CanvasRect) {
  const x = a.x < b.x + b.width && b.x < a.x + a.width;
  const y = a.y < b.y + b.height && b.y < a.y + a.height;

  return x && y;
}

function sectionBand({ geometry }: ProjectedCanvasObject, zoom: number) {
  return usesSectionOverview(zoom)
    ? above(geometry, sectionOverview.height / zoom, sectionOverview.gap / zoom)
    : above(geometry, 25, 10);
}

function eligibleSection({ object, geometry }: ProjectedCanvasObject, zoom: number) {
  const fits =
    geometry.width * zoom >= sectionOverview.minimumWidth && geometry.height * zoom >= 12;

  return object.kind === 'section' && Boolean(object.label.trim()) && fits;
}

function eligibleEmbed({ object, geometry }: ProjectedCanvasObject, zoom: number) {
  const fits = geometry.width * zoom >= 64 && geometry.height * zoom >= 20;

  return hasEmbedCaption(object.kind) && Boolean(object.label.trim()) && fits;
}

function bodyBlocks(
  object: CanvasObject,
  bounds: CanvasRect,
  target: CanvasGeometry,
  band: CanvasRect,
) {
  if (object.kind === 'connector' || object.kind === 'ink' || !intersects(bounds, band)) {
    return false;
  }

  const enclosing =
    object.kind === 'section' && rectContainsRect(bounds, target) && rectContainsRect(bounds, band);

  return !enclosing;
}

function sectionWidth(index: SceneIndex, section: ProjectedCanvasObject, zoom: number) {
  const { geometry, object } = section;
  const rank = index.getEntry(object.id)?.layer ?? Infinity;
  const caption = sectionBand(section, zoom);
  const lift = (sectionOverview.height + sectionOverview.gap) / zoom;
  const candidate = { ...caption };

  for (const entry of index.queryEntries({ ...caption, height: caption.height + lift })) {
    const neighbor = entry.projected;
    if (neighbor.object.id === object.id) {
      continue;
    }

    const target = neighbor.object;
    const titleBlocks =
      entry.layer < rank &&
      eligibleSection(neighbor, zoom) &&
      intersects(sectionBand(neighbor, zoom), candidate);
    const blocks = bodyBlocks(target, entry.bounds, geometry, candidate);
    if (titleBlocks || blocks) {
      candidate.width = Math.max(0, entry.bounds.x - caption.x - sectionOverview.gap / zoom);
    }
    if (candidate.width * zoom < sectionOverview.minimumWidth) {
      return 0;
    }
  }

  return candidate.width;
}

function embedBands({ geometry }: ProjectedCanvasObject, zoom: number) {
  const height = embedCaptionHeight(zoom) / zoom;
  const gap = embedCaptionGap / zoom;
  const { x, y, width } = geometry;

  return {
    above: above(geometry, height, gap),
    inside: { x, y, width, height },
  };
}

function embedPlacement(
  index: SceneIndex,
  embedded: ProjectedCanvasObject,
  zoom: number,
  sectionWidths: CaptionLayout['sectionWidths'],
) {
  const bands = embedBands(embedded, zoom);
  const lift = Math.max((sectionOverview.height + sectionOverview.gap) / zoom, 35);
  const height = bands.above.height + embedCaptionGap / zoom + bands.inside.height + lift;
  const neighbors = index.queryEntries({ ...bands.above, height });
  const rank = index.getEntry(embedded.object.id)?.layer ?? Infinity;

  function blocked(band: CanvasRect, external: boolean) {
    return neighbors.some(({ projected, bounds, layer }) => {
      const { object } = projected;
      if (object.id === embedded.object.id) {
        return false;
      }
      if (bodyBlocks(object, bounds, embedded.geometry, band)) {
        return true;
      }

      if (eligibleSection(projected, zoom)) {
        const title = sectionBand(projected, zoom);
        const width = sectionWidths.get(object.id) ?? title.width;

        return width > 0 && intersects({ ...title, width }, band);
      }

      const canBlock = external && layer < rank && eligibleEmbed(projected, zoom);

      return canBlock && intersects(embedBands(projected, zoom).above, band);
    });
  }

  if (!blocked(bands.above, true)) {
    return 'above';
  }

  return blocked(bands.inside, false) ? undefined : 'inside';
}

function sectionCaptionWidths(
  index: SceneIndex,
  objects: readonly ProjectedCanvasObject[],
  zoom: number,
): CaptionLayout['sectionWidths'] {
  const widths = new Map<string, number>();
  if (!usesSectionOverview(zoom)) {
    return widths;
  }

  for (const section of objects) {
    if (!eligibleSection(section, zoom)) {
      continue;
    }

    const width = sectionWidth(index, section, zoom);
    if (width < section.geometry.width) {
      widths.set(section.object.id, width);
    }
  }

  return widths;
}

export function canvasCaptionLayout(
  index: SceneIndex,
  objects: readonly ProjectedCanvasObject[],
  zoom: number,
): CaptionLayout {
  const sectionWidths = sectionCaptionWidths(index, objects, zoom);
  const embedPlacements = new Map<string, EmbedCaptionPlacement>();

  for (const embedded of objects) {
    if (!eligibleEmbed(embedded, zoom)) {
      continue;
    }

    const placement = embedPlacement(index, embedded, zoom, sectionWidths);
    if (placement) {
      embedPlacements.set(embedded.object.id, placement);
    }
  }

  return { sectionWidths, embedPlacements };
}
