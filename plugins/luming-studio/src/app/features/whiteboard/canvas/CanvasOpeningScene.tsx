import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BoardOpenScene } from '../../../../contracts/board-open.js';
import type { BoardElement, StyleProfile } from '../../../../contracts/studio.js';
import { nativeFill } from '../../../../shared/native-surface.js';
import { semanticColor } from '../../../../shared/theme.js';
import {
  arrowGeometry,
  createArrowElementIndex,
  shapePath,
  strokePath,
  type ArrowElementIndex,
} from '../../../../shared/whiteboard-geometry.js';
import { canvasStyle, fitViewport } from './scene/canvas-model.js';
import {
  canReadCanvasText,
  canvasGridSpacing,
  overviewStrokeWidth,
  projectedSize,
} from './scene/canvas-presentation.js';
import { nativePaint } from './scene/native-palette.js';
import type { CanvasViewportExtent } from './scene/useCanvasVisibility.js';
import './canvas.css';

interface CanvasOpeningSceneProps {
  scene: BoardOpenScene;
  viewTheme?: 'light' | 'dark';
}

export function CanvasOpeningScene({ scene, viewTheme = 'light' }: CanvasOpeningSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [extent, setExtent] = useState<CanvasViewportExtent>();
  useLayoutEffect(() => {
    const viewport = host.current;
    if (!viewport) {
      return;
    }

    const measure = () => {
      const { clientWidth: width, clientHeight: height } = viewport;
      setExtent((previous) =>
        previous?.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(viewport);
    return () => observer?.disconnect();
  }, []);
  const elements = useMemo(
    () => scene.units.map((unit) => (unit.state === 'complete' ? unit.element : unit.geometry)),
    [scene.units],
  );
  const arrows = useMemo(() => createArrowElementIndex(elements), [elements]);
  const style = useMemo(() => canvasStyle(scene.style, viewTheme), [scene.style, viewTheme]);
  const viewport = useMemo(() => {
    if (!extent || !extent.width || !extent.height) {
      return undefined;
    }

    return fitViewport(elements, extent.width, extent.height);
  }, [elements, extent]);
  const sceneStyle = {
    '--canvas-paper': style.paper,
    '--studio-ink': style.ink,
  } as CSSProperties;
  const gridSize = viewport && canvasGridSpacing(viewport.zoom);

  return (
    <div
      className="studio-whiteboard"
      aria-busy="true"
      aria-label={scene.artifact.title}
      style={sceneStyle}
    >
      <div
        ref={host}
        className="studio-canvas-viewport"
        aria-hidden="true"
        style={
          viewport && {
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
            pointerEvents: 'none',
          }
        }
      >
        {viewport && (
          <svg
            className="studio-canvas-world"
            style={{
              width: 1,
              height: 1,
              overflow: 'visible',
              transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`,
            }}
            focusable="false"
          >
            {elements.map((element) => (
              <OpeningObject
                key={element.id}
                element={element}
                style={style}
                theme={viewTheme}
                arrows={arrows}
                zoom={viewport.zoom}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

interface OpeningObjectProps {
  element: BoardElement;
  style: StyleProfile;
  theme: 'light' | 'dark';
  arrows: ArrowElementIndex;
  zoom: number;
}

function OpeningObject({ element, style, theme, arrows, zoom }: OpeningObjectProps) {
  const { id, x, y, w, h, rotation, type } = element;
  const stroke = semanticColor(
    nativePaint(element.stroke ?? element.color, theme),
    style,
    style.muted,
  );
  const strokeWidth = overviewStrokeWidth(element.strokeWidth ?? 1, zoom);
  if (type === 'arrow') {
    const { points } = arrowGeometry(element, arrows);
    return (
      <polyline
        data-element-id={id}
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }

  const fontSize = element.fontSize ?? 17;
  const text =
    canReadCanvasText(projectedSize(element, zoom), fontSize, zoom) && element.text?.slice(0, 160);
  const fill = nativeFill(element, style, nativePaint(element.fill, theme));
  return (
    <g
      data-element-id={id}
      transform={`translate(${x} ${y}) rotate(${rotation ?? 0} ${w / 2} ${h / 2})`}
    >
      <OpeningOutline
        element={element}
        fill={fill}
        paper={style.paper}
        stroke={stroke}
        strokeWidth={strokeWidth}
        zoom={zoom}
      />
      {text && (
        <text x={4} y={fontSize} fontSize={fontSize} fill={style.ink}>
          {text}
        </text>
      )}
    </g>
  );
}

function OpeningOutline({
  element,
  fill,
  paper,
  stroke,
  strokeWidth,
  zoom,
}: {
  element: BoardElement;
  fill: string;
  paper: string;
  stroke: string;
  strokeWidth: number;
  zoom: number;
}) {
  const { type, kind, w, h } = element;
  if (type === 'text') {
    return (
      <rect width={w} height={Math.min(2 / zoom, h / 3)} y={h / 2} fill={stroke} opacity={0.25} />
    );
  }
  if (type === 'stroke') {
    return (
      <path
        d={strokePath(element.points)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    );
  }
  if (type === 'shape' && kind === 'ellipse') {
    return (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={w / 2}
        ry={h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (type === 'shape') {
    const path = shapePath(element);
    if (path) {
      return <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
    }
  }

  const corner = kind === 'rect' ? 0 : 7;
  const radius = kind === 'pill' ? h / 2 : corner;
  const outlineFill = fill === 'transparent' && type !== 'container' ? paper : fill;
  return (
    <rect
      width={w}
      height={h}
      rx={radius}
      fill={outlineFill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={0.8}
    />
  );
}
