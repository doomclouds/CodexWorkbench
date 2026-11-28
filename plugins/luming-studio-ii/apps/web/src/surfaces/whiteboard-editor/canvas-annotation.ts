const interactiveControl =
  'button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), iframe, [role="button"], [role="dialog"], [role="menu"], [role="toolbar"]';

export function isCanvasAnnotationTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-canvas-root]')) &&
    !target.closest(interactiveControl)
  );
}
