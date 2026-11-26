import {
  ArchiveObjectError,
  booleanValue,
  numberValue,
  optionalNumber,
  optionalString,
  record,
  sequence,
  type ArchiveData,
} from './scene-values.js';

interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneGeometry extends ScenePoint {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

const connectorPorts = new Set(['top', 'right', 'bottom', 'left']);
const connectorHeads = new Set(['none', 'arrow', 'circle']);
const transparentColors = new Set(['transparent', 'none']);
const transparentHex = /^#(?:[\da-f]{3}|[\da-f]{6}0)0$/iu;
const transparentRgba = /^rgba?\(\s*(?:[\d.%]+\s*,\s*){3}0(?:\.0+)?%?\s*\)$/iu;
const transparentRgbAlpha = /^rgba?\(\s*[\d.%]+(?:\s+[\d.%]+){2}\s*\/\s*0(?:\.0+)?%?\s*\)$/iu;

export function readGeometry(element: ArchiveData): SceneGeometry {
  const width = numberValue(element.w, 'object width');
  const height = numberValue(element.h, 'object height');
  if (width < 0 || height < 0) {
    throw new ArchiveObjectError('Archived object dimensions cannot be negative.');
  }

  return {
    x: numberValue(element.x, 'object x'),
    y: numberValue(element.y, 'object y'),
    width,
    height,
    rotation: optionalNumber(element.rotation, 'object rotation') ?? 0,
  };
}

export function appearance(element: ArchiveData): ArchiveData {
  const stroke =
    element.type === 'stroke' || element.type === 'arrow'
      ? (element.stroke ?? element.color)
      : element.stroke;

  return {
    fill: optionalString(element.fill, 'fill'),
    stroke: optionalString(stroke, 'stroke'),
    strokeWidth: optionalNumber(element.strokeWidth, 'stroke width'),
    dashed: booleanValue(element.dash, 'dashed stroke'),
    hollow: booleanValue(element.hollow, 'hollow object'),
  };
}

function endpoint(value: unknown, side: unknown, fallback: ScenePoint, ids: ReadonlySet<string>) {
  if (typeof value === 'string') {
    const port = optionalString(side, 'connector port');
    if (port !== undefined && !connectorPorts.has(port)) {
      throw new ArchiveObjectError('Invalid archived connector port.');
    }

    return { point: fallback, attachment: ids.has(value) ? { objectId: value, port } : undefined };
  }
  if (value === undefined) {
    return { point: fallback };
  }

  const coords = sequence(value, 'connector endpoint');
  if (coords.length !== 2) {
    throw new ArchiveObjectError('Invalid archived connector endpoint.');
  }

  return {
    point: { x: numberValue(coords[0], 'endpoint x'), y: numberValue(coords[1], 'endpoint y') },
  };
}

function coordinatePairs(values: readonly unknown[], field: string): readonly ScenePoint[] {
  if (values.length % 2 !== 0) {
    throw new ArchiveObjectError(`Invalid archived ${field} coordinates.`);
  }

  const points: ScenePoint[] = [];
  for (let index = 0; index < values.length; index += 2) {
    points.push({ x: numberValue(values[index], field), y: numberValue(values[index + 1], field) });
  }

  return points;
}

function connectorBends(value: unknown) {
  const bends = value === undefined ? [] : sequence(value, 'connector bends');
  const axis = bends[0];
  if (axis === 'h' || axis === 'v') {
    return {
      bends: [],
      relativeBends: {
        firstAxis: axis === 'h' ? 'horizontal' : 'vertical',
        offsets: bends.slice(1).map((offset) => numberValue(offset, 'connector bend offset')),
      },
    };
  }

  return { bends: coordinatePairs(bends, 'connector bend') };
}

function heads(element: ArchiveData) {
  if (element.heads === undefined) {
    return {
      startHead: element.head === 'both' ? 'arrow' : 'none',
      endHead: element.head === 'none' ? 'none' : 'arrow',
    };
  }

  const list = sequence(element.heads, 'connector heads');
  const startHead = list[0];
  const endHead = list[1];
  if (list.length !== 2 || typeof startHead !== 'string' || typeof endHead !== 'string') {
    throw new ArchiveObjectError('Invalid archived connector heads.');
  }
  if (!connectorHeads.has(startHead) || !connectorHeads.has(endHead)) {
    throw new ArchiveObjectError('Invalid archived connector heads.');
  }

  return { startHead, endHead };
}

function connectorLabelOffset(value: unknown): ScenePoint | undefined {
  if (value === undefined) {
    return;
  }

  const offset = record(value, 'connector label offset');

  return { x: numberValue(offset.x, 'label x offset'), y: numberValue(offset.y, 'label y offset') };
}

function connector(element: ArchiveData, geometry: SceneGeometry, ids: ReadonlySet<string>) {
  const { x, y, width, height } = geometry;

  return {
    kind: 'connector',
    start: endpoint(element.from, element.fromSide, { x, y }, ids),
    end: endpoint(element.to, element.toSide, { x: x + width, y: y + height }, ids),
    ...connectorBends(element.bends),
    labelOffset: connectorLabelOffset(element.labelOffset),
    ...heads(element),
  };
}

function transparentSection(element: ArchiveData): boolean {
  const fill = (optionalString(element.fill, 'section fill') ?? '').trim().toLowerCase();
  const hasNoColor = transparentColors.has(fill) || transparentHex.test(fill);
  const hasNoOpacity = transparentRgba.test(fill) || transparentRgbAlpha.test(fill);

  return element.hollow === true || hasNoColor || hasNoOpacity;
}

export function geometryDetail(
  element: ArchiveData,
  geometry: SceneGeometry,
  ids: ReadonlySet<string>,
): ArchiveData | undefined {
  switch (element.type) {
    case 'shape':
      return { kind: 'shape', outline: optionalString(element.kind, 'shape outline') ?? 'rounded' };
    case 'container':
      return { kind: 'section', transparent: transparentSection(element) };
    case 'arrow':
      return connector(element, geometry, ids);
    case 'stroke':
      return {
        kind: 'ink',
        width: optionalNumber(element.strokeWidth ?? element.width, 'ink width') ?? 3,
      };
  }
}

export function inkPoints(element: ArchiveData, { width, height }: SceneGeometry) {
  const values = element.points === undefined ? [] : sequence(element.points, 'ink points');

  return coordinatePairs(values, 'ink point').map(({ x, y }) => ({
    x: width === 0 ? x : x / width,
    y: height === 0 ? y : y / height,
  }));
}
