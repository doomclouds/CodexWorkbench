interface Point {
  readonly x: number;
  readonly y: number;
}

interface Geometry extends Point {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

type Port = "top" | "right" | "bottom" | "left";

export interface ConnectorTarget {
  readonly fallback: Point;
  readonly geometry?: Geometry;
  readonly port?: Port;
}

interface RelativeBends {
  readonly firstAxis: "horizontal" | "vertical";
  readonly offsets: readonly number[];
}

interface Terminal {
  readonly point: Point;
  readonly normal?: Point;
}

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ConnectorSegment {
  readonly start: Point;
  readonly end: Point;
  readonly turn?: Point;
}

const normals: Readonly<Record<Port, Point>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const epsilon = 1e-7;
const clearance = 18;
const objectPadding = 8;
const cornerRadius = 8;
const maximumRelativeBends = 12;
export const connectorArrowHalfWidthRatio = 2.5;

function finite({ x, y }: Point) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function center({ x, y, width, height }: Geometry): Point {
  return { x: x + width / 2, y: y + height / 2 };
}

function delta(from: Point, to: Point): Point {
  return { x: to.x - from.x, y: to.y - from.y };
}

function magnitude({ x, y }: Point) {
  return Math.hypot(x, y);
}

function dot(left: Point, right: Point) {
  return left.x * right.x + left.y * right.y;
}

function rotate({ x, y }: Point, degrees: number): Point {
  const radians = ((degrees % 360) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  return { x: Math.abs(rx) < epsilon ? 0 : rx, y: Math.abs(ry) < epsilon ? 0 : ry };
}

function offset(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

export function connectorPortPoint(geometry: Geometry, port: Port, along = 0): Point {
  const normal = rotate(normals[port], geometry.rotation);
  const half = normals[port].x ? geometry.width / 2 : geometry.height / 2;
  return offset(center(geometry), normal, half + along);
}

function facingCenter(target: ConnectorTarget) {
  const position = target.geometry && center(target.geometry);
  return position && finite(position) ? position : target.fallback;
}

function facingPort(geometry: Geometry, other: Point): Port {
  const { x, y } = rotate(delta(center(geometry), other), -geometry.rotation);
  if (Math.abs(x) > Math.abs(y)) {
    return x >= 0 ? "right" : "left";
  }
  return y >= 0 ? "bottom" : "top";
}

function terminal(target: ConnectorTarget, other: Point): Terminal {
  const { fallback, geometry } = target;
  if (!geometry) {
    return { point: fallback };
  }

  const port = target.port ?? facingPort(geometry, other);
  const point = connectorPortPoint(geometry, port);
  return finite(point)
    ? { point, normal: rotate(normals[port], geometry.rotation) }
    : { point: fallback };
}

function horizontal(normal: Point | undefined) {
  return normal && Math.abs(normal.x) >= Math.abs(normal.y);
}

function orthogonal(from: Point, to: Point, alongX: boolean, lane: number) {
  return alongX
    ? [from, { x: lane, y: from.y }, { x: lane, y: to.y }, to]
    : [from, { x: from.x, y: lane }, { x: to.x, y: lane }, to];
}

function originalRoute(start: Terminal, end: Terminal) {
  const from = start.point;
  const to = end.point;
  const { x, y } = delta(from, to);
  if (Math.abs(x) < 1 || Math.abs(y) < 1) {
    return [from, to];
  }

  const alongX = horizontal(start.normal) ?? horizontal(end.normal) ?? Math.abs(x) >= Math.abs(y);
  return orthogonal(from, to, alongX, alongX ? (from.x + to.x) / 2 : (from.y + to.y) / 2);
}

function boundsFor(target: ConnectorTarget, padding: number): readonly Bounds[] {
  const { geometry } = target;
  if (!geometry) {
    return [];
  }

  const axis = rotate({ x: 1, y: 0 }, geometry.rotation);
  const x = center(geometry);
  const halfWidth = (Math.abs(axis.x) * geometry.width + Math.abs(axis.y) * geometry.height) / 2;
  const halfHeight = (Math.abs(axis.y) * geometry.width + Math.abs(axis.x) * geometry.height) / 2;
  return [
    {
      left: x.x - halfWidth - padding,
      top: x.y - halfHeight - padding,
      right: x.x + halfWidth + padding,
      bottom: x.y + halfHeight + padding,
    },
  ];
}

function inside(point: Point, bounds: Bounds) {
  return (
    point.x > bounds.left + epsilon &&
    point.x < bounds.right - epsilon &&
    point.y > bounds.top + epsilon &&
    point.y < bounds.bottom - epsilon
  );
}

function range(a: number, b: number, minimum: number, maximum: number) {
  const change = b - a;
  if (Math.abs(change) < epsilon) {
    return a > minimum + epsilon && a < maximum - epsilon ? [0, 1] : undefined;
  }

  const first = (minimum + epsilon - a) / change;
  const last = (maximum - epsilon - a) / change;
  return [Math.min(first, last), Math.max(first, last)];
}

function crosses(from: Point, to: Point, bounds: Bounds) {
  const x = range(from.x, to.x, bounds.left, bounds.right);
  const y = range(from.y, to.y, bounds.top, bounds.bottom);
  return x && y && Math.max(0, x[0]!, y[0]!) + epsilon < Math.min(1, x[1]!, y[1]!);
}

function clear(points: readonly Point[], obstacles: readonly Bounds[]) {
  return points.every((point, index) => {
    const before = points[index - 1];
    return !before || obstacles.every((bounds) => !crosses(before, point, bounds));
  });
}

function unique(points: readonly Point[]) {
  return points.filter((point, index) => {
    const before = points[index - 1];
    return !before || magnitude(delta(before, point)) > epsilon;
  });
}

function pointsOut(terminal: Terminal, other: Point | undefined) {
  if (!terminal.normal) {
    return true;
  }
  if (!other) {
    return false;
  }

  const vector = delta(terminal.point, other);
  return dot(vector, terminal.normal) > (1 - epsilon) * magnitude(vector);
}

function traceExit(point: Point, normal: Point, bounds: Bounds) {
  const x = normal.x
    ? ((normal.x > 0 ? bounds.right : bounds.left) - point.x) / normal.x
    : Infinity;
  const y = normal.y
    ? ((normal.y > 0 ? bounds.bottom : bounds.top) - point.y) / normal.y
    : Infinity;
  return Math.max(0, Math.min(x, y));
}

function lead({ point, normal }: Terminal, obstacles: readonly Bounds[]) {
  if (!normal) {
    return point;
  }

  let distance = clearance;
  // The two padded endpoint boxes can overlap along the lead. Each pass can exit one box.
  for (let pass = 0; pass < obstacles.length; pass += 1) {
    const insideBox = obstacles.find((bounds) => inside(offset(point, normal, distance), bounds));
    if (!insideBox) {
      break;
    }
    distance = traceExit(point, normal, insideBox) + objectPadding;
  }

  return offset(point, normal, distance);
}

function bridgeChoices(from: Point, to: Point, obstacles: readonly Bounds[]) {
  const outer = {
    left: Math.min(from.x, to.x, ...obstacles.map(({ left }) => left)) - objectPadding,
    right: Math.max(from.x, to.x, ...obstacles.map(({ right }) => right)) + objectPadding,
    top: Math.min(from.y, to.y, ...obstacles.map(({ top }) => top)) - objectPadding,
    bottom: Math.max(from.y, to.y, ...obstacles.map(({ bottom }) => bottom)) + objectPadding,
  };
  const xs = [(from.x + to.x) / 2, outer.left, outer.right];
  const ys = [(from.y + to.y) / 2, outer.top, outer.bottom];
  const choices: Point[][] = [
    [from, { x: to.x, y: from.y }, to],
    [from, { x: from.x, y: to.y }, to],
    ...xs.map((x) => orthogonal(from, to, true, x)),
    ...ys.map((y) => orthogonal(from, to, false, y)),
  ];
  for (const x of xs) {
    for (const y of ys) {
      choices.push(
        [from, { x: from.x, y }, { x, y }, { x, y: to.y }, to],
        [from, { x, y: from.y }, { x, y }, { x: to.x, y }, to],
      );
    }
  }

  const spanX = [outer.left, outer.right];
  const spanY = [outer.top, outer.bottom];
  for (const x of spanX) {
    for (const y of spanY) {
      const farX = x === outer.left ? outer.right : outer.left;
      const farY = y === outer.top ? outer.bottom : outer.top;
      choices.push(
        [from, { x, y: from.y }, { x, y }, { x: farX, y }, { x: farX, y: to.y }, to],
        [from, { x: from.x, y }, { x, y }, { x, y: farY }, { x: to.x, y: farY }, to],
      );
    }
  }

  return choices;
}

function continues(normal: Point | undefined, start: Point, next: Point | undefined) {
  return !normal || (next !== undefined && dot(normal, delta(start, next)) >= -epsilon);
}

function bridge(
  from: Point,
  to: Point,
  start: Terminal,
  end: Terminal,
  obstacles: readonly Bounds[],
) {
  let best: readonly Point[] | undefined;
  let alternative: readonly Point[] | undefined;
  let bestScore = Infinity;
  let fallbackScore = Infinity;
  for (const candidate of bridgeChoices(from, to, obstacles)) {
    const route = unique(candidate);
    if (route.length < 2 || !clear(route, obstacles)) {
      continue;
    }

    const length = route
      .slice(1)
      .reduce((sum, point, index) => sum + magnitude(delta(route[index]!, point)), 0);
    const score = length + (route.length - 2) * objectPadding;
    if (score < fallbackScore) {
      fallbackScore = score;
      alternative = route;
    }
    if (
      score < bestScore &&
      continues(start.normal, from, route[1]) &&
      continues(end.normal, to, route.at(-2))
    ) {
      bestScore = score;
      best = route;
    }
  }

  return best ?? alternative ?? [from, { x: to.x, y: from.y }, to];
}

function automatic(start: Terminal, end: Terminal, from: ConnectorTarget, to: ConnectorTarget) {
  const original = unique(originalRoute(start, end));
  if (
    pointsOut(start, original[1]) &&
    pointsOut(end, original.at(-2)) &&
    clear(original, [...boundsFor(from, 0), ...boundsFor(to, 0)])
  ) {
    return original;
  }

  const obstacles = [...boundsFor(from, objectPadding), ...boundsFor(to, objectPadding)];
  const first = lead(start, obstacles);
  const last = lead(end, obstacles);
  return unique([start.point, ...bridge(first, last, start, end, obstacles), end.point]);
}

function step(point: Point, coordinate: number, alongX: boolean): Point {
  return alongX ? { x: coordinate, y: point.y } : { x: point.x, y: coordinate };
}

function relativeRoute(
  { firstAxis, offsets }: RelativeBends,
  from: ConnectorTarget,
  to: ConnectorTarget,
) {
  if (!offsets.length || offsets.length > maximumRelativeBends || !offsets.every(Number.isFinite)) {
    return undefined;
  }

  const fromCenter = facingCenter(from);
  const toCenter = facingCenter(to);
  const firstX = firstAxis === "horizontal";
  const lastX = firstX === (offsets.length % 2 === 0);
  const split = Math.ceil(offsets.length / 2);
  const coordinates = offsets.map((amount, index) => {
    const origin = index < split ? fromCenter : toCenter;
    return amount + (firstX === (index % 2 === 0) ? origin.x : origin.y);
  });
  const start = terminal(from, step(fromCenter, coordinates[0]!, firstX));
  const end = terminal(to, step(toCenter, coordinates.at(-1)!, !lastX));
  const points = [start.point];
  let cursor = start.point;
  coordinates.forEach((coordinate, index) => {
    cursor = step(cursor, coordinate, firstX === (index % 2 === 0));
    points.push(cursor);
  });

  points.push(step(cursor, lastX ? end.point.x : end.point.y, lastX), end.point);
  const clears = (tip: Terminal, neighbor?: Point) =>
    !tip.normal || (neighbor !== undefined && dot(tip.normal, delta(tip.point, neighbor)) > 0);
  return clears(start, points[1]) && clears(end, points.at(-2)) && points.every(finite)
    ? unique(points)
    : undefined;
}

export function resolveConnectorRoute(
  from: ConnectorTarget,
  to: ConnectorTarget,
  bends?: readonly Point[],
  relative?: RelativeBends,
): readonly Point[] {
  const adjusted = relative && relativeRoute(relative, from, to);
  if (adjusted) {
    return adjusted;
  }

  const start = terminal(from, facingCenter(to));
  const end = terminal(to, facingCenter(from));
  if (!finite(start.point) || !finite(end.point)) {
    return [];
  }

  return bends?.length && bends.every(finite)
    ? unique([start.point, ...bends, end.point])
    : automatic(start, end, from, to);
}

function interpolate(before: Point, after: Point, amount: number): Point {
  return offset(before, delta(before, after), amount);
}

function corner(before: Point, turn: Point, after: Point): ConnectorSegment {
  const near = magnitude(delta(turn, before));
  const far = magnitude(delta(turn, after));
  const radius = Math.min(cornerRadius, near / 2, far / 2);
  return {
    start: interpolate(turn, before, near ? radius / near : 0),
    turn,
    end: interpolate(turn, after, far ? radius / far : 0),
  };
}

function terminalRun(points: readonly Point[], step: number, index: number, direction: Point) {
  const tip = points[index]!;
  for (index += step; index > 0 && index < points.length - 1; index += step) {
    const turn = points[index]!;
    const next = points[index + step]!;
    const onward = delta(turn, next);
    if (dot(direction, onward) < (1 - epsilon) * magnitude(onward)) {
      const { start } = corner(points[index - step]!, turn, next);

      return { length: magnitude(delta(tip, start)), hasTurn: true };
    }
  }

  return { length: magnitude(delta(tip, points[index]!)), hasTurn: false };
}

export function connectorArrowPoints(
  points: readonly Point[],
  atStart: boolean,
  strokeWidth: number,
): readonly [left: Point, tip: Point, right: Point] | undefined {
  if (points.length < 2 || strokeWidth <= 0) {
    return undefined;
  }

  const step = atStart ? 1 : -1;
  const index = atStart ? 0 : points.length - 1;
  const tip = points[index]!;
  const vector = delta(tip, points[index + step]!);
  const distance = magnitude(vector);
  if (distance <= epsilon) {
    return undefined;
  }

  const direction = { x: vector.x / distance, y: vector.y / distance };
  const { length, hasTurn } = terminalRun(points, step, index, direction);
  const clearance = hasTurn ? Math.min(strokeWidth / 2, length / 4) : 0;
  const back = Math.min(2 * connectorArrowHalfWidthRatio * strokeWidth, length - clearance);
  const center = offset(tip, direction, back);
  const side = { x: -direction.y, y: direction.x };

  return [offset(center, side, back / 2), tip, offset(center, side, -back / 2)];
}

export function roundedConnectorSegments(points: readonly Point[]): readonly ConnectorSegment[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return [];
  }

  const segments: ConnectorSegment[] = [];
  let cursor = first;
  for (let index = 1; index < points.length - 1; index += 1) {
    const arc = corner(points[index - 1]!, points[index]!, points[index + 1]!);
    segments.push({ start: cursor, end: arc.start }, arc);
    cursor = arc.end;
  }
  segments.push({ start: cursor, end: last });
  return segments;
}

export function connectionPathData(points: readonly Point[]) {
  const first = points[0];
  if (!first) {
    return "";
  }

  const parts = roundedConnectorSegments(points).map(({ turn, end }) =>
    turn ? `Q ${turn.x} ${turn.y} ${end.x} ${end.y}` : `L ${end.x} ${end.y}`,
  );
  return `M ${first.x} ${first.y} ${parts.join(" ")}`;
}
