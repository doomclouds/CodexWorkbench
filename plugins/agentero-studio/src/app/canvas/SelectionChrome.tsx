import type { CSSProperties, PointerEvent } from 'react';
import type { Rect } from './canvas-model.js';
import type { ResizeHandle } from './native-geometry.js';

const CORNERS = [{ handle: 'nw', x: 0, y: 0 }, { handle: 'ne', x: 1, y: 0 }, { handle: 'se', x: 1, y: 1 }, { handle: 'sw', x: 0, y: 1 }] as const;
const EDGES = ['n', 'e', 's', 'w'] as const;

export default function SelectionChrome({ bounds, zoom, locked, rotation = 0, resizable = true, rotatable = true, edges = EDGES, onResize, onRotate }: {
  bounds: Rect; zoom: number; rotation?: number; locked: boolean; resizable?: boolean; rotatable?: boolean; edges?: readonly ResizeHandle[];
  onResize: (event: PointerEvent, handle: ResizeHandle) => void; onRotate: (event: PointerEvent) => void;
}) {
  const cursor = (handle: ResizeHandle) => ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][({ nw: 1, n: 2, ne: 3, e: 0, se: 1, s: 2, sw: 3, w: 0 }[handle] + Math.round(rotation / 45) + 8) % 4];
  return <div className="studio-selection-frame" style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h, borderWidth: 1 / zoom, transform: rotation ? `rotate(${rotation}deg)` : undefined }}>
    {!locked && rotatable && CORNERS.map(({ handle, x, y }) => <button type="button" key={`rotate-${handle}`} className="studio-rotate-hit" aria-label={`旋转所选元素 ${handle}`} style={{ left: x ? '100%' : -28 / zoom, top: y ? '100%' : -28 / zoom, width: 28 / zoom, height: 28 / zoom }} onPointerDown={onRotate} />)}
    {!locked && resizable && edges.map(handle => {
      const horizontal = handle === 'n' || handle === 's';
      const style: CSSProperties = horizontal
        ? { left: 12 / zoom, right: 12 / zoom, top: handle === 'n' ? -4 / zoom : undefined, bottom: handle === 's' ? -4 / zoom : undefined, height: 8 / zoom }
        : { top: 12 / zoom, bottom: 12 / zoom, left: handle === 'w' ? -4 / zoom : undefined, right: handle === 'e' ? -4 / zoom : undefined, width: 8 / zoom };
      return <button type="button" key={handle} className="studio-selection-edge" aria-label={`调整元素大小 ${handle}`} style={{ ...style, cursor: cursor(handle) }} onPointerDown={event => onResize(event, handle)} />;
    })}
    {(locked || resizable) && CORNERS.map(({ handle, x, y }) => locked
      ? <span key={handle} className="studio-selection-corner is-locked" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: 8 / zoom, height: 8 / zoom, borderWidth: 1.5 / zoom }} />
      : <button type="button" key={handle} className={`studio-selection-corner handle-${handle}`} aria-label={`调整元素大小 ${handle}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: 10 / zoom, height: 10 / zoom, borderWidth: 1.5 / zoom, cursor: cursor(handle) }} onPointerDown={event => onResize(event, handle)} />)}
  </div>;
}
