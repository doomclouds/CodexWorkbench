import { useEffect, useState, type RefObject } from 'react';
import type { LibrarySettings, LibraryStatus } from '../contracts/types';

export const ACTIVITY_THRESHOLDS = [0, 0.001, 0.01];
export function mergeHostPatch<T extends object>(state: T, patch: Partial<T>): T {
  return (Object.keys(patch) as (keyof T)[]).every(key => state[key] === patch[key]) ? state : { ...state, ...patch };
}
export function intersectionActivity(previous: boolean, intersecting: boolean, ratio: number) {
  if (!intersecting || ratio <= 0.001) return false;
  return ratio >= 0.01 ? true : previous;
}

interface ActivityEnvironment {
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  createObserver(callback: IntersectionObserverCallback, options: IntersectionObserverInit): Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect'>;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
}

/** Observe the real App root, including clipping by an offscreen ancestor iframe. */
export function observeAppActivity(element: HTMLElement, onChange: (active: boolean) => void, environment: ActivityEnvironment = {
  document, createObserver: (callback, options) => new IntersectionObserver(callback, options), requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id),
}) {
    const document = environment.document;
    let alive = true; let intersecting = false; let frame: number | undefined; let published = false;
    let documentVisible = document.visibilityState !== 'hidden';
    const publish = () => {
      frame = undefined;
      const next = document.visibilityState !== 'hidden' && intersecting;
      if (alive && next !== published) { published = next; onChange(next); }
    };
    const schedule = () => { if (frame === undefined) frame = environment.requestFrame(publish); };
    const deactivate = () => {
      if (frame !== undefined) { environment.cancelFrame(frame); frame = undefined; }
      if (alive && published) { published = false; onChange(false); }
    };
    const observer = environment.createObserver(entries => {
      for (const entry of entries) if (entry.target === element) intersecting = intersectionActivity(intersecting, entry.isIntersecting, entry.intersectionRatio);
      if (!intersecting || document.visibilityState === 'hidden') deactivate(); else schedule();
    }, { threshold: ACTIVITY_THRESHOLDS });
    observer.observe(element);
    const visibility = () => {
      const next = document.visibilityState !== 'hidden';
      if (next === documentVisible) return;
      documentVisible = next;
      if (!next) { deactivate(); return; }
      // Wait for a fresh intersection after the document returns to the foreground.
      intersecting = false; deactivate(); observer.unobserve(element); observer.observe(element);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { alive = false; observer.disconnect(); document.removeEventListener('visibilitychange', visibility); if (frame !== undefined) environment.cancelFrame(frame); };
}

export function useAppActivity(root: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (root.current) return observeAppActivity(root.current, setActive);
  }, [root]);
  return active;
}

export interface RefreshRequest { explicit: boolean; forceStatus: boolean }
export const sameLibrarySettings = (left: LibrarySettings | null, right: LibrarySettings) => left !== null && (['schemaVersion', 'cliPath', 'vaultPath', 'pdfiumPath', 'allowAgentPdfText', 'vaultId'] as const).every(key => left[key] === right[key]);
export async function readSettingsStatus(previous: { settings: LibrarySettings; status: LibraryStatus } | null, forceStatus: boolean, readSettings: () => Promise<LibrarySettings>, readStatus: () => Promise<LibraryStatus>, current: () => boolean) {
  const settings = await readSettings();
  if (!current()) return null;
  const changed = !sameLibrarySettings(previous?.settings ?? null, settings);
  const status = forceStatus || changed || !previous ? await readStatus() : previous.status;
  return current() ? { settings, status, changed } : null;
}
/** Polls join a running read. Only deliberate refreshes queue one merged follow-up. */
export function createRefreshQueue(run: (request: RefreshRequest) => Promise<void>) {
  let current: Promise<void> | null = null; let pending: RefreshRequest | null = null;
  return {
    request(request: RefreshRequest) {
      if (current && !request.explicit && !request.forceStatus) return current;
      pending = { explicit: request.explicit || pending?.explicit || false, forceStatus: request.forceStatus || pending?.forceStatus || false };
      if (current) return current;
      current = Promise.resolve().then(async () => {
        try { while (pending) { const next = pending; pending = null; await run(next); } }
        finally { current = null; }
      });
      return current;
    },
    clearPending() { pending = null; },
  };
}

/** A slow read never overlaps the next tick, including immediate focus refreshes. */
export function startSequentialPoll(read: () => Promise<void>, delay: number) {
  let stopped = false; let inFlight: Promise<void> | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
  const trigger = () => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    clearTimeout(timer);
    inFlight = Promise.resolve().then(read).finally(() => {
      inFlight = null;
      if (!stopped) timer = setTimeout(() => { void trigger().catch(() => {}); }, delay);
    });
    return inFlight;
  };
  timer = setTimeout(() => { void trigger().catch(() => {}); }, delay);
  return { trigger, stop() { stopped = true; clearTimeout(timer); } };
}
