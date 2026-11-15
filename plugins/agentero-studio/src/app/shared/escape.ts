interface EscapeLayer { root: HTMLElement; dismiss(target: EventTarget | null): boolean | void; priority: number }
interface EscapeScope { layers: EscapeLayer[]; boundaries: number; dispose(): void }
const scopes = new WeakMap<Window, EscapeScope>();

export function consumeEscape(event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault(); event.stopPropagation();
}

export function isEscapeActive(root: HTMLElement) {
  if (!root.isConnected || root.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const view = root.ownerDocument.defaultView;
  for (let node: HTMLElement | null = root; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

/** Local editors run first; only the newest active layer handles an unclaimed Escape. */
export function dismissEscapeLayer(view: Window, target: EventTarget | null = null): boolean {
  const layers = scopes.get(view)?.layers ?? [];
  for (const layer of [...layers].reverse().sort((a, b) => a.root.contains(b.root) ? 1 : b.root.contains(a.root) ? -1 : b.priority - a.priority)) {
    if (isEscapeActive(layer.root) && layer.dismiss(target) !== false) return true;
  }
  return false;
}

function scopeFor(view: Window): EscapeScope {
  const current = scopes.get(view); if (current) return current;
  const scope: EscapeScope = { layers: [], boundaries: 0, dispose };
  const capture = (event: KeyboardEvent) => {
    // Repeats must not dismiss the next layer after the first press restored focus.
    if (event.key === 'Escape' && event.repeat) { consumeEscape(event); event.stopImmediatePropagation(); }
  };
  const down = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (!event.defaultPrevented && !event.isComposing) dismissEscapeLayer(view, event.target);
    consumeEscape(event); event.stopImmediatePropagation();
  };
  const up = (event: KeyboardEvent) => { if (event.key === 'Escape') { consumeEscape(event); event.stopImmediatePropagation(); } };
  view.addEventListener('keydown', capture, true);
  view.addEventListener('keydown', down);
  view.addEventListener('keyup', up, true);
  function dispose() {
    if (scope.boundaries || scope.layers.length) return;
    view.removeEventListener('keydown', capture, true); view.removeEventListener('keydown', down); view.removeEventListener('keyup', up, true);
    scopes.delete(view);
  }
  scopes.set(view, scope); return scope;
}

export function installEscapeBoundary(view: Window) {
  const scope = scopeFor(view); scope.boundaries++;
  return () => { scope.boundaries--; scope.dispose(); };
}

export function registerEscapeLayer(root: HTMLElement, dismiss: EscapeLayer['dismiss'], priority = 10) {
  const view = root.ownerDocument.defaultView!;
  const scope = scopeFor(view), layer = { root, dismiss, priority };
  scope.layers.push(layer);
  return () => { scope.layers.splice(scope.layers.indexOf(layer), 1); scope.dispose(); };
}
