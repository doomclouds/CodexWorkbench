import { stickerDefinition } from './sticker-catalog.js';
import type { StickerPrimitive } from './sticker-catalog.js';
import './sticker.css';

export interface StickerObjectProps {
  readonly id?: string;
  readonly fallback?: string;
}

function renderGraphic(graphic: StickerPrimitive, index: number) {
  switch (graphic.kind) {
    case 'path':
      return <path key={index} d={graphic.d} fill={graphic.fill} />;
    case 'circle':
      return (
        <circle key={index} cx={graphic.cx} cy={graphic.cy} r={graphic.r} fill={graphic.fill} />
      );
    case 'rect':
      return (
        <rect
          key={index}
          x={graphic.x}
          y={graphic.y}
          width={graphic.width}
          height={graphic.height}
          rx={graphic.rx}
          fill={graphic.fill}
        />
      );
  }
}

export function StickerObject({ id, fallback }: StickerObjectProps) {
  const sticker = stickerDefinition(id);
  if (!sticker) {
    return fallback ? <span className="luming-sticker-fallback">{fallback}</span> : null;
  }

  const graphics = sticker.graphics.map(renderGraphic);

  return (
    <svg
      className="luming-sticker-picture"
      viewBox="0 0 24 24"
      role="img"
      aria-label={sticker.label}
      data-sticker-icon-id={sticker.id}
    >
      <g strokeLinecap="round" strokeLinejoin="round">
        <g stroke="#ffffff" strokeWidth="4">
          {graphics}
        </g>
        <g stroke="#273443" strokeWidth="1.3">
          {graphics}
        </g>
      </g>
    </svg>
  );
}
