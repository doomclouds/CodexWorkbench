export const MAX_CANVAS_PIXELS = 8_000_000;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_RENDER_TASKS = 2;

export function canvasBudget(width: number, height: number, deviceRatio: number, maxPixels = MAX_CANVAS_PIXELS) {
  if (![width, height, deviceRatio, maxPixels].every(Number.isFinite) || width <= 0 || height <= 0 || maxPixels < 1) throw new Error('PDF 页面尺寸无效。');
  const ratio = Math.min(Math.max(.001, deviceRatio), 2, Math.sqrt(maxPixels / (width * height)), 16384 / width, 16384 / height);
  return { ratio, width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
export function releasePageResources(canvas?: Pick<HTMLCanvasElement, 'width' | 'height'> | null, text?: Pick<Element, 'replaceChildren'> | null, page?: { cleanup(): boolean } | null) {
  if (canvas) { canvas.width = 0; canvas.height = 0; }
  text?.replaceChildren();
  try { page?.cleanup(); } catch { /* A destroyed document has no resources left to retain. */ }
}
export function abortError(signal?: AbortSignal) { return signal?.reason ?? new DOMException('已取消', 'AbortError'); }
/** Stop awaiting RPCs even if a terminated worker never replies. Late rejections remain observed. */
export function abortable<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError(signal)); };
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
export async function yieldToHost(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 0);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(abortError(signal)); };
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
  signal?.throwIfAborted();
}
export function timeBudget(signal?: AbortSignal, milliseconds = 8) {
  let deadline = performance.now() + milliseconds;
  return async () => { signal?.throwIfAborted(); if (performance.now() >= deadline) { await yieldToHost(signal); deadline = performance.now() + milliseconds; } };
}

interface Job { signal: AbortSignal; start(): void; cancel(): void }
export class RenderScheduler {
  private active = 0; private queue: Job[] = [];
  constructor(readonly concurrency = MAX_RENDER_TASKS) {}
  get running() { return this.active; }
  get pending() { return this.queue.length; }
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise<T>((resolve, reject) => {
      let started = false;
      const job: Job = { signal, cancel: () => { signal.removeEventListener('abort', job.cancel); if (started) return; this.queue = this.queue.filter(value => value !== job); reject(abortError(signal)); }, start: () => {
        started = true; signal.removeEventListener('abort', job.cancel); this.active++;
        void Promise.resolve().then(() => { signal.throwIfAborted(); return task(); }).then(resolve, reject).finally(() => { this.active--; setTimeout(() => this.pump(), 0); });
      } };
      signal.addEventListener('abort', job.cancel, { once: true }); this.queue.push(job); this.pump();
    });
  }
  private pump() { while (this.active < this.concurrency && this.queue.length) { const job = this.queue.shift()!; if (job.signal.aborted) job.cancel(); else job.start(); } }
}
export const pdfRenderScheduler = new RenderScheduler();
