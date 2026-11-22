import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board } from '../../../../../contracts/studio.js';
import type { DocumentFocusSurface } from '../objects/document/DocumentRegion.js';
import { wheelZoomFactor, zoomAt, type Viewport } from '../scene/canvas-model.js';

interface ReadingSelection {
  ids: string[];
}

interface CanvasWheelOptions {
  viewportElement: RefObject<HTMLDivElement | null>;
  boardRef: RefObject<Board>;
  readingRef: RefObject<ReadingSelection | null>;
  documentFocusSurface: RefObject<DocumentFocusSurface | null>;
  viewportInteract: RefObject<(() => void) | undefined>;
  setViewport: Dispatch<SetStateAction<Viewport>>;
}

export function useCanvasWheel({
  viewportElement,
  boardRef,
  readingRef,
  documentFocusSurface,
  viewportInteract,
  setViewport,
}: CanvasWheelOptions) {
  useEffect(() => {
    const host = viewportElement.current;
    if (!host) {
      return;
    }

    const wheel = (event: WheelEvent) => {
      const readingIds = readingRef.current?.ids;
      const focusedId = readingIds?.length === 1 ? readingIds[0] : undefined;
      const focusedElement = focusedId
        ? boardRef.current.elements.find((element) => element.id === focusedId)
        : undefined;
      const zoomRequest = event.ctrlKey || event.metaKey;
      if (focusedElement?.type === 'document' && zoomRequest) {
        event.preventDefault();
        return;
      }
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        (event.target as HTMLElement).closest('[data-native-interactive]')
      ) {
        return;
      }

      event.preventDefault();
      viewportInteract.current?.();
      if (event.ctrlKey || event.metaKey) {
        const rect = host.getBoundingClientRect();
        documentFocusSurface.current?.setZoomAnchor({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        setViewport((current) =>
          zoomAt(
            current,
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            current.zoom * wheelZoomFactor(event.deltaY, event.deltaMode),
          ),
        );
      } else if (documentFocusSurface.current) {
        let factor = 1;
        if (event.deltaMode === 1) {
          factor = 16;
        } else if (event.deltaMode === 2) {
          factor = documentFocusSurface.current.clip.h;
        }
        documentFocusSurface.current.scrollBy({
          x: event.deltaX * factor,
          y: event.deltaY * factor,
        });
      } else {
        setViewport((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }));
      }
    };
    host.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => host.removeEventListener('wheel', wheel, true);
  }, [viewportElement, boardRef, readingRef, documentFocusSurface, viewportInteract, setViewport]);
}
