import type { ObserveCatalogVisibility } from './contracts.js';

type WaitForChange = (cursor: string, signal: AbortSignal) => Promise<string>;

const retryMs = 500;
const maxRetryMs = 5_000;

function waitToRetry(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resume, delay);
    signal.addEventListener('abort', resume, { once: true });

    function resume() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', resume);
      resolve();
    }
  });
}

async function follow(
  waitForChange: WaitForChange,
  cursor: string,
  onChange: (cursor: string) => void,
  signal: AbortSignal,
) {
  let delay = retryMs;
  while (!signal.aborted) {
    let next: string;
    try {
      next = await waitForChange(cursor, signal);
      signal.throwIfAborted();
      if (!next) {
        throw new Error('目录事件缺少有效游标。');
      }
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      if (!(error instanceof Error)) {
        throw error;
      }

      await waitToRetry(signal, delay);
      delay = Math.min(maxRetryMs, delay * 2);
      continue;
    }

    delay = retryMs;
    cursor = next;
    onChange(next);
  }
}

export function watchCatalogChanges(
  waitForChange: WaitForChange,
  cursor: string,
  onChange: (cursor: string) => void,
  signal: AbortSignal,
  observeVisibility?: ObserveCatalogVisibility,
) {
  if (signal.aborted) {
    return;
  }

  let visible = false;
  let active: AbortController | undefined;
  const unsubscribe = observeVisibility?.(syncVisibility);
  signal.addEventListener('abort', stop, { once: true });
  if (!observeVisibility) {
    syncVisibility(true);
  }

  function stop() {
    visible = false;
    active?.abort();
    unsubscribe?.();
    signal.removeEventListener('abort', stop);
  }

  function syncVisibility(value: boolean) {
    visible = value;
    if (!visible || signal.aborted) {
      active?.abort();
      return;
    }
    if (active) {
      return;
    }

    active = new AbortController();
    follow(waitForChange, cursor, changed, active.signal).then(
      () => {
        active = undefined;
        syncVisibility(visible);
      },
      (error: unknown) => {
        stop();
        console.warn('作品目录更新已中断。', error);
      },
    );
  }

  function changed(next: string) {
    cursor = next;
    onChange(next);
  }
}
