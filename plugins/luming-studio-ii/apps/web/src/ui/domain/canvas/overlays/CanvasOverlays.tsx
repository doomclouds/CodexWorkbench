import type { PointerEvent } from 'react';
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
import type { ProjectedCanvasObject } from '../scene/index.js';
import { boardToScreen, normalizeViewport } from '../viewport/index.js';
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

const cornerHandles: readonly TransformHandle[] = ['nw', 'ne', 'sw', 'se'];
const edgeHandles: readonly TransformHandle[] = ['n', 'e', 's', 'w'];

const portLabels = {
  top: '从上端口连线',
  right: '从右端口连线',
  bottom: '从下端口连线',
  left: '从左端口连线',
};

interface CanvasOverlaysProps {
  readonly viewport: CanvasViewport;
  readonly selected: readonly ProjectedCanvasObject[];
  readonly marquee?: CanvasRect;
  readonly guides?: readonly AlignmentGuide[];
  readonly ports?: readonly CanvasPoint[];
  readonly activePort?: CanvasPoint;
  readonly transformBox?: CanvasGeometry;
  readonly allowResize?: boolean;
  readonly allowRotate?: boolean;
  readonly cornerResizeOnly?: boolean;
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

export function CanvasOverlays(props: CanvasOverlaysProps) {
  const {
    viewport,
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
    portSource,
    onHandlePointerDown,
    onPortPointerDown,
    onConnectorPointerDown,
  } = props;
  const view = normalizeViewport(viewport);
  const resizeHandles = cornerResizeOnly ? cornerHandles : [...cornerHandles, ...edgeHandles];
  const handles: readonly TransformHandle[] = [
    ...(allowResize ? resizeHandles : []),
    ...(allowRotate ? (['rotate'] as const) : []),
  ];
  const connection = selectedConnector?.connectorRoute;

  return (
    <div className="studio-ui-canvas-overlays">
      {selected.map(({ object, geometry }) => (
        <div
          key={object.id}
          className="studio-ui-canvas-selection-outline"
          style={screenBox(geometry, view)}
          aria-hidden="true"
        />
      ))}
      {transformBox && (
        <div className="studio-ui-canvas-selection-outline" style={screenBox(transformBox, view)}>
          {handles.map((handle) => (
            <button
              key={handle}
              className="studio-ui-canvas-transform-handle"
              data-canvas-handle={handle}
              type="button"
              tabIndex={-1}
              aria-label={handleLabels[handle]}
              onPointerDown={(event) =>
                handlePress(event, () => onHandlePointerDown(event, handle))
              }
            />
          ))}
        </div>
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
    </div>
  );
}
