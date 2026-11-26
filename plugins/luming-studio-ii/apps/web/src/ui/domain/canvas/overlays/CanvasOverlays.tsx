import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { connectionPortOffset, connectionPorts, portPoint } from '../connectors/geometry.js';
import { connectionHandleBends } from '../connectors/handles.js';
import type {
  CanvasConnectionEndpoint,
  CanvasGeometry,
  CanvasPoint,
  CanvasRect,
  CanvasViewport,
} from '../contracts.js';
import type { AlignmentGuide, ResizeHandle } from '../gestures/index.js';
import { projectedObjectBounds, type ProjectedCanvasObject } from '../scene/index.js';
import { boardToScreen, mergeRects, normalizeViewport } from '../viewport/index.js';
import type { CanvasViewportSize } from '../viewport/index.js';
import './CanvasOverlays.css';

const handleLabels = {
  nw: '缩放左上角',
  n: '缩放上边',
  ne: '缩放右上角',
  e: '缩放右边',
  se: '缩放右下角',
  s: '缩放下边',
  sw: '缩放左下角',
  w: '缩放左边',
  rotate: '旋转',
} as const;

type TransformHandle = ResizeHandle | 'rotate';

const cornerHandles = ['nw', 'ne', 'sw', 'se'] as const;
const edgeHandles = ['n', 'e', 's', 'w'] as const;
const textEdgeHandles = ['e', 'w'] as const;
const resizeCursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;
const resizeDirections = { nw: 1, n: 2, ne: 3, e: 0, se: 1, s: 2, sw: 3, w: 0 };

const portLabels = {
  top: '从上端口连线',
  right: '从右端口连线',
  bottom: '从下端口连线',
  left: '从左端口连线',
};

interface CanvasOverlaysProps {
  readonly viewport: CanvasViewport;
  readonly selected: readonly ProjectedCanvasObject[];
  readonly viewportSize?: CanvasViewportSize;
  readonly selectionActions?: ReactNode;
  readonly marquee?: CanvasRect;
  readonly guides?: readonly AlignmentGuide[];
  readonly ports?: readonly CanvasPoint[];
  readonly activePort?: CanvasPoint;
  readonly transformBox?: CanvasGeometry;
  readonly allowResize?: boolean;
  readonly allowRotate?: boolean;
  readonly cornerResizeOnly?: boolean;
  readonly lockedSelection?: boolean;
  readonly selectedConnector?: ProjectedCanvasObject;
  readonly portSource?: ProjectedCanvasObject;
  readonly onHandlePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    handle: TransformHandle,
  ) => void;
  readonly onPortPointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    endpoint: CanvasConnectionEndpoint,
  ) => void;
  readonly onConnectorPointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    id: string,
    handle: 'start' | 'end' | number,
  ) => void;
}

function screenRect(rect: CanvasRect, viewport: CanvasViewport) {
  const { x, y } = boardToScreen(rect, viewport);

  return {
    left: x,
    top: y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
}

function screenPosition(point: CanvasPoint, viewport: CanvasViewport) {
  const { x, y } = boardToScreen(point, viewport);

  return { left: x, top: y };
}

function screenBox(geometry: CanvasGeometry, viewport: CanvasViewport) {
  return { ...screenRect(geometry, viewport), transform: 'rotate(' + geometry.rotation + 'deg)' };
}

const toolbarMargin = 12;
const toolbarGap = 8;
const regionTitleClearance = 16;

function selectionActionBounds(
  objects: readonly ProjectedCanvasObject[],
  viewport: CanvasViewport,
) {
  const bounds = mergeRects(objects.map(projectedObjectBounds));
  if (!bounds) {
    return undefined;
  }

  const frame = screenRect(bounds, viewport);
  const hasExternalTitle = objects.some(({ object }) => object.kind === 'html');
  if (!hasExternalTitle) {
    return frame;
  }

  return {
    ...frame,
    top: frame.top - regionTitleClearance,
    height: frame.height + regionTitleClearance,
  };
}

function selectionToolbarPosition(
  anchor: ReturnType<typeof screenRect>,
  toolbar: CanvasViewportSize,
  viewport: CanvasViewportSize,
) {
  const right = viewport.width - toolbarMargin - toolbar.width;
  const bottom = viewport.height - toolbarMargin - toolbar.height;
  const measured = toolbar.width > 0 && toolbar.height > 0;
  const fits = right >= toolbarMargin && bottom >= toolbarMargin;
  if (!measured || !fits) {
    return undefined;
  }

  const visibleX = anchor.left + anchor.width >= 0 && anchor.left <= viewport.width;
  const visibleY = anchor.top + anchor.height >= 0 && anchor.top <= viewport.height;
  if (!visibleX || !visibleY) {
    return undefined;
  }

  const above = anchor.top - toolbarGap - toolbar.height;
  const below = anchor.top + anchor.height + toolbarGap;
  const preferred = above >= toolbarMargin || below > bottom ? above : below;
  const center = anchor.left + (anchor.width - toolbar.width) / 2;

  return {
    left: Math.max(toolbarMargin, Math.min(center, right)),
    top: Math.max(toolbarMargin, Math.min(preferred, bottom)),
  };
}

interface SelectionToolbarProps {
  readonly anchor: ReturnType<typeof screenRect>;
  readonly viewportSize: CanvasViewportSize;
  readonly children: ReactNode;
}

function SelectionToolbar({ anchor, viewportSize, children }: SelectionToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasViewportSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = toolbar.current;
    if (!node) {
      return;
    }

    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setSize((current) =>
        width === current.width && height === current.height ? current : { width, height },
      );
    };

    measure();
    const Observer = node.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(measure) : undefined;
    observer?.observe(node);

    return () => observer?.disconnect();
  }, []);

  const position = selectionToolbarPosition(anchor, size, viewportSize);

  return (
    <div
      ref={toolbar}
      className="studio-ui-canvas-selection-actions"
      data-canvas-controls=""
      data-canvas-selection-actions=""
      role="toolbar"
      aria-label="选区格式"
      style={position ?? { visibility: 'hidden' }}
    >
      {children}
    </div>
  );
}

