import type { CanvasPoint } from './contracts.js';
import type { CanvasViewportSize } from './viewport/index.js';

const elementSelector = '[data-canvas-object]';
const labelSelector =
  '[data-canvas-section-title], [data-canvas-connector-label], [data-canvas-external-title]';
const rootSelector = '[data-canvas-root]';
const nativeSelector = '[data-canvas-native]';
const handleSelector = '[data-canvas-handle], [data-canvas-port], [data-canvas-connector-handle]';
const wheelLineSize = 16;
const wheelZoomRate = 0.002;

function elementTarget(target: EventTarget | null, container: HTMLDivElement) {
  const ElementType = container.ownerDocument.defaultView?.Element;
  if (ElementType && target instanceof ElementType && container.contains(target)) {
    return target;
  }
}

export function ownsEvent(target: EventTarget | null, container: HTMLDivElement) {
  const element = elementTarget(target, container);
  const dialog = element?.closest('dialog[open]');

  return element?.closest(rootSelector) === container && (!dialog || !container.contains(dialog));
}

export function canvasNativeId(target: EventTarget | null, container: HTMLDivElement) {
  const element = elementTarget(target, container);
  let native = element?.closest(nativeSelector);
  while (native && native.closest(rootSelector) !== container) {
    native = native.parentElement?.closest(nativeSelector);
  }

  return native?.closest(elementSelector)?.getAttribute('data-canvas-object') ?? undefined;
}

export function canvasLabelId(target: EventTarget | null, container: HTMLDivElement) {
  const title = elementTarget(target, container)?.closest(labelSelector);

  return title?.closest(elementSelector)?.getAttribute('data-canvas-object') ?? undefined;
}

export function canvasDragSurface(target: EventTarget | null, container: HTMLDivElement) {
  const element = elementTarget(target, container);
  if (element?.getAttribute('data-canvas-drag-surface') === 'background') {
    return 'background';
  }
  if (element?.closest('[data-canvas-drag-surface="title"]')) {
    return 'title';
  }

  const body = element?.closest('[data-canvas-drag-surface="body"]');
  const interactive = element?.closest(
    'a, button, input, select, textarea, [contenteditable="true"], [role="button"]',
  );

  if (body && !interactive) {
    return 'body';
  }
}

export function isCanvasHandle(target: EventTarget | null, container: HTMLDivElement) {
  return Boolean(elementTarget(target, container)?.closest(handleSelector));
}

export function relativePoint(
  sample: Pick<PointerEvent, 'clientX' | 'clientY'>,
  origin: CanvasPoint,
) {
  return { x: sample.clientX - origin.x, y: sample.clientY - origin.y };
}

export function containerOrigin(container: HTMLDivElement) {
  const { left, top } = container.getBoundingClientRect();

  return { x: left, y: top };
}

export function wheelDelta(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  size: CanvasViewportSize,
): CanvasPoint {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * size.width, y: event.deltaY * size.height };
  }

  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? wheelLineSize : 1;

  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

export function wheelZoomFactor(delta: number) {
  return Math.exp(-delta * wheelZoomRate);
}
