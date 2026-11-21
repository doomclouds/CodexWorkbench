import type { ReactNode } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import { shapePath } from '../../../../../shared/whiteboard-geometry.js';

export const SHAPES = [
  ['rounded', '圆角矩形'],
  ['rect', '矩形'],
  ['ellipse', '椭圆'],
  ['diamond', '菱形'],
  ['pill', '胶囊'],
  ['hexagon', '六边形'],
  ['parallelogram', '平行四边形'],
  ['database', '数据库'],
  ['queue', '队列'],
  ['document', '文档'],
  ['cloud', '云'],
  ['person', '人物'],
] as const;

export function Shape({ element }: { element: BoardElement }) {
  const { w, h, kind = 'rounded' } = element;
  const common = {
    fill: element.hollow ? 'none' : (element.fill ?? '#ffffff'),
    stroke: element.stroke ?? '#4f5d75',
    strokeWidth: Number(element.strokeWidth ?? element.width ?? 1.4),
    strokeDasharray: element.dash ? '6 5' : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const path = shapePath(element);
  if (!SHAPES.some(([value]) => value === kind)) {
    return <div className="studio-media-missing">不支持的形状：{kind}</div>;
  }

  let outline: ReactNode;
  if (kind === 'ellipse') {
    outline = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
  } else if (path) {
    outline = <path d={path} {...common} />;
  } else {
    const squareCorners = kind === 'rect' || kind === 'queue';
    let radius = squareCorners ? 0 : 7;
    if (kind === 'pill') {
      radius = h / 2;
    }
    outline = <rect width={w} height={h} rx={radius} {...common} />;
  }
  return (
    <svg
      className="studio-shape-svg"
      viewBox={`-2 -2 ${w + 4} ${h + 4}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {outline}
      {kind === 'queue' && (
        <path d={`M 14 0 V ${h} M ${w - 14} 0 V ${h}`} {...common} fill="none" />
      )}
    </svg>
  );
}