function guideRect({ axis, at, from, to }: AlignmentGuide, viewport: CanvasViewport) {
  const start = axis === 'x' ? { x: at, y: from } : { x: from, y: at };
  const length = (to - from) * viewport.zoom;

  return {
    ...screenPosition(start, viewport),
    width: axis === 'x' ? 1 : length,
    height: axis === 'x' ? length : 1,
  };
}

function handlePress(event: PointerEvent<HTMLButtonElement>, press: () => void) {
  if (event.button === 0) {
    event.stopPropagation();
    press();
  }
}

function resizeCursor(handle: ResizeHandle, rotation: number) {
  const direction = (resizeDirections[handle] + Math.round(rotation / 45)) % 4;

  return resizeCursors[(direction + 4) % 4];
}

function selectedResizeEdges(
  selected: readonly ProjectedCanvasObject[],
  cornersOnly: boolean | undefined,
): readonly ResizeHandle[] {
  const singleKind = selected.length === 1 ? selected[0]?.object.kind : undefined;
  if (singleKind === 'text') {
    return textEdgeHandles;
  }

  return cornersOnly ||
    singleKind === 'sticker' ||
    selected.some(({ object }) => object.kind === 'image')
    ? []
    : edgeHandles;
}

function visiblePortSource(source: ProjectedCanvasObject | undefined, zoom: number) {
  if (!source || zoom < 0.25) {
    return undefined;
  }

  const { width, height } = source.geometry;

  return Math.max(width, height) * zoom >= 40 ? source : undefined;
}

function connectorHandles(points: readonly CanvasPoint[]) {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) {
    return [];
  }

  const bends = connectionHandleBends(points);

  return [
    { id: 'start', label: '连线起点', point: start, handle: 'start' as const },
    ...bends.map((point, index) => ({
      id: 'bend-' + index,
      label: '连线折点 ' + (index + 1),
      point,
      handle: index,
    })),
    { id: 'end', label: '连线终点', point: end, handle: 'end' as const },
  ];
}

interface SelectionOutlineProps extends Pick<
  CanvasOverlaysProps,
  | 'selected'
  | 'viewport'
  | 'allowResize'
  | 'allowRotate'
  | 'cornerResizeOnly'
  | 'lockedSelection'
  | 'onHandlePointerDown'
> {
  readonly transformBox: CanvasGeometry;
}

