import type { ViewContext } from '../contracts/studio';

export interface HostViewContext {
  artifactId: string | null;
  viewId: string | null;
  selectedIds: string[];
  selectedCount: number;
  viewport?: { x: number; y: number; zoom: number };
}

function summarize(context: ViewContext | null): HostViewContext {
  if (!context) return { artifactId: null, viewId: null, selectedIds: [], selectedCount: 0 };
  const selectedIds = [...new Set(context.selectedIds)];
  const snapshot: HostViewContext = {
    artifactId: context.artifactId,
    viewId: context.viewId,
    selectedIds: selectedIds.slice(0, 200),
    selectedCount: selectedIds.length,
  };
  const viewport = context.viewport;
  if (viewport && [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) && viewport.zoom > 0) {
    snapshot.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }
  return snapshot;
}

/** Replaces this App's background context; explicit feedback drafts use a separate path. */
export function createHostContextUpdater(send: (context: HostViewContext) => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: HostViewContext | undefined;
  let lastSnapshot: string | undefined;
  let sending = false;
  let stopped = false;

  const close = () => {
    stopped = true;
    pending = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    if (stopped || sending || timer !== undefined || !pending) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, 150);
  };
  const flush = async () => {
    if (stopped || !pending) return;
    const next = pending;
    pending = undefined;
    sending = true;
    try { await send(next); }
    catch {
      // Older hosts may reject ui/update-model-context. Feedback attachment remains available.
      close();
    } finally {
      sending = false;
      schedule();
    }
  };

  return {
    update(context: ViewContext | null) {
      if (stopped) return;
      const next = summarize(context);
      const serialized = JSON.stringify(next);
      if (serialized === lastSnapshot) return;
      lastSnapshot = serialized;
      pending = next;
      schedule();
    },
    close,
  };
}
