import { useEffect, useEffectEvent } from 'react';
import type { CanvasFrame } from './canvas-frame.js';
import { translateConnection } from './connectors/geometry.js';
import type {
  CanvasGesturePreview,
  CanvasObject,
  CanvasObjectChange,
  CanvasProps,
} from './contracts.js';
import { scaleInk } from './ink/geometry.js';
import { isObjectLocked, type SceneIndex } from './scene/index.js';

const maximumPreviewObjects = 32;

function previewOutput(intent: CanvasFrame['preview']): CanvasGesturePreview | undefined {
  if (!intent || intent.kind === 'connect' || intent.changes.length > maximumPreviewObjects) {
    return;
  }

  return {
    kind: intent.kind,
    changes: intent.changes.map(({ id, expectedVersion, geometry }) => ({
      id,
      expectedVersion,
      geometry,
    })),
  };
}

export function useCanvasGesturePreview(
  intent: CanvasFrame['preview'],
  publish: CanvasProps['onGesturePreviewChange'],
  editable: boolean,
) {
  const send = useEffectEvent((preview: CanvasGesturePreview | undefined) => publish?.(preview));
  const enabled = publish !== undefined;
  useEffect(() => {
    if (enabled) {
      send(editable ? previewOutput(intent) : undefined);
    }
  }, [editable, enabled, intent]);
  useEffect(() => {
    if (enabled) {
      return () => send(undefined);
    }
  }, [enabled]);
}

function previewChange(
  index: SceneIndex,
  object: CanvasObject,
  change: CanvasObjectChange,
  kind: CanvasGesturePreview['kind'],
): CanvasObjectChange {
  if (object.kind === 'connector' && kind === 'move') {
    const base = index.getEntry(change.id)?.projected.geometry ?? object.geometry;
    const dx = change.geometry.x - base.x;
    const dy = change.geometry.y - base.y;

    return { ...change, connection: translateConnection(object.connection, { x: dx, y: dy }) };
  }
  if (object.kind === 'ink' && kind === 'resize') {
    return { ...change, ink: scaleInk(object.ink, object.geometry, change.geometry) };
  }

  return change;
}

function eligibleChange(
  index: SceneIndex,
  local: ReadonlyMap<string, CanvasObjectChange>,
  change: CanvasObjectChange,
): CanvasObject | undefined {
  const object = index.get(change.id);
  if (local.has(change.id) || object?.version !== change.expectedVersion) {
    return;
  }

  return isObjectLocked(index, change.id) ? undefined : object;
}

export function applyGesturePreviews(
  index: SceneIndex,
  local: ReadonlyMap<string, CanvasObjectChange>,
  frames: CanvasProps['remoteGesturePreviews'],
) {
  let projected: Map<string, CanvasObjectChange> | undefined;
  for (const { kind, changes } of frames ?? []) {
    for (const change of changes) {
      const object = eligibleChange(index, local, change);
      if (object) {
        projected ??= new Map(local);
        projected.set(change.id, previewChange(index, object, change, kind));
      }
    }
  }

  return projected ?? local;
}
