import type { Anchor, Board, BoardElement, Operation } from '../../../../../contracts/studio.js';
import type { GestureReceipt, NativeGesture } from '../../../../shared/useNativeGestureSync.js';
import {
  elementBounds,
  intersects,
  makeElement,
  moveOperations,
  normalizedRect,
  relativeElementPoint,
  type Point,
} from '../scene/canvas-model.js';
import {
  finalizeDrawing,
  geometryCommit,
  projectGestureGeometry,
  type Gesture,
} from './canvas-gesture-placement.js';
import { drawingLimitNotice } from './canvas-pointer-frame.js';
import {
  adjacentElement,
  connectionAtPoint,
  connectionPoint,
  OPPOSITE_SIDE,
} from './selection-affordances.js';

export interface NativeAnnotation {
  anchor: Anchor;
  label: string;
  versions: Record<string, number>;
  screenPoint?: Point;
}

interface CanvasGestureEnd {
  point: Point;
  screen: Point;
  zoom: number;
  shiftKey: boolean;
  elements: BoardElement[];
  selectedIds: readonly string[];
  pen: { color: string; width: number };
}

interface GesturePresence {
  previous?: NativeGesture;
  preview: (value: NativeGesture) => void;
  publish: (value: NativeGesture) => void;
  confirm: (value: GestureReceipt) => void;
  fail: (value: Pick<GestureReceipt, 'id' | 'operationId'>) => void;
}

interface GestureWriter {
  add: (
    elements: BoardElement[],
    summary: string,
    options: { edit?: boolean; operationId?: string },
  ) => Promise<Board | null>;
  apply: (
    operations: Operation[],
    summary: string,
    sources: BoardElement[],
    operationId?: string,
  ) => Promise<Board | null>;
  reportFailure: (failure: unknown) => void;
}

interface GestureActions {
  presence: GesturePresence;
  write: GestureWriter;
  select: (ids: string[]) => void;
  annotate: (target: Anchor, annotation: NativeAnnotation) => void;
  documentPlaced: () => void;
  notify: (message: string) => void;
}

function confirmedVersions(board: Board, elements: readonly BoardElement[]) {
  return Object.fromEntries(
    elements.flatMap((element) => {
      const actual = board.elements.find((value) => value.id === element.id);

      return actual ? [[actual.id, actual.version]] : [];
    }),
  );
}

function endGestureWrite(gesture: Gesture, presence: GesturePresence, write: GestureWriter) {
  let final = presence.previous;
  const operationId = gesture.operationId;

  function preview(
    elements: BoardElement[],
    origin: NativeGesture['origin'],
    kind: NativeGesture['kind'],
  ) {
    if (!operationId) {
      return;
    }

    final = {
      id: operationId,
      operationId,
      baseRevision: gesture.baseRevision,
      origin,
      kind,
      elements,
      ...(origin === 'create' ? { storedIds: elements.map((element) => element.id) } : {}),
    };
    presence.preview(final);
  }

  function settle(saved: Board | null | undefined) {
    if (!operationId) {
      return;
    }

    if (!saved) {
      presence.fail({ id: operationId, operationId });
      return;
    }

    presence.confirm({
      id: operationId,
      operationId,
      revision: saved.artifact.revision,
      versions: confirmedVersions(saved, final?.elements ?? []),
    });
  }

  function cancel() {
    if (final) {
      presence.publish({ ...final, cancelled: true });
    }
  }

  function reportFailedWrite(failure: unknown) {
    settle(null);
    write.reportFailure(failure);
  }

  function add(elements: BoardElement[], summary: string, edit?: boolean) {
    return write.add(elements, summary, { ...(edit !== undefined ? { edit } : {}), operationId });
  }

  function apply(operations: Operation[], summary: string, sources: BoardElement[]) {
    write.apply(operations, summary, sources, operationId).then(settle).catch(reportFailedWrite);
  }

  function addAndSettle(elements: BoardElement[], summary: string, edit?: boolean) {
    add(elements, summary, edit).then(settle).catch(reportFailedWrite);
  }

  return { preview, settle, cancel, add, apply, addAndSettle, reportFailure: write.reportFailure };
}

