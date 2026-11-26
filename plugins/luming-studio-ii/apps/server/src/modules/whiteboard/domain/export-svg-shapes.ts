import type { Appearance } from './model.js';

const palette = new Map([
  ['paper', '#f5f5f5'],
  ['paper-2', '#ececec'],
  ['ink', '#2d3142'],
  ['muted', '#4f5d75'],
  ['accent', '#eb6c36'],
  ['link', '#2e5aa8'],
  ['soft', '#68738a'],
  ['rule', '#bfc0c0'],
  ['ink-strong', '#111111'],
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['transparent', 'transparent'],
  ['yellow', '#f6e39c'],
  ['peach', '#f4c3a4'],
  ['pink', '#edbdd5'],
  ['green', '#bcd6be'],
  ['blue', '#b8d2ed'],
  ['purple', '#d0c0e5'],
  ['terracotta', '#b64e2a'],
  ['none', 'none'],
]);
const colorLiteral = /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|rgba?\([-\d., %/]+\))$/iu;
const canvasTint =
  /^color-mix\(in srgb, *canvas (100|[1-9]?\d)%, *(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8}))\)$/iu;
const defaultStrokeWidth = 1.4;
const maximumStrokeWidth = 256;

export function svgColor(value: string | undefined, fallback: string): string {
  const color = value?.trim().toLowerCase() ?? '';
  const tint = canvasTint.exec(color);
  if (tint) {
    return `color-mix(in srgb, #f5f5f5 ${tint[1]}%, ${tint[2]})`;
  }

  return palette.get(color) ?? (colorLiteral.test(color) ? color : fallback);
}

export function svgStrokeWidth(value: number | undefined, fallback = defaultStrokeWidth): number {
  return value !== undefined && value >= 0 && value <= maximumStrokeWidth ? value : fallback;
}

function databaseShape(width: number, height: number) {
  const top = Math.min(18, height / 4);
  const lower = height - top;
  const rim = (top * 4) / 3;

  return `<path d="M 0 ${top} C 0 ${top - rim} ${width} ${top - rim} ${width} ${top} V ${lower} C ${width} ${lower + rim} 0 ${lower + rim} 0 ${lower} Z M 0 ${top} C 0 ${top + rim} ${width} ${top + rim} ${width} ${top}"/>`;
}

function documentShape(width: number, height: number) {
  const fold = Math.min(15, height / 3);

  return `<path d="M 0 0 H ${width} V ${height - fold} Q ${width * 0.75} ${height - fold * 2} ${width / 2} ${height - fold} Q ${width * 0.25} ${height + fold / 3} 0 ${height - fold} Z"/>`;
}

function personShape(width: number, height: number) {
  const radius = Math.min(width * 0.19, height * 0.16);
  const center = width / 2;
  const y = height * 0.17;
  const left = width * 0.12;
  const right = width - left;
  const shoulder = height * 0.55;

  return `<circle cx="${center}" cy="${y}" r="${radius}"/><path d="M ${left} ${height} V ${shoulder} C ${left} ${height * 0.3} ${right} ${height * 0.3} ${right} ${shoulder} V ${height} Z"/>`;
}

function cloudShape(width: number, height: number) {
  const edge = height * 0.8;

  return `<path d="M ${width * 0.2} ${edge} C ${width * -0.08} ${edge} ${width * -0.03} ${height * 0.25} ${width * 0.25} ${height * 0.28} C ${width * 0.27} ${height * -0.03} ${width * 0.7} ${height * -0.03} ${width * 0.75} ${height * 0.3} C ${width * 1.07} ${height * 0.25} ${width * 1.09} ${edge} ${width * 0.8} ${edge} Z"/>`;
}

function shapeOutline(shape: string, width: number, height: number): string | undefined {
  switch (shape) {
    case 'rect':
      return `<rect width="${width}" height="${height}"/>`;
    case 'rounded':
      return `<rect width="${width}" height="${height}" rx="${Math.min(7, width / 2, height / 2)}"/>`;
    case 'pill':
      return `<rect width="${width}" height="${height}" rx="${Math.min(width, height) / 2}"/>`;
    case 'ellipse':
      return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"/>`;
    case 'diamond':
      return `<path d="M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z"/>`;
    case 'hexagon': {
      const inset = width * 0.18;

      return `<path d="M ${inset} 0 H ${width - inset} L ${width} ${height / 2} L ${width - inset} ${height} H ${inset} L 0 ${height / 2} Z"/>`;
    }
    case 'parallelogram':
      return `<path d="M ${width * 0.18} 0 H ${width} L ${width * 0.82} ${height} H 0 Z"/>`;
    case 'database':
      return databaseShape(width, height);
    case 'queue': {
      const inset = Math.min(14, width / 3);

      return `<rect width="${width}" height="${height}"/><path d="M ${inset} 0 V ${height} M ${width - inset} 0 V ${height}" fill="none"/>`;
    }
    case 'document':
      return documentShape(width, height);
    case 'person':
      return personShape(width, height);
    case 'cloud':
      return cloudShape(width, height);
    default:
      return undefined;
  }
}

export function svgShape(
  shape: string,
  width: number,
  height: number,
  appearance?: Appearance,
): string | undefined {
  const outline = shapeOutline(shape, width, height);
  if (outline === undefined) {
    return undefined;
  }

  const fill = appearance?.hollow ? 'none' : svgColor(appearance?.fill, '#ececec');
  const stroke = svgColor(appearance?.stroke, '#68738a');
  const strokeWidth = svgStrokeWidth(appearance?.strokeWidth);
  const dashed = appearance?.dashed ? ' stroke-dasharray="6 5"' : '';

  return `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashed}>${outline}</g>`;
}
