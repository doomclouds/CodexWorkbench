import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CanvasPresentation, CanvasViewport } from '../../ui/domain/canvas/index.js';

interface WatchingBoard {
  readonly scope: CanvasPresentation;
  readonly viewport: CanvasViewport;
  readonly trigger?: HTMLButtonElement;
}

interface PresentationOptions {
  readonly objects: ReadonlyMap<string, { readonly kind: string }>;
  readonly viewport: CanvasViewport;
  readonly onRestore: (viewport: CanvasViewport) => void;
  readonly onFit: () => void;
  readonly focusCanvas: () => void;
}

export function useBoardPresentation({
  objects,
  viewport,
  onRestore,
  onFit,
  focusCanvas,
}: PresentationOptions) {
  const [watching, setWatching] = useState<WatchingBoard>();
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

    const [first] = objectIds;
    const kind = first ? objects.get(first)?.kind : undefined;
    const expandedObjectId =
      objectIds.length === 1 && (kind === 'document' || kind === 'todo') ? first : undefined;
    const focusObjectId = kind === 'document' ? expandedObjectId : undefined;

    setWatching({ scope: { objectIds, focusObjectId, expandedObjectId }, viewport, trigger });
    afterLayout(() => {
      if (!focusObjectId) {
        onFit();
        focusCanvas();
      }
    });
  }

  function exit() {
    if (!watching) {
      return;
    }

    setWatching(undefined);
    onRestore(watching.viewport);
    afterLayout(() => {
      if (watching.trigger?.isConnected) {
        watching.trigger.focus({ preventScroll: true });
      } else {
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

  return { scope: watching?.scope, enter, exit };
}
