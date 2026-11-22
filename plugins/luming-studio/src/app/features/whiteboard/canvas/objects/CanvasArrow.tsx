import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import type { ArrowElementIndex } from '../../../../../shared/whiteboard-geometry.js';
import { arrowGeometry, arrowHeads, type Point } from '../scene/canvas-model.js';
import {
  canReadCanvasText,
  overviewStrokeWidth,
  projectedSize,
} from '../scene/canvas-presentation.js';
import RichText from './RichText.js';

interface CanvasArrowProps {
  element: BoardElement;
  elementIndex: ArrowElementIndex;
  hidden: boolean;
  selected: boolean;
  annotationHovered: boolean;
  expanded: boolean;
  editing: boolean;
  editLabel?: ReactNode;
  color: string;
  paper: string;
  dash?: string;
  zoom: number;
  presentationZoom: number;
  onClickCapture: MouseEventHandler<SVGSVGElement>;
  onPointerDown: PointerEventHandler<SVGPathElement>;
  onDoubleClick: MouseEventHandler<SVGPathElement>;
}

interface ArrowMarkerProps {
  id: string;
  head: string;
  size: number;
  paper: string;
  color: string;
}

function ArrowMarker({ id, head, size, paper, color }: ArrowMarkerProps) {
  const round = head === 'circle';

  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX={round ? 5 : 8}
      refY="5"
      markerUnits="userSpaceOnUse"
      markerWidth={size}
      markerHeight={size}
      orient="auto-start-reverse"
    >
      {round ? (
        <circle cx="5" cy="5" r="3" fill={paper} stroke={color} strokeWidth="1.5" />
      ) : (
        <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke={color} strokeWidth="1.5" />
      )}
    </marker>
  );
}

interface ArrowLabelProps {
  element: BoardElement;
  center: Point;
  expanded: boolean;
  editing: boolean;
  editLabel?: ReactNode;
  presentationZoom: number;
}

function ArrowLabel({
  element,
  center,
  expanded,
  editing,
  editLabel,
  presentationZoom,
}: ArrowLabelProps) {
  const size = element.labelSize ?? { w: 200, h: 54 };
  const showLabel =
    expanded ||
    editing ||
    canReadCanvasText(projectedSize(size, presentationZoom), 13, presentationZoom);

  if (!showLabel || (!element.label && !editing)) {
    return null;
  }

  return (
    <foreignObject
      x={center.x - size.w / 2}
      y={center.y - (element.labelSize ? size.h / 2 : 28)}
      width={size.w}
      height={size.h}
      overflow="visible"
    >
      <div
        className="studio-arrow-label"
        style={element.labelSize ? { maxWidth: element.labelSize.w } : undefined}
      >
        {editing ? editLabel : <RichText text={element.label} />}
      </div>
    </foreignObject>
  );
}

export default function CanvasArrow({
  element,
  elementIndex,
  hidden,
  selected,
  annotationHovered,
  expanded,
  editing,
  editLabel,
  color,
  paper,
  dash,
  zoom,
  presentationZoom,
  onClickCapture,
  onPointerDown,
  onDoubleClick,
}: CanvasArrowProps) {
  const geometry = arrowGeometry(element, elementIndex);
  const endMarker = `studio-arrow-${element.id}`;
  const startMarker = `studio-arrow-start-${element.id}`;
  const [fromHead, toHead] = arrowHeads(element);
  const width = Number(element.strokeWidth ?? element.width ?? 1.8);

  return (
    <svg
      className={`studio-canvas-arrow${selected ? ' is-selected' : ''}${annotationHovered ? ' is-annotation-hovered' : ''}`}
      data-element-id={element.id}
      aria-label={element.label || '连接线'}
      style={{ overflow: 'visible', display: hidden ? 'none' : undefined }}
      onClickCapture={onClickCapture}
    >
      <defs>
        <ArrowMarker
          id={startMarker}
          head={fromHead}
          size={7 * width}
          paper={paper}
          color={color}
        />
        <ArrowMarker id={endMarker} head={toHead} size={7 * width} paper={paper} color={color} />
      </defs>
      {annotationHovered && (
        <path
          d={geometry.path}
          className="studio-annotation-hover-path"
          data-annotation-hover={element.id}
          fill="none"
          strokeWidth={width + 4 / zoom}
          pointerEvents="none"
          aria-hidden="true"
        />
      )}
      <path
        d={geometry.path}
        fill="none"
        stroke="transparent"
        strokeWidth={16 / zoom}
        pointerEvents="stroke"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      />
      <path
        d={geometry.path}
        fill="none"
        stroke={color}
        strokeWidth={overviewStrokeWidth(width, zoom)}
        strokeDasharray={expanded && element.dash ? '6 5' : dash}
        markerStart={fromHead !== 'none' ? `url(#${startMarker})` : undefined}
        markerEnd={toHead !== 'none' ? `url(#${endMarker})` : undefined}
        pointerEvents="none"
      />
      <ArrowLabel
        element={element}
        center={geometry.label}
        expanded={expanded}
        editing={editing}
        editLabel={editLabel}
        presentationZoom={presentationZoom}
      />
    </svg>
  );
}
