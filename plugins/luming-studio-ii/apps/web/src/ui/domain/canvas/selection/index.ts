import type { CanvasPoint, CanvasRect } from '../contracts.js';
import type { ProjectedCanvasObject } from '../scene/index.js';
import { containsPoint, getObjectBounds, rectsIntersect } from '../viewport/index.js';

export function hitTest(
  objects: readonly ProjectedCanvasObject[],
  point: CanvasPoint,
): string | undefined {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const entry = objects[index];
    if (entry && containsPoint(point, entry.geometry)) {
      return entry.object.id;
    }
  }

  return undefined;
}

export function marqueeSelection(
  objects: readonly ProjectedCanvasObject[],
  rect: CanvasRect,
  initialSelection?: readonly string[],
): readonly string[] {
  const selected = new Set(initialSelection);
  for (const { object, geometry } of objects) {
    if (rectsIntersect(getObjectBounds(geometry), rect)) {
      selected.add(object.id);
    }
  }

  return [...selected];
}

export function selectObject(
  selection: readonly string[],
  id: string,
  toggle: boolean,
): readonly string[] {
  if (!toggle) {
    return [id];
  }

  const selected = new Set(selection);
  if (!selected.delete(id)) {
    selected.add(id);
  }

  return [...selected];
}
