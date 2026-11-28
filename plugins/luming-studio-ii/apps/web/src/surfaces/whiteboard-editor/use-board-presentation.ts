import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CanvasPresentation, CanvasViewport } from '../../ui/domain/canvas/index.js';

interface WatchingBoard {
  readonly scope: CanvasPresentation & { readonly returnViewport: CanvasViewport };
  readonly trigger?: HTMLButtonElement;
}

interface PresentationOptions {
  readonly objects: ReadonlyMap<string, { readonly kind: string }>;
  readonly viewport: CanvasViewport;
  readonly initialFocus?: { readonly id: string; readonly returnViewport?: CanvasViewport };
  readonly onRestore: (viewport: CanvasViewport) => void;
  readonly onFit: () => void;
  readonly focusCanvas: () => void;
  readonly findViewingTrigger: () => HTMLButtonElement | undefined;
}

function presentationScope(
  objects: PresentationOptions['objects'],
  objectIds: readonly string[],
  returnViewport: CanvasViewport,
) {
  const [first] = objectIds;
  const kind = first ? objects.get(first)?.kind : undefined;
  const expandedObjectId =
    objectIds.length === 1 && (kind === 'document' || kind === 'todo') ? first : undefined;
  const focusObjectId = kind === 'document' ? expandedObjectId : undefined;

  return { objectIds, focusObjectId, expandedObjectId, returnViewport };
}

export function useBoardPresentation({
  objects,
  viewport,
  initialFocus,
  onRestore,
  onFit,
  focusCanvas,
  findViewingTrigger,
}: PresentationOptions) {
  const [watching, setWatching] = useState<WatchingBoard | undefined>(() =>
    initialFocus && objects.has(initialFocus.id)
      ? {
          scope: presentationScope(
            objects,
            [initialFocus.id],
            initialFocus.returnViewport ?? viewport,
          ),
        }
      : undefined,
  );
  const scheduled = useRef<number | undefined>(undefined);

  function afterLayout(callback: () => void) {
    if (scheduled.current !== undefined) {
      cancelAnimationFrame(scheduled.current);
    }

    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = undefined;
      callback();
    });
  }

  function enter(ids: readonly string[], trigger?: HTMLButtonElement) {
    const objectIds = ids.filter((id) => objects.has(id));
    if (watching || (ids.length > 0 && objectIds.length === 0)) {
      return;
    }

    const scope = presentationScope(objects, objectIds, viewport);
    setWatching({ scope, trigger });
    if (!scope.focusObjectId) {
      onFit();
      afterLayout(focusCanvas);
    }
  }

  function exit() {
    if (!watching) {
      return;
    }

    setWatching(undefined);
    onRestore(watching.scope.returnViewport);
    afterLayout(() => {
      const origin = watching.trigger;
      const trigger = origin?.isConnected ? origin : origin && findViewingTrigger();
      trigger?.focus({ preventScroll: true });
      if (!trigger || trigger.ownerDocument.activeElement !== trigger) {
        focusCanvas();
      }
    });
  }

  const exitWatching = useEffectEvent(exit);

  useEffect(() => {
    const ids = watching?.scope.objectIds;
    if (!ids?.length || ids.some((id) => objects.has(id))) {
      return;
    }

    const frame = requestAnimationFrame(() => exitWatching());

    return () => cancelAnimationFrame(frame);
  }, [objects, watching]);

  useEffect(
    () => () => {
      if (scheduled.current !== undefined) {
        cancelAnimationFrame(scheduled.current);
      }
    },
    [],
  );

  const scope = watching?.scope;
  const focusedObjectId = scope?.objectIds.length === 1 ? scope.objectIds[0] : undefined;

  return { scope, focusedObjectId, returnViewport: scope?.returnViewport, enter, exit };
}
