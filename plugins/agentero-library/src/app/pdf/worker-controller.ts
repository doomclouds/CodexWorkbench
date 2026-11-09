export class PdfWorkerUnavailableError extends Error {
  readonly code = 'PDF_WORKER_UNAVAILABLE';
  constructor(message = '当前宿主无法安全启动 PDF 后台线程，请使用系统查看器打开。') { super(message); this.name = 'PdfWorkerUnavailableError'; }
}
export class PdfResourceLimitError extends Error {
  readonly code = 'PDF_RESOURCE_LIMIT';
  constructor() { super('该 PDF 含有超过 1600 万像素的图片，已停止内嵌查看。请使用系统查看器打开。'); this.name = 'PdfResourceLimitError'; }
}
export type PdfWorkerFailure = PdfWorkerUnavailableError | PdfResourceLimitError;
const IMAGE_LIMIT_MESSAGE = 'Image exceeded maximum allowed size and was removed.';

/** PDF.js 6.5.438 can resolve an empty operator list before rejecting this stream error. */
export function imageBudgetFailure(data: unknown, version?: string): PdfResourceLimitError | null {
  if (version !== '6.5.438' || !data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>; const reason = value.reason as Record<string, unknown> | null;
  if (value.stream !== 5 || !Number.isInteger(value.streamId) || Number(value.streamId) < 1 || typeof value.sourceName !== 'string' || !/^d\d+_worker$/.test(value.sourceName) || value.targetName !== value.sourceName.slice(0, -7)) return null;
  return reason && reason.name === 'UnknownErrorException' && reason.message === IMAGE_LIMIT_MESSAGE ? new PdfResourceLimitError() : null;
}

interface WorkerPort extends EventTarget { terminate(): void }
interface LaunchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  createWorker?: (url: string) => WorkerPort;
  createUrl?: (source: Blob) => string;
  revokeUrl?: (url: string) => void;
  onFailure?: (error: PdfWorkerFailure) => void;
  pdfjsVersion?: string;
}

/** A real Worker must announce PDF.js' ready handshake. No same-thread fallback. */
export async function launchPdfWorker(source: string, options: LaunchOptions = {}): Promise<{ port: Worker; dispose(): void }> {
  options.signal?.throwIfAborted();
  const revoke = options.revokeUrl ?? (url => URL.revokeObjectURL(url));
  const url = (options.createUrl ?? (blob => URL.createObjectURL(blob)))(new Blob([source], { type: 'text/javascript' }));
  let worker: WorkerPort;
  try { worker = (options.createWorker ?? (value => new Worker(value, { type: 'module', name: 'agentero-pdf-parser' })))(url); }
  catch { revoke(url); throw new PdfWorkerUnavailableError(); }
  let disposed = false; let ready = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStartup: ((error: unknown) => void) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    worker.removeEventListener('message', message); worker.removeEventListener('error', error);
    worker.terminate(); revoke(url);
  };
  const abort = () => { rejectStartup?.(options.signal?.reason ?? new DOMException('已取消', 'AbortError')); dispose(); };
  const error = (event: Event) => {
    event.preventDefault(); const failure = new PdfWorkerUnavailableError();
    rejectStartup?.(failure); try { if (ready) options.onFailure?.(failure); } finally { dispose(); }
  };
  let resolveStartup: (() => void) | undefined;
  const message = (event: Event) => {
    const data: unknown = (event as MessageEvent).data;
    const limited = ready ? imageBudgetFailure(data, options.pdfjsVersion) : null;
    if (limited) {
      // Only this pinned, verified budget rejection is intercepted. Cancellation and
      // all other PDF.js messages continue through the normal library protocol.
      event.stopImmediatePropagation();
      try { options.onFailure?.(limited); } finally { dispose(); }
      return;
    }
    if (!data || typeof data !== 'object' || !('action' in data) || data.action !== 'ready' || !('sourceName' in data) || data.sourceName !== 'worker') return;
    ready = true; clearTimeout(timer); resolveStartup?.();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      resolveStartup = resolve; rejectStartup = reject;
      worker.addEventListener('message', message); worker.addEventListener('error', error);
      options.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { reject(new PdfWorkerUnavailableError('PDF 后台线程启动超时，已停止内嵌解析。请使用系统查看器打开。')); dispose(); }, options.timeoutMs ?? 4000);
      if (options.signal?.aborted) abort();
    });
    rejectStartup = undefined;
    return { port: worker as Worker, dispose };
  } catch (cause) { dispose(); throw cause; }
}
