import { X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react';

import type { CanvasViewport } from '../../ui/domain/canvas/index.js';
import { useViewingInk, viewingLine } from './useViewingInk.js';
import { ViewingControls } from './ViewingControls.js';
import './whiteboard-viewing.css';

export interface WhiteboardViewingSurfaceProps {
  readonly active: boolean;
  readonly documentReading: boolean;
  readonly title: string;
  readonly viewport: CanvasViewport;
  readonly onZoom: (zoom: number) => void;
  readonly onFit: () => void;
  readonly onExit: () => void;
  readonly onCanvasFocus: () => void;
  readonly children: ReactNode;
}

const hintMs = 3500;
const acceptsSpace =
  'button, a[href], input, textarea, select, iframe, [contenteditable]:not([contenteditable="false"])';

function fromControl(event: KeyboardEvent<HTMLDivElement>, selector: string) {
  const ElementType = event.currentTarget.ownerDocument.defaultView?.Element;

  return (
    ElementType && event.target instanceof ElementType && Boolean(event.target.closest(selector))
  );
}

function isSpace({ code, key }: KeyboardEvent<HTMLDivElement>) {
  return code === 'Space' || key === ' ';
}

export function WhiteboardViewingSurface({
  active,
  documentReading,
  title,
  viewport,
  onZoom,
  onFit,
  onExit,
  onCanvasFocus,
  children,
}: WhiteboardViewingSurfaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const spaceHeld = useRef(false);
  const canvasReading = active && !documentReading;
  const [mode, setMode] = useState(canvasReading);
  const [marker, setMarker] = useState(false);
  const [hint, setHint] = useState(canvasReading);
  const ink = useViewingInk(root, viewport, canvasReading);

  if (mode !== canvasReading) {
    setMode(canvasReading);
    setHint(canvasReading);
    setMarker(false);
  }

  useLayoutEffect(() => {
    if (active) {
      exit.current?.focus({ preventScroll: true });
    }
  }, [active]);

  useLayoutEffect(() => {
    if (!canvasReading) {
      return;
    }

    const owner = root.current?.ownerDocument.defaultView;
    const timer = setTimeout(() => setHint(false), hintMs);
    const releaseSpace = () => {
      spaceHeld.current = false;
    };
    owner?.addEventListener('blur', releaseSpace);

    return () => {
      owner?.removeEventListener('blur', releaseSpace);
      releaseSpace();
      clearTimeout(timer);
    };
  }, [canvasReading]);

  function handleMarkerChange(enabled: boolean) {
    if (!enabled) {
      ink.cancel();
    }

    setMarker(enabled);
  }

  function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    const wantsPan = canvasReading && isSpace(event);
    if (!wantsPan || fromControl(event, acceptsSpace) || event.nativeEvent.isComposing) {
      return;
    }

    spaceHeld.current = true;
    ink.cancel();
  }

  function handleKeyUpCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (isSpace(event)) {
      spaceHeld.current = false;
    }
  }

  function handleBlurCapture(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    spaceHeld.current = false;
    ink.cancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const escaping = event.key === 'Escape' && !event.defaultPrevented;
    if (!active || !escaping || event.nativeEvent.isComposing) {
      return;
    }
    if (fromControl(event, 'dialog[open]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) {
      return;
    }

    if (ink.cancel()) {
      onCanvasFocus();

      return;
    }

    onExit();
  }

  function handlePointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    if (!canvasReading) {
      return;
    }

    setHint(false);
    if (marker && !spaceHeld.current && ink.begin(event)) {
      onCanvasFocus();
    }
  }

  return (
    <div
      ref={root}
      className="whiteboard-viewing"
      data-viewing={active || undefined}
      data-marker={(canvasReading && marker) || undefined}
      role={active ? 'region' : undefined}
      aria-label={active ? `全屏观看：${title}` : undefined}
      onKeyDown={handleKeyDown}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyUpCapture={handleKeyUpCapture}
      onBlurCapture={handleBlurCapture}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={ink.move}
      onPointerUpCapture={ink.finish}
      onPointerCancelCapture={ink.losePointer}
      onLostPointerCapture={ink.losePointer}
    >
      {children}
      {canvasReading && (
        <svg className="whiteboard-viewing__ink" aria-hidden="true" width="100%" height="100%">
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
            {ink.strokes.map(({ id, points, width, fading }) => (
              <path
                key={id}
                d={viewingLine(points)}
                strokeWidth={width}
                data-fading={fading || undefined}
              />
            ))}
            {ink.draft && (
              <path d={viewingLine(ink.draft.points)} strokeWidth={ink.draft.width} data-drawing />
            )}
          </g>
        </svg>
      )}
      {canvasReading && hint && (
        <div className="whiteboard-viewing__hint" role="status">
          全屏观看 · 按 <kbd>Esc</kbd> 退出
        </div>
      )}
      {canvasReading && (
        <button
          ref={exit}
          type="button"
          className="whiteboard-viewing__exit"
          data-whiteboard-viewing-chrome
          aria-label="退出全屏观看"
          title="退出全屏观看（Esc）"
          onClick={onExit}
        >
          <X size={18} />
          <span>退出全屏</span>
          <kbd>Esc</kbd>
        </button>
      )}
      {canvasReading && (
        <ViewingControls
          zoom={viewport.zoom}
          marker={marker}
          onMarker={handleMarkerChange}
          onClear={ink.clear}
          onFit={onFit}
          onZoom={onZoom}
          onCanvasFocus={onCanvasFocus}
          onInteract={() => setHint(false)}
        />
      )}
    </div>
  );
}