function SelectionOutline({
  selected,
  viewport,
  allowResize,
  allowRotate,
  cornerResizeOnly,
  lockedSelection,
  onHandlePointerDown,
  transformBox,
}: SelectionOutlineProps) {
  const resizeHandles = [...cornerHandles, ...selectedResizeEdges(selected, cornerResizeOnly)];
  const singleKind = selected.length === 1 ? selected[0]?.object.kind : undefined;
  const outsideResize = singleKind === 'document' || singleKind === 'todo' || singleKind === 'html';
  const showStaticCorners =
    !allowResize &&
    (lockedSelection ||
      selected.some(({ object }) => !['link', 'connector'].includes(object.kind)));

  return (
    <div
      className="studio-ui-canvas-selection-outline"
      data-canvas-outside-resize={outsideResize || undefined}
      style={screenBox(transformBox, viewport)}
    >
      {allowRotate &&
        cornerHandles.map((corner) => (
          <button
            key={`rotate-${corner}`}
            className="studio-ui-canvas-rotate-hit"
            data-canvas-handle="rotate"
            data-canvas-rotate-corner={corner}
            type="button"
            tabIndex={-1}
            aria-label={`旋转所选对象 ${corner}`}
            onPointerDown={(event) =>
              handlePress(event, () => onHandlePointerDown(event, 'rotate'))
            }
          />
        ))}
      {allowResize &&
        resizeHandles.map((handle) => (
          <button
            key={handle}
            className="studio-ui-canvas-transform-handle"
            data-canvas-handle={handle}
            type="button"
            tabIndex={-1}
            aria-label={handleLabels[handle]}
            style={{ cursor: resizeCursor(handle, transformBox.rotation) }}
            onPointerDown={(event) => handlePress(event, () => onHandlePointerDown(event, handle))}
          />
        ))}
      {showStaticCorners &&
        cornerHandles.map((handle) => (
          <span
            key={handle}
            className="studio-ui-canvas-transform-handle studio-ui-canvas-transform-handle--static"
            data-canvas-static-corner={handle}
            data-canvas-locked-corner={lockedSelection ? handle : undefined}
            aria-hidden="true"
          />
        ))}
    </div>
  );
}

export function CanvasOverlays(props: CanvasOverlaysProps) {
  const {
    viewport,
    viewportSize,
    selectionActions,
    selected,
    marquee,
    guides,
    ports,
    activePort,
    transformBox,
    allowResize,
    allowRotate,
    cornerResizeOnly,
    selectedConnector,
    portSource: source,
    lockedSelection,
    onHandlePointerDown,
    onPortPointerDown,
    onConnectorPointerDown,
  } = props;
  const view = normalizeViewport(viewport);
  const portSource = visiblePortSource(source, view.zoom);
  const connection = selectedConnector?.connectorRoute;
  const actionsBounds = selectionActions && selectionActionBounds(selected, view);

  return (
    <div className="studio-ui-canvas-overlays">
      {transformBox && (
        <SelectionOutline
          transformBox={transformBox}
          viewport={view}
          selected={selected}
          allowResize={allowResize}
          allowRotate={allowRotate}
          cornerResizeOnly={cornerResizeOnly}
          lockedSelection={lockedSelection}
          onHandlePointerDown={onHandlePointerDown}
        />
      )}
      {portSource &&
        connectionPorts.map((port) => (
          <button
            key={port}
            className="studio-ui-canvas-port studio-ui-canvas-port--interactive"
            data-canvas-port={port}
            type="button"
            tabIndex={-1}
            aria-label={portLabels[port]}
            style={screenPosition(
              portPoint(portSource.geometry, port, connectionPortOffset(view.zoom)),
              view,
            )}
            onPointerDown={(event) =>
              handlePress(event, () => {
                const attachment = { objectId: portSource.object.id, port };
                const point = portPoint(portSource.geometry, port);
                onPortPointerDown(event, { point, attachment });
              })
            }
          />
        ))}
      {selectedConnector &&
        connection &&
        connectorHandles(connection.points).map(({ id, label, point, handle }) => (
          <button
            key={id}
            className="studio-ui-canvas-port studio-ui-canvas-port--interactive"
            data-canvas-connector-handle={id}
            type="button"
            tabIndex={-1}
            aria-label={label}
            style={screenPosition(point, view)}
            onPointerDown={(event) =>
              handlePress(event, () =>
                onConnectorPointerDown(event, selectedConnector.object.id, handle),
              )
            }
          />
        ))}
      {marquee && (
        <div
          className="studio-ui-canvas-marquee"
          style={screenRect(marquee, view)}
          aria-hidden="true"
        />
      )}
      {guides?.map((guide) => (
        <div
          key={guide.axis}
          className="studio-ui-canvas-alignment-guide"
          data-canvas-guide={guide.axis}
          style={guideRect(guide, view)}
          aria-hidden="true"
        />
      ))}
      {ports?.map((point, index) => (
        <div
          key={index}
          className="studio-ui-canvas-port"
          style={screenPosition(point, view)}
          aria-hidden="true"
        />
      ))}
      {activePort && (
        <div
          className="studio-ui-canvas-port studio-ui-canvas-port--active"
          style={screenPosition(activePort, view)}
          aria-hidden="true"
        />
      )}
      {actionsBounds && viewportSize && (
        <SelectionToolbar anchor={actionsBounds} viewportSize={viewportSize}>
          {selectionActions}
        </SelectionToolbar>
      )}
    </div>
  );
}
