import type { CanvasObjectChange, CanvasRect } from '../contracts.js';
import { projectObject, projectedObjectBounds } from './index.js';
import type { ProjectedCanvasObject, SceneIndex } from './index.js';
import { rectsIntersect } from '../viewport/index.js';

type ProjectedMove = ReadonlyMap<string, ProjectedCanvasObject>;

function crossesBounds(previous: CanvasRect, next: CanvasRect, range: CanvasRect) {
  return rectsIntersect(previous, range) !== rectsIntersect(next, range);
}

export function projectMoveWithinWindow(
  index: SceneIndex,
  pending: ReadonlyMap<string, CanvasObjectChange>,
  changes: ReadonlyMap<string, CanvasObjectChange>,
  moved: readonly CanvasObjectChange[],
  bounds: { readonly window: CanvasRect; readonly visible: CanvasRect },
): ProjectedMove | undefined {
  const affected = new Set(moved.flatMap(({ id }) => [id, ...index.connectorsTo(id)]));
  const updates = new Map<string, ProjectedCanvasObject>();
  for (const id of affected) {
    const previous = projectObject(index, pending, id);
    const next = projectObject(index, changes, id);
    if (!previous || !next || previous === next) {
      continue;
    }

    const before = projectedObjectBounds(previous);
    const after = projectedObjectBounds(next);
    if (
      crossesBounds(before, after, bounds.window) ||
      crossesBounds(before, after, bounds.visible)
    ) {
      return undefined;
    }

    updates.set(id, next);
  }

  return updates;
}
