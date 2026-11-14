// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TimerControl } from '../src/app/shared/editor-panels/TimerControl';
import { LOCAL_ACTOR } from '../src/contracts/studio';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([-60_000, 60_000])('displays the shared server deadline with a local clock skew of %s ms', async skew => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const serverNow = new Date('2026-11-14T12:00:00Z').getTime();
  vi.setSystemTime(serverNow + skew);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const host = document.createElement('div'); host.className = 'studio'; document.body.append(host);
  const root = createRoot(host), onAction = vi.fn();
  try {
    await act(async () => root.render(<TimerControl timer={{ durationMs: 5000, deadline: serverNow + 5000, remainingMs: 5000, paused: false, source: LOCAL_ACTOR }} clockOffsetMs={-skew} canEdit={false} busy={false} onAction={onAction} />));
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('00:05');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('00:04');
    expect(host.querySelector('[aria-label="计时状态"]')?.textContent).toBe('计时中');
    expect(onAction).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
