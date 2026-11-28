import type { OpenAIModelContextHostState } from '@openai/mcp-extensions/app';
import { reportMcpWarning } from './diagnostics.js';
import { isIdentifier, record } from './protocol.js';

interface McpViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface McpViewContext {
  readonly boardId: string;
  readonly selectedIds: readonly string[];
  readonly viewport: McpViewport;
  readonly focusedObjectId?: string;
  readonly returnViewport?: McpViewport;
}

export interface McpRestoredView extends Omit<McpViewContext, 'viewport'> {
  readonly viewId: string;
  readonly viewport?: McpViewport;
}

type McpViewSummary = Readonly<{
  appId: string;
  panelOpen: true;
  boardId: string | null;
  viewId: string;
  selectedIds: readonly string[];
  selectedCount: number;
  viewport?: McpViewport;
  focusedObjectId?: string;
  returnViewport?: McpViewport;
}>;

const appId = 'luming-studio-ii';
const maximumSelectedIds = 40;
const maximumTextLength = 6 * 1024;
const maximumCoordinate = 1_000_000_000;
const contextInterval = 150;
const refreshInterval = 20_000;

function contextValue(host: OpenAIModelContextHostState | undefined) {
  if (host?.structuredContent) {
    return host.structuredContent;
  }

  const block = host?.content?.find(({ type }) => type === 'text');
  if (block?.type !== 'text' || block.text.length > maximumTextLength) {
    return;
  }

  try {
    return record(JSON.parse(block.text));
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    reportMcpWarning('宿主上次保存的白板视图无法读取。', error);
  }
}

export function readMcpBoardView(
  host: OpenAIModelContextHostState | undefined,
): McpRestoredView | undefined {
  const context = contextValue(host);
  if (context?.appId !== appId || context.panelOpen !== true) {
    return;
  }

  const { boardId, viewId, focusedObjectId, selectedIds } = context;
  if (!isIdentifier(boardId) || !isIdentifier(viewId)) {
    return;
  }

  const selected = Array.isArray(selectedIds)
    ? [...new Set(selectedIds.slice(0, maximumSelectedIds).filter(isIdentifier))]
    : [];
  const focus = isIdentifier(focusedObjectId) ? focusedObjectId : undefined;

  return {
    boardId,
    viewId,
    selectedIds: selected,
    viewport: readViewport(context.viewport),
    focusedObjectId: focus,
    returnViewport: focus ? readViewport(context.returnViewport) : undefined,
  };
}

export function createViewPublisher(
  viewId: string,
  send: (summary: McpViewSummary) => Promise<unknown>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let stopped = false;
  let latestKey: string | undefined;
  let pending: McpViewSummary | undefined;

  function close() {
    stopped = true;
    pending = undefined;
    clearTimeout(timer);
    clearTimeout(heartbeat);
    timer = undefined;
    heartbeat = undefined;
  }

  function keepAlive(current: McpViewSummary) {
    if (stopped || pending || !current.boardId) {
      return;
    }

    heartbeat = setTimeout(() => {
      heartbeat = undefined;
      pending = current;
      schedule();
    }, refreshInterval);
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
      keepAlive(current);
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
    const focus =
      boardId && isIdentifier(context?.focusedObjectId) ? context.focusedObjectId : undefined;
    const next: McpViewSummary = {
      appId,
      panelOpen: true,
      boardId,
      viewId,
      selectedIds: ids.slice(0, maximumSelectedIds),
      selectedCount: ids.length,
      viewport,
      focusedObjectId: focus,
      returnViewport: focus ? readViewport(context?.returnViewport) : undefined,
    };
    const key = JSON.stringify(next);
    if (key !== latestKey) {
      clearTimeout(heartbeat);
      heartbeat = undefined;
      latestKey = key;
      pending = next;
      schedule();
    }
  }

  return { update, close };
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Math.abs(value) <= maximumCoordinate;
}

function readViewport(value: unknown): McpViewport | undefined {
  const candidate = record(value);
  if (!candidate) {
    return;
  }

  const { x, y, zoom } = candidate;
  const validZoom = typeof zoom === 'number' && zoom >= 0.05 && zoom <= 8;
  if (isCoordinate(x) && isCoordinate(y) && validZoom) {
    return { x, y, zoom };
  }
}
