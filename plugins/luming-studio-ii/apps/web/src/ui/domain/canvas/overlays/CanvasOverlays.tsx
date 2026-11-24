import type { PointerEvent } from 'react';
import type { CanvasRect, CanvasViewport } from '../contracts.js';
import type { ProjectedCanvasObject } from '../scene/index.js';
import { boardToScreen, normalizeViewport } from '../viewport/index.js';
import './CanvasOverlays.css';

const handleLabels = {
  nw: '缩放左上角',
  ne: '缩放右上角',
  sw: '缩放左下角',
  se: '缩放右下角',
  rotate: '旋转',
} as const;

type TransformHandle = keyof typeof handleLabels;

const transformHandles: readonly TransformHandle[] = ['nw', 'ne', 'sw', 'se', 'rotate'];

export interface CanvasOverlaysProps {
  readonly viewport: CanvasViewport;
  readonly selected: readonly ProjectedCanvasObject[];
  readonly marquee?: CanvasRect;
  readonly editableId?: string;
  readonly onHandlePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    id: string,
    handle: TransformHandle,
  ) => void;
}

function screenRect(rect: CanvasRect, viewport: CanvasViewport) {
  const { x, y } = boardToScreen(rect, viewport);
  return {
    left: x,
    top: y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
}

export function CanvasOverlays({
  viewport,
  selected,
  marquee,
  editableId,
  onHandlePointerDown,
}: CanvasOverlaysProps) {
  const view = normalizeViewport(viewport);

  function beginTransform(
    event: PointerEvent<HTMLButtonElement>,
    id: string,
    handle: TransformHandle,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    onHandlePointerDown(event, id, handle);
  }

  return (
    <div className="studio-ui-canvas-overlays">
      {selected.map(({ object, geometry }) => (
        <div
          key={object.id}
          className="studio-ui-canvas-selection-outline"
          style={{ ...screenRect(geometry, view), transform: `rotate(${geometry.rotation}deg)` }}
        >
          {object.id === editableId && !object.locked
            ? transformHandles.map((handle) => (
                <button
                  key={handle}
                  className="studio-ui-canvas-transform-handle"
                  data-canvas-handle={handle}
                  type="button"
                  tabIndex={-1}
                  aria-label={handleLabels[handle]}
                  onPointerDown={(event) => beginTransform(event, object.id, handle)}
                />
              ))
            : null}
        </div>
      ))}
      {marquee && (
        <div
          className="studio-ui-canvas-marquee"
          style={screenRect(marquee, view)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
