import type { PointerEvent } from 'react';
import type { BoardElement } from '../../contracts/studio.js';
import { CONNECTION_SIDES, connectionPoint, type ConnectionSide } from './selection-affordances.js';

export default function ConnectionPorts({ element, zoom, onBegin }: { element: BoardElement; zoom: number; onBegin: (event: PointerEvent, element: BoardElement, side: ConnectionSide) => void }) {
  return <>{CONNECTION_SIDES.map(side => {
    const point = connectionPoint(element, side, 12 / zoom);
    const hint = element.type === 'note' ? '点击添加相邻便签' : element.type === 'shape' ? '点击添加相连形状，拖动连接' : '拖动连接';
    return <button type="button" key={side} className="studio-connection-port" aria-label={`连接点 ${side}`} title={hint} data-connection-side={side} style={{ left: point.x, top: point.y, width: 20 / zoom, height: 20 / zoom }} onPointerDown={event => onBegin(event, element, side)}><span style={{ width: 8 / zoom, height: 8 / zoom }} /></button>;
  })}</>;
}
