export interface CanvasObjectStore<Value> {
  read(id: string): Value | undefined;
  subscribe(id: string, listener: () => void): () => void;
  update(next: ReadonlyMap<string, Value> | undefined): void;
}

export function createCanvasObjectStore<Value>(
  initial?: ReadonlyMap<string, Value>,
): CanvasObjectStore<Value> {
  let current = initial;
  const listeners = new Map<string, Set<() => void>>();

  function read(id: string) {
    return current?.get(id);
  }

  function subscribe(id: string, listener: () => void) {
    const subscribers = listeners.get(id) ?? new Set();
    subscribers.add(listener);
    listeners.set(id, subscribers);

    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) {
        listeners.delete(id);
      }
    };
  }

  function update(next: ReadonlyMap<string, Value> | undefined) {
    if (current === next) {
      return;
    }

    const previous = current;
    current = next;
    for (const [id, value] of next ?? []) {
      if (previous?.get(id) !== value) {
        listeners.get(id)?.forEach((notify) => notify());
      }
    }
    for (const id of previous?.keys() ?? []) {
      if (!next?.has(id)) {
        listeners.get(id)?.forEach((notify) => notify());
      }
    }
  }

  return { read, subscribe, update };
}
