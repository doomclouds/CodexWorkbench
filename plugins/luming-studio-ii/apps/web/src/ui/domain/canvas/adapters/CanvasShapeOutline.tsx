import type { CanvasObjectDraft } from '../contracts.js';

type ShapeObject = Extract<CanvasObjectDraft, { kind: 'shape' }>;

interface CanvasShapeOutlineProps extends Pick<
  ShapeObject,
  'shape' | 'fill' | 'stroke' | 'strokeWidth' | 'dashed' | 'hollow'
> {
  width: number;
  height: number;
}

const roundedCorner = 7;
const queueInset = 14;
const defaultStrokeWidth = 1.4;
const dashPattern = '6 5';

function personPath(width: number, height: number) {
  const radius = Math.min(width * 0.19, height * 0.16);
  const center = width / 2;
  const head = height * 0.17;
  const left = width * 0.12;
  const right = width - left;
  const shoulder = height * 0.55;

  return [
    `M ${center - radius} ${head}`,
    `A ${radius} ${radius} 0 1 0 ${center + radius} ${head}`,
    `A ${radius} ${radius} 0 1 0 ${center - radius} ${head} Z`,
    `M ${left} ${height} V ${shoulder}`,
    `C ${left} ${height * 0.3} ${right} ${height * 0.3} ${right} ${shoulder}`,
    `V ${height} Z`,
  ].join(' ');
}

function databasePath(width: number, height: number) {
  return [
    `M 0 18 C 0 -6 ${width} -6 ${width} 18`,
    `V ${height - 18} C ${width} ${height + 6} 0 ${height + 6} 0 ${height - 18} Z`,
    `M 0 18 C 0 42 ${width} 42 ${width} 18`,
  ].join(' ');
}

function documentPath(width: number, height: number) {
  const edge = height - 15;

  return [
    `M 0 0 H ${width} V ${edge}`,
    `Q ${width * 0.75} ${height - 35} ${width / 2} ${edge}`,
    `Q ${width * 0.25} ${height + 5} 0 ${edge} Z`,
  ].join(' ');
}

function cloudPath(width: number, height: number) {
  const lowerEdge = height * 0.8;
  const upperEdge = height * -0.03;

  return [
    `M ${width * 0.2} ${lowerEdge}`,
    `C ${width * -0.08} ${lowerEdge} ${width * -0.03} ${height * 0.25} ${width * 0.25} ${height * 0.28}`,
    `C ${width * 0.27} ${upperEdge} ${width * 0.7} ${upperEdge} ${width * 0.75} ${height * 0.3}`,
    `C ${width * 1.07} ${height * 0.25} ${width * 1.09} ${lowerEdge} ${width * 0.8} ${lowerEdge} Z`,
  ].join(' ');
}

function queueOutline(width: number, height: number) {
  return (
    <>
      <rect width={width} height={height} />
      <path d={`M ${queueInset} 0 V ${height} M ${width - queueInset} 0 V ${height}`} fill="none" />
    </>
  );
}

function shapeOutline(shape: ShapeObject['shape'], width: number, height: number) {
  switch (shape) {
    case 'ellipse':
      return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} />;
    case 'diamond':
      return (
        <path
          d={`M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z`}
        />
      );
    case 'hexagon': {
      const inset = width * 0.18;

      return (
        <path
          d={`M ${inset} 0 H ${width - inset} L ${width} ${height / 2} L ${width - inset} ${height} H ${inset} L 0 ${height / 2} Z`}
        />
      );
    }
    case 'parallelogram':
      return <path d={`M ${width * 0.18} 0 H ${width} L ${width * 0.82} ${height} H 0 Z`} />;
    case 'database':
      return <path d={databasePath(width, height)} />;
    case 'queue':
      return queueOutline(width, height);
    case 'document':
      return <path d={documentPath(width, height)} />;
    case 'cloud':
      return <path d={cloudPath(width, height)} />;
    case 'person':
      return <path d={personPath(width, height)} />;
    case 'rect':
      return <rect width={width} height={height} />;
    case 'pill':
      return <rect width={width} height={height} rx={height / 2} />;
    case 'rounded':
    case undefined:
      return <rect width={width} height={height} rx={roundedCorner} />;
  }
}

function shapeColor(color: string | undefined) {
  return color === undefined ? undefined : `color-mix(in srgb, ${color} 100%, transparent)`;
}

export function CanvasShapeOutline({
  width,
  height,
  shape,
  fill,
  stroke,
  strokeWidth = defaultStrokeWidth,
  dashed,
  hollow,
}: CanvasShapeOutlineProps) {
  return (
    <svg
      className="studio-ui-canvas-shape-outline"
      aria-hidden="true"
      focusable="false"
      viewBox={`-2 -2 ${width + 4} ${height + 4}`}
      preserveAspectRatio="none"
      style={{
        fill: hollow ? 'none' : shapeColor(fill),
        stroke: shapeColor(stroke),
        strokeWidth,
        strokeDasharray: dashed ? dashPattern : undefined,
      }}
    >
      {shapeOutline(shape, width, height)}
    </svg>
  );
}