type EndWrite = ReturnType<typeof endGestureWrite>;

export function annotationElementLabel(element: BoardElement) {
  let kind = '对象';
  if (element.type === 'note') {
    kind = '便签';
  } else if (element.type === 'container') {
    kind = '分区';
  }

  return `${kind} · ${(element.text || element.label || element.type).slice(0, 100)}`;
}

function endAnnotation(
  gesture: Extract<Gesture, { kind: 'annotate' }>,
  scene: CanvasGestureEnd,
  annotate: GestureActions['annotate'],
) {
  const area = normalizedRect(gesture.start, gesture.end);
  const dragged = Math.hypot(area.w, area.h) * scene.zoom > 5;
  const element = dragged ? undefined : gesture.element;
  let targets = element ? [element] : [];
  if (dragged) {
    targets = scene.elements.filter((item) =>
      intersects(area, elementBounds(item, scene.elements)),
    );
  }
  const relative = element
    ? relativeElementPoint(elementBounds(element, scene.elements) as BoardElement, gesture.start)
    : undefined;
  const local: Anchor = element
    ? { elementIds: [element.id], coordinateSpace: 'element', ...relative }
    : {
        coordinateSpace: 'board',
        x: gesture.start.x,
        y: gesture.start.y,
        ...(dragged ? area : {}),
      };

  const count = targets.length ? ` · ${targets.length} 个对象` : '';
  let label = dragged ? `画布范围${count}` : '画布位置';
  if (element) {
    label = annotationElementLabel(element);
  }

  annotate(local, {
    anchor: {
      ...local,
      elementIds: targets.map((item) => item.id),
      pin: { coordinateSpace: 'board', ...scene.point },
    },
    label,
    versions: Object.fromEntries(targets.map((item) => [item.id, item.version])),
    screenPoint: scene.screen,
  });
}

function endMarquee(
  gesture: Extract<Gesture, { kind: 'marquee' }>,
  { elements, selectedIds }: CanvasGestureEnd,
  select: GestureActions['select'],
) {
  const box = normalizedRect(gesture.start, gesture.end);
  const ids = elements
    .filter((element) => element.type !== 'arrow' && intersects(box, element))
    .map((element) => element.id);
  select(gesture.additive ? [...new Set([...selectedIds, ...ids])] : ids);
}

function endMove(gesture: Extract<Gesture, { kind: 'move' }>, completion: EndWrite) {
  if (!gesture.dragging) {
    completion.cancel();
    return;
  }

  const delta = {
    x: gesture.current.x - gesture.start.x,
    y: gesture.current.y - gesture.start.y,
  };
  const operations = moveOperations(gesture.elements, gesture.ids, delta);
  const next = projectGestureGeometry(gesture.elements, operations);
  completion.preview(next, gesture.copies ? 'create' : 'existing', 'move');
  if (gesture.copies) {
    completion.addAndSettle(next, '拖动复制');
  } else {
    completion.apply(operations, '移动元素', gesture.elements);
  }
}

function adjacentObjects(gesture: Extract<Gesture, { kind: 'connect' }>, scene: CanvasGestureEnd) {
  const { element: source, side } = gesture;
  const next = adjacentElement(
    source,
    side,
    makeElement(source.type, source, {
      w: source.w,
      h: source.h,
      kind: source.kind,
      fill: source.fill,
      color: source.color,
      stroke: source.stroke,
      strokeWidth: source.strokeWidth,
      fontSize: source.fontSize,
      text: '',
    }),
    scene.elements,
  );

  if (source.type !== 'shape') {
    return [next];
  }

  const arrow = makeElement('arrow', connectionPoint(source, side), {
    from: source.id,
    fromSide: side,
    to: next.id,
    toSide: OPPOSITE_SIDE[side],
    color: scene.pen.color,
    stroke: scene.pen.color,
    strokeWidth: scene.pen.width,
  });

  return [next, arrow];
}

