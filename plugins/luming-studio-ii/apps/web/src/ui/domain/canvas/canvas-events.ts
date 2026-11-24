import type { CanvasPoint } from './contracts.js';
import type { CanvasViewportSize } from './viewport/index.js';

const elementSelector = '[data-canvas-object]';
const sectionTitleSelector = '[data-canvas-section-title]';
const rootSelector = '[data-canvas-root]';
const nativeSelector = '[data-canvas-native]';
const wheelLineSize = 16;

function elementTarget(target: EventTarget | null, container: HTMLDivElement) {
  const ElementType = container.ownerDocument.defaultView?.Element;
  if (ElementType && target instanceof ElementType && container.contains(target)) {
    return target;
  }
}

export function ownsEvent(target: EventTarget | null, container: HTMLDivElement) {
  return elementTarget(target, container)?.closest(rootSelector) === container;
}

export function canvasNativeId(target: EventTarget | null, container: HTMLDivElement) {
  const element = elementTarget(target, container);
  let native = element?.closest(nativeSelector);
  while (native && native.closest(rootSelector) !== container) {
    native = native.parentElement?.closest(nativeSelector);
  }

  return native?.closest(elementSelector)?.getAttribute('data-canvas-object') ?? undefined;
}

export function canvasSectionTitleId(target: EventTarget | null, container: HTMLDivElement) {
  const title = elementTarget(target, container)?.closest(sectionTitleSelector);

  return title?.closest(elementSelector)?.getAttribute('data-canvas-object') ?? undefined;
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

export function wheelDelta(event: WheelEvent, size: CanvasViewportSize): CanvasPoint {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * size.width, y: event.deltaY * size.height };
  }

  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? wheelLineSize : 1;

  return { x: event.deltaX * scale, y: event.deltaY * scale };
}
