const CHUNK_BYTES = 128 * 1024;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT = 4;
const MAX_ASSETS = 64;
const REQUEST_HEADERS = new Set(['content-type', 'x-filename', 'x-content-type']);

type Send = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
interface WireResponse { status: number; headers: Record<string, string>; body?: string; downloadId?: string; size: number }
interface CachedAsset { url: string; size: number }
interface AssetState { status: 'loading' | 'ready' | 'error'; message?: string }
interface RequestSlots { active: number; queue: Array<() => void> }

function failure(message: string, code = 'INVALID_RESPONSE') { return Object.assign(new Error(message), { code }); }
function encode(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decode(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw failure('作品服务返回了无效的数据分块。');
  const binary = atob(value);
  if (binary.length > maximum) throw failure('作品服务返回的数据分块过大。', 'TOO_LARGE');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function checkSize(size: unknown): asserts size is number {
  if (!Number.isSafeInteger(size) || (size as number) < 0 || (size as number) > MAX_BYTES) throw failure('作品内容超过 128 MB，或大小无效。', 'TOO_LARGE');
}
function abortReason(signal: AbortSignal) { return signal.reason ?? new DOMException('操作已取消。', 'AbortError'); }
function checkSignal(signal: AbortSignal) { if (signal.aborted) throw abortReason(signal); }
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortReason(signal)); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Browser requests carried exclusively over the MCP App tool channel. */
export function createRpcTransport(baseUrl: string, send: Send) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw failure('作品服务地址无效。', 'INVALID_ARGUMENT');
  const lifetime = new AbortController();
  const assets = new Map<string, CachedAsset>();
  const preparing = new Map<string, Promise<void>>();
  const assetQueue = new Map<string, AbortSignal>();
  const assetErrors = new Map<string, string>();
  const assetListeners = new Set<() => void>();
  const transfers = new Set<string>();
  const requests: RequestSlots = { active: 0, queue: [] }, waits: RequestSlots = { active: 0, queue: [] };
  let closed = false, assetBytes = 0, assetWorkers = 0;
  const assetsChanged = () => { for (const listener of assetListeners) listener(); };

  function canonical(input: string | URL) {
    const url = new URL(input, base);
    if (url.origin !== base.origin || url.username || url.password || !/^\/(?:api|assets)\//.test(url.pathname)) throw failure('不能通过作品服务访问该地址。', 'INVALID_ARGUMENT');
    for (const key of [...url.searchParams.keys()]) if (/^(token|share)$/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.pathname + url.search;
  }
  function assetKey(reference: string): string | undefined {
    // Only complete resource references are candidates; HTML and document text stay untouched.
    if (!reference.startsWith('/') && !/^https?:\/\//i.test(reference)) return undefined;
    try {
      const key = canonical(reference);
      return /^\/(?:assets|api\/(?:assets|thumbnails))\/[^/]/.test(key) ? key : undefined;
    } catch { return undefined; }
  }
  async function acquire(signal: AbortSignal, waiting: boolean) {
    const slots = waiting ? waits : requests, maximum = waiting ? 1 : MAX_CONCURRENT;
    checkSignal(signal);
    if (slots.active >= maximum) {
      if (slots.queue.length >= 64) throw failure('作品请求过多，请稍后重试。', 'BUSY');
      await new Promise<void>((resolve, reject) => {
        const enter = () => { signal.removeEventListener('abort', abort); slots.active++; resolve(); };
        const abort = () => { const index = slots.queue.indexOf(enter); if (index !== -1) slots.queue.splice(index, 1); reject(abortReason(signal)); };
        slots.queue.push(enter);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else slots.active++;
    let released = false;
    return () => { if (!released) { released = true; slots.active--; slots.queue.shift()?.(); } };
  }
  async function release(transferId: string) {
    if (!transfers.delete(transferId) || closed) return;
    // Cleanup must survive the request's own timeout or cancellation.
    const signal = AbortSignal.timeout(3000);
    try { await waitFor(send({ action: 'release', transferId }, signal), signal); } catch { /* Server teardown also disposes its bounded temporary transfers. */ }
  }
  async function wire(args: Record<string, unknown>, signal: AbortSignal, resource = false) {
    checkSignal(signal);
    if (closed) throw failure('作品连接已关闭。', 'CLOSED');
    const unlock = resource ? await acquire(signal, false) : undefined;
    const pending = Promise.resolve().then(() => { checkSignal(signal); return send(args, signal); }).then(value => {
      const id = args.action === 'upload' ? value?.transferId : args.action === 'request' ? value?.downloadId : undefined;
      if (typeof id === 'string') {
        transfers.add(id);
        // A peer can acknowledge a transfer after its caller has already cancelled.
        if (signal.aborted || closed) void release(id);
      }
      return value;
    });
    try { return await waitFor(pending, signal); } finally { unlock?.(); }
  }
  async function bodyBytes(body: BodyInit | null | undefined, signal: AbortSignal) {
    if (body == null) return undefined;
    let bytes: Uint8Array;
    if (typeof body === 'string') bytes = new TextEncoder().encode(body);
    else if (body instanceof Blob) { checkSize(body.size); bytes = new Uint8Array(await waitFor(body.arrayBuffer(), signal)); }
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else if (ArrayBuffer.isView(body)) bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    else throw failure('作品请求包含不支持的内容类型。', 'INVALID_ARGUMENT');
    checkSize(bytes.byteLength);
    checkSignal(signal);
    return bytes;
  }
  async function perform(path: string, init: RequestInit, signal: AbortSignal, resource = false) {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw failure('作品请求方法无效。', 'INVALID_ARGUMENT');
    if (method === 'GET' && init.body != null) throw failure('读取作品时不能附带请求内容。', 'INVALID_ARGUMENT');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => { if (REQUEST_HEADERS.has(key)) headers[key] = value; });
    if (init.body instanceof Blob && !headers['content-type'] && init.body.type) headers['content-type'] = init.body.type;
    const owned = new Set<string>();
    try {
      const bytes = await bodyBytes(init.body, signal);
      let uploadId: string | undefined;
      if (bytes && bytes.byteLength > CHUNK_BYTES) {
        for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
          const data = bytes.subarray(offset, offset + CHUNK_BYTES);
          const part = await wire({ action: 'upload', ...(uploadId ? { transferId: uploadId } : {}), offset, size: bytes.byteLength, data: encode(data) }, signal, resource);
          if (typeof part?.transferId === 'string') owned.add(part.transferId);
          if (typeof part?.transferId !== 'string' || !part.transferId || (uploadId && part.transferId !== uploadId) || part.nextOffset !== offset + data.byteLength) throw failure('作品上传分块未被完整确认。');
          uploadId = part.transferId;
        }
      }
      const result = await wire({ action: 'request', path, method, ...(Object.keys(headers).length ? { headers } : {}), ...(uploadId ? { uploadId } : bytes ? { body: encode(bytes) } : {}) }, signal, resource) as WireResponse;
      if (typeof result?.downloadId === 'string') owned.add(result.downloadId);
      checkSize(result?.size);
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || !result.headers || typeof result.headers !== 'object') throw failure('作品服务返回了无效的响应。');
      let content: Uint8Array<ArrayBuffer>;
      if (result.downloadId) {
        if (result.body !== undefined) throw failure('作品服务重复返回了响应内容。');
        content = new Uint8Array(result.size);
        let offset = 0;
        do {
          const part = await wire({ action: 'download', transferId: result.downloadId, offset }, signal, resource);
          const bytes = decode(part?.data, Math.min(CHUNK_BYTES, result.size - offset));
          if (part.nextOffset !== offset + bytes.length || typeof part.done !== 'boolean' || (!bytes.length && !part.done) || part.done !== (part.nextOffset === result.size)) throw failure('作品下载分块不完整。');
          content.set(bytes, offset); offset = part.nextOffset;
        } while (offset < result.size);
      } else {
        content = decode(result.body ?? '', CHUNK_BYTES);
        if (content.byteLength !== result.size) throw failure('作品响应大小与内容不符。');
      }
      checkSignal(signal);
      return new Response([204, 205, 304].includes(result.status) ? null : content, { status: result.status, headers: result.headers });
    } finally {
      // The complete response is already usable. Cleanup has its own timeout and must not delay it.
      for (const transferId of owned) void release(transferId);
    }
  }
  async function cacheAsset(key: string, signal: AbortSignal) {
    const cached = assets.get(key);
    if (cached) { assets.delete(key); assets.set(key, cached); return; }
    const existing = preparing.get(key);
    if (existing) return waitFor(existing, signal);
    const pending = (async () => {
      const response = await requestInternal(key, { signal }, false);
      if (!response.ok) throw failure(`媒体读取失败（${response.status}）。`, 'ASSET_UNAVAILABLE');
      const blob = await response.blob();
      checkSignal(signal);
      if (blob.size > MAX_BYTES || closed) return;
      while (assets.size >= MAX_ASSETS || assetBytes + blob.size > MAX_BYTES) {
        const oldest = assets.entries().next().value;
        if (!oldest) return;
        URL.revokeObjectURL(oldest[1].url); assetBytes -= oldest[1].size; assets.delete(oldest[0]);
      }
      const url = URL.createObjectURL(blob);
      assets.set(key, { url, size: blob.size }); assetBytes += blob.size;
    })();
    preparing.set(key, pending);
    try { await pending; } finally { preparing.delete(key); }
  }
  function queueAsset(key: string, signal: AbortSignal) {
    if (closed || signal.aborted || assets.has(key) || preparing.has(key) || assetQueue.has(key)) return;
    if (assetQueue.size + preparing.size >= MAX_ASSETS) {
      assetErrors.set(key, '媒体加载队列已满，请刷新后重试。');
      while (assetErrors.size > MAX_ASSETS) assetErrors.delete(assetErrors.keys().next().value!);
      return;
    }
    assetErrors.delete(key); assetQueue.set(key, signal);
    runAssets();
  }
  function runAssets() {
    while (!closed && assetWorkers < MAX_CONCURRENT && assetQueue.size) {
      const [key, signal] = assetQueue.entries().next().value!;
      assetQueue.delete(key);
      if (signal.aborted) continue;
      assetWorkers++;
      void cacheAsset(key, signal).catch(error => {
        if (!closed && !signal.aborted) {
          assetErrors.set(key, error instanceof Error ? error.message : '媒体未能加载。');
          while (assetErrors.size > MAX_ASSETS) assetErrors.delete(assetErrors.keys().next().value!);
        }
      }).finally(() => { assetWorkers--; if (!closed) { assetsChanged(); runAssets(); } });
    }
  }
  async function prepareAssets(response: Response, signal: AbortSignal) {
    if (!response.ok || !/\b(?:application\/json|[\w.+-]+\/[\w.+-]+\+json)\b/i.test(response.headers.get('content-type') ?? '')) return;
    let value: unknown;
    try { value = await response.clone().json(); } catch { return; }
    if (value && typeof value === 'object' && 'ok' in value && value.ok === false) return;
    const keys = new Set<string>(), pending: unknown[] = [value];
    while (pending.length && keys.size < MAX_ASSETS) {
      checkSignal(signal);
      const current = pending.pop();
      if (typeof current === 'string') { const key = assetKey(current); if (key) keys.add(key); }
      else if (current && typeof current === 'object') for (const child of Object.values(current)) pending.push(child);
    }
    for (const key of keys) queueAsset(key, signal);
    if (keys.size) assetsChanged();
  }
  async function requestInternal(input: string | URL, init: RequestInit = {}, prepare = true): Promise<Response> {
    if (closed) throw failure('作品连接已关闭。', 'CLOSED');
    const path = canonical(input);
    const signal = init.signal ? AbortSignal.any([lifetime.signal, init.signal]) : lifetime.signal;
    const endpoint = new URL(path, base);
    const unlock = prepare ? await acquire(signal, endpoint.pathname === '/api/sync' && Number(endpoint.searchParams.get('wait')) > 0) : undefined;
    let response: Response;
    try { response = await perform(path, init, signal, !prepare); } finally { unlock?.(); }
    // Media fills the bounded cache independently; metadata and sync events are usable immediately.
    if (prepare) void prepareAssets(response, signal).catch(error => { if (!closed && !signal.aborted) console.warn('Studio media preparation failed', error); });
    checkSignal(signal);
    return response;
  }
  return {
    request: (input: string | URL, init?: RequestInit) => requestInternal(input, init),
    assetUrl(reference: string) {
      const key = assetKey(reference), cached = key ? assets.get(key) : undefined;
      if (key && cached) { assets.delete(key); assets.set(key, cached); }
      return cached?.url;
    },
    assetState(reference: string): AssetState | undefined {
      const key = assetKey(reference);
      if (!key) return;
      if (assets.has(key)) return { status: 'ready' };
      const message = assetErrors.get(key);
      if (message) return { status: 'error', message };
      if (preparing.has(key) || assetQueue.has(key)) return { status: 'loading' };
    },
    subscribeAssets(listener: () => void) { assetListeners.add(listener); return () => { assetListeners.delete(listener); }; },
    close() {
      if (closed) return;
      closed = true; lifetime.abort(failure('作品连接已关闭。', 'CLOSED'));
      for (const asset of assets.values()) URL.revokeObjectURL(asset.url);
      assets.clear(); preparing.clear(); assetQueue.clear(); assetErrors.clear(); assetListeners.clear(); transfers.clear(); assetBytes = 0;
    },
  };
}
