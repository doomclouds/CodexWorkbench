export type LayerDismissReason = 'escape' | 'outside-press';

export interface DismissableLayer {
  root: HTMLDivElement;
  anchor: Element | null;
  priority: number;
  openingOrder: number;
  persistent: boolean;
  dismiss: (reason: LayerDismissReason) => void;
}

interface DismissScope {
  layers: Set<DismissableLayer>;
  dispose(): void;
}

const scopes = new WeakMap<Document, DismissScope>();
let openingOrder = 0;

export function nextLayerOrder() {
  openingOrder += 1;
  return openingOrder;
}

function eventElement(document: Document, target: EventTarget | null): Element | null {
  const ElementType = document.defaultView?.Element;
  if (ElementType && target instanceof ElementType) {
    return target;
  }

  return document.activeElement;
}

function modalOf(target: Element | null) {
  return target?.closest('dialog[open]') ?? null;
}

function available(root: HTMLElement) {
  return (
    root.isConnected &&
    root.style.visibility !== 'hidden' &&
    !root.closest('[hidden], [inert], dialog:not([open])')
  );
}

function takesPriority(layer: DismissableLayer, previous: DismissableLayer | undefined) {
  if (!previous) {
    return true;
  }
  if (layer.priority !== previous.priority) {
    return layer.priority > previous.priority;
  }

  return layer.openingOrder > previous.openingOrder;
}

function topLayer(layers: Set<DismissableLayer>, target: Element | null) {
  const modal = modalOf(target);
  let top: DismissableLayer | undefined;
  for (const layer of layers) {
    const sameScope = modalOf(layer.root) === modal;
    const higher = takesPriority(layer, top);
    if (sameScope && higher && available(layer.root)) {
      top = layer;
    }
  }

  return top;
}

function createScope(document: Document): DismissScope {
  const layers = new Set<DismissableLayer>();

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) {
      return;
    }

    const layer = topLayer(layers, eventElement(document, event.target));
    if (!layer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    layer.dismiss('escape');
  }

  function handlePointerDown(event: PointerEvent) {
    const target = eventElement(document, event.target);
    const layer = topLayer(layers, target);
    if (!layer || layer.persistent || event.defaultPrevented) {
      return;
    }

    if (!layer.root.contains(target) && !layer.anchor?.contains(target)) {
      layer.dismiss('outside-press');
    }
  }

  function dispose() {
    document.removeEventListener('keydown', handleEscape, true);
    document.removeEventListener('pointerdown', handlePointerDown, true);
  }

  document.addEventListener('keydown', handleEscape, true);
  document.addEventListener('pointerdown', handlePointerDown, true);

  return { layers, dispose };
}

export function registerDismissableLayer(layer: DismissableLayer) {
  const document = layer.root.ownerDocument;
  const scope = scopes.get(document) ?? createScope(document);
  scopes.set(document, scope);
  scope.layers.add(layer);

  return () => {
    scope.layers.delete(layer);
    if (scope.layers.size === 0) {
      scope.dispose();
      scopes.delete(document);
    }
  };
}
