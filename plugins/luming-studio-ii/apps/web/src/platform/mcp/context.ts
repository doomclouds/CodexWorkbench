import { reportMcpWarning } from './diagnostics.js';
import { isIdentifier } from './protocol.js';

export interface McpViewContext {
  readonly boardId: string;
  readonly selectedIds: readonly string[];
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
}

type McpViewSummary = Readonly<Record<string, unknown>>;

const maximumSelectedIds = 64;
const contextInterval = 150;

export function createViewPublisher(
  viewId: string,
  send: (summary: McpViewSummary) => Promise<unknown>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let stopped = false;
  let latestKey: string | undefined;
  let pending: McpViewSummary | undefined;

  function close() {
    stopped = true;
    pending = undefined;
    clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    const waiting = sending || timer !== undefined;
    if (stopped || waiting || !pending) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      flush().catch((error: unknown) => {
        reportMcpWarning('宿主未能同步白板视图位置。', error);
      });
    }, contextInterval);
  }

  async function flush() {
    if (stopped || !pending) {
      return;
    }

    const current = pending;
    pending = undefined;
    sending = true;
    try {
      await send(current);
    } catch (error) {
      if (!pending) {
        latestKey = undefined;
      }
      throw error;
    } finally {
      sending = false;
      schedule();
    }
  }

  function update(context: McpViewContext | null) {
    if (stopped) {
      return;
    }

    const boardId = context && isIdentifier(context.boardId) ? context.boardId : null;
    const ids =
      boardId && context ? Array.from(new Set(context.selectedIds.filter(isIdentifier))) : [];
    const viewport = boardId && context ? readViewport(context.viewport) : undefined;
    const next = {
      appId: 'luming-studio-ii',
      panelOpen: true,
      boardId,
      viewId,
      selectedIds: ids.slice(0, maximumSelectedIds),
      selectedCount: ids.length,
      viewport,
    };
    const key = JSON.stringify(next);
    if (key !== latestKey) {
      latestKey = key;
      pending = next;
      schedule();
    }
  }

  return { update, close };
}

function readViewport({ x, y, zoom }: McpViewContext['viewport']) {
  if ([x, y, zoom].every(Number.isFinite) && zoom > 0) {
    return { x, y, zoom };
  }
}