function connectingArrow(
  gesture: Extract<Gesture, { kind: 'connect' }>,
  { elements, point, zoom, pen }: CanvasGestureEnd,
) {
  const { element: source, side } = gesture;
  const target = connectionAtPoint(elements, point, zoom, [source.id]);
  const start = connectionPoint(source, side);

  return makeElement('arrow', start, {
    ...normalizedRect(start, point),
    from: source.id,
    fromSide: side,
    to: target?.element.id ?? [point.x, point.y],
    ...(target?.side ? { toSide: target.side } : {}),
    color: pen.color,
    stroke: pen.color,
    strokeWidth: pen.width,
  });
}

function endConnection(
  gesture: Extract<Gesture, { kind: 'connect' }>,
  scene: CanvasGestureEnd,
  completion: EndWrite,
  select: GestureActions['select'],
) {
  const { element: source, start } = gesture;
  const { point, zoom } = scene;
  const dragged = Math.hypot(point.x - start.x, point.y - start.y) * zoom >= 5;
  if (!dragged && (source.type === 'note' || source.type === 'shape')) {
    const elements = adjacentObjects(gesture, scene);
    completion.preview(elements, 'create', 'arrow');
    async function addAndSelectNeighbor() {
      const saved = await completion.add(elements, '添加相邻元素', source.type === 'note');
      completion.settle(saved);
      if (saved) {
        select([elements[0]!.id]);
      }
    }

    addAndSelectNeighbor().catch(completion.reportFailure);

    return;
  }
  if (dragged && source.type !== 'note') {
    const arrow = connectingArrow(gesture, scene);
    completion.preview([arrow], 'create', 'arrow');
    completion.addAndSettle([arrow], '添加连接线');
    return;
  }

  completion.cancel();
}

function endGeometry(
  gesture: Extract<Gesture, { kind: 'resize' | 'rotate' | 'arrow-point' }>,
  scene: CanvasGestureEnd,
  completion: EndWrite,
) {
  const commit = geometryCommit(gesture, scene.point, scene.elements);
  if (!commit) {
    completion.cancel();
    return;
  }

  completion.preview(commit.preview, 'existing', commit.kind);
  completion.apply(commit.operations, commit.summary, commit.elements);
}

function endDrawing(
  gesture: Extract<Gesture, { kind: 'draw' }>,
  scene: CanvasGestureEnd,
  completion: EndWrite,
  notify: GestureActions['notify'],
) {
  const { element: drawn, reachedLimit } = finalizeDrawing(
    gesture,
    scene.point,
    scene.shiftKey,
    scene.elements,
  );

  if (reachedLimit) {
    notify(drawingLimitNotice);
  }

  const ink = gesture.element.type === 'stroke';
  completion.preview([drawn], 'create', ink ? 'ink' : 'arrow');
  completion.addAndSettle([drawn], ink ? '添加笔迹' : '添加连接线');
}

function endCreation(
  gesture: Extract<Gesture, { kind: 'create' }>,
  completion: EndWrite,
  documentPlaced: GestureActions['documentPlaced'],
) {
  const { element } = gesture;
  const document = element.type === 'document';
  completion.preview([element], 'create', 'shape');
  if (document) {
    documentPlaced();
  }

  completion.addAndSettle(
    [element],
    document ? '添加文档区域' : '添加元素',
    ['text', 'note'].includes(element.type),
  );
}

export function completeCanvasGesture(
  gesture: Gesture,
  scene: CanvasGestureEnd,
  actions: GestureActions,
): void {
  if (gesture.kind === 'pan') {
    return;
  }

  const completion = endGestureWrite(gesture, actions.presence, actions.write);
  switch (gesture.kind) {
    case 'annotate':
      return endAnnotation(gesture, scene, actions.annotate);
    case 'marquee':
      return endMarquee(gesture, scene, actions.select);
    case 'move':
      return endMove(gesture, completion);
    case 'connect':
      return endConnection(gesture, scene, completion, actions.select);
    case 'resize':
    case 'rotate':
    case 'arrow-point':
      return endGeometry(gesture, scene, completion);
    case 'draw':
      return endDrawing(gesture, scene, completion, actions.notify);
    case 'create':
      return endCreation(gesture, completion, actions.documentPlaced);
  }
}
