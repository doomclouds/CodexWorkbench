import type { CanvasProjection } from './canvas-creation.js';
import type { CanvasPoint, CanvasViewport } from './contracts.js';
import { getMoveSnapBounds, prepareSnapCandidates, snapMove } from './gestures/index.js';
import type { TransformGesture } from './gestures/index.js';
import { queryScene } from './scene/index.js';
import { getObjectBounds, getViewportBounds } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

interface AlignmentSnapshot extends CanvasProjection {
  readonly size: CanvasViewportSize;
  readonly viewport: CanvasViewport;
  readonly candidates: ReturnType<typeof prepareSnapCandidates>;
}

const snappingOverscan = 12;
const snapshots = new WeakMap<TransformGesture, AlignmentSnapshot>();

function moveCandidates(
  transform: TransformGesture,
  viewport: CanvasViewport,
  view: CanvasProjection & { size: CanvasViewportSize },
) {
  const { index, pending, size } = view;
  const cached = snapshots.get(transform);
  if (cached?.index === index && cached.pending === pending) {
    if (cached.viewport === viewport && cached.size === size) {
      return cached.candidates;
    }
  }

  const bounds = getViewportBounds(viewport, size, snappingOverscan);
  const excluded = new Set(transform.targets.map(({ id }) => id));
  const references = queryScene(index, bounds, pending)
    .filter(
      ({ object }) =>
        !excluded.has(object.id) && object.kind !== 'ink' && object.kind !== 'connector',
    )
    .map(({ geometry }) => getObjectBounds(geometry));
  const candidates = prepareSnapCandidates(references);
  snapshots.set(transform, { index, pending, size, viewport, candidates });

  return candidates;
}

export function snapObjectMove(
  transform: TransformGesture,
  point: CanvasPoint,
  viewport: CanvasViewport,
  view: CanvasProjection & { size: CanvasViewportSize },
) {
  const bounds = getMoveSnapBounds(transform, point);

  return bounds && snapMove(bounds, moveCandidates(transform, viewport, view), viewport.zoom);
}
