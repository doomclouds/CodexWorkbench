export interface CatalogChangeEvents {
  readonly cursor: string;
  readonly closed: boolean;
  subscribe(listener: () => void): () => void;
  publish(this: void): void;
  close(): void;
}

export function createCatalogChangeEvents(epoch: string): CatalogChangeEvents {
  const waiting = new Set<() => void>();
  let revision = 0n;
  let closed = false;

  function notify() {
    for (const listener of waiting) {
      waiting.delete(listener);
      listener();
    }
  }

  return {
    get cursor() {
      return epoch + ':' + revision;
    },
    get closed() {
      return closed;
    },
    subscribe(listener) {
      waiting.add(listener);

      return () => {
        waiting.delete(listener);
      };
    },
    publish() {
      revision++;
      notify();
    },
    close() {
      closed = true;
      notify();
    },
  };
}
