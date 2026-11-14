const CHUNK_BYTES = 128 * 1024;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT = 4;
const MAX_ASSETS = 64;
const REQUEST_HEADERS = new Set(['content-type', 'x-filename', 'x-content-type']);

type Send = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
interface WireResponse { status: number; headers: Record<string, string>; body?: string; downloadId?: string; size: number }
interface CachedAsset { url: string; size: number }

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
  const transfers = new Set<string>();
  const queue: Array<() => void> = [];
  let closed = false, active = 0, assetBytes = 0;

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
  async function acquire(signal: AbortSignal) {
    checkSignal(signal);
    if (active >= MAX_CONCURRENT) {
      if (queue.length >= 64) throw failure('作品请求过多，请稍后重试。', 'BUSY');
      await new Promise<void>((resolve, reject) => {
        const enter = () => { signal.removeEventListener('abort', abort); active++; resolve(); };
        const abort = () => { const index = queue.indexOf(enter); if (index !== -1) queue.splice(index, 1); reject(abortReason(signal)); };
        queue.push(enter);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else active++;
    let released = false;
    return () => { if (!released) { released = true; active--; queue.shift()?.(); } };
  }
  async function release(transferId: string) {
    if (!transfers.delete(transferId) || closed) return;
    // Cleanup must survive the request's own timeout or cancellation.
    const signal = AbortSignal.timeout(3000);
    try { await waitFor(send({ action: 'release', transferId }, signal), signal); } catch { /* Server teardown also disposes its bounded temporary transfers. */ }
  }
  async function wire(args: Record<string, unknown>, signal: AbortSignal) {
    checkSignal(signal);
    if (closed) throw failure('作品连接已关闭。', 'CLOSED');
    const pending = Promise.resolve().then(() => { checkSignal(signal); return send(args, signal); }).then(value => {
      const id = args.action === 'upload' ? value?.transferId : args.action === 'request' ? value?.downloadId : undefined;
      if (typeof id === 'string') {
        transfers.add(id);
        // A peer can acknowledge a transfer after its caller has already cancelled.
        if (signal.aborted || closed) void release(id);
      }
      return value;
    });
    return waitFor(pending, signal);
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
  async function perform(path: string, init: RequestInit, signal: AbortSignal) {
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
          const part = await wire({ action: 'upload', ...(uploadId ? { transferId: uploadId } : {}), offset, size: bytes.byteLength, data: encode(data) }, signal);
          if (typeof part?.transferId === 'string') owned.add(part.transferId);
          if (typeof part?.transferId !== 'string' || !part.transferId || (uploadId && part.transferId !== uploadId) || part.nextOffset !== offset + data.byteLength) throw failure('作品上传分块未被完整确认。');
          uploadId = part.transferId;
        }
      }
      const result = await wire({ action: 'request', path, method, ...(Object.keys(headers).length ? { headers } : {}), ...(uploadId ? { uploadId } : bytes ? { body: encode(bytes) } : {}) }, signal) as WireResponse;
      if (typeof result?.downloadId === 'string') owned.add(result.downloadId);
      checkSize(result?.size);
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || !result.headers || typeof result.headers !== 'object') throw failure('作品服务返回了无效的响应。');
      let content: Uint8Array<ArrayBuffer>;
      if (result.downloadId) {
        if (result.body !== undefined) throw failure('作品服务重复返回了响应内容。');
        content = new Uint8Array(result.size);
        let offset = 0;
        do {
          const part = await wire({ action: 'download', transferId: result.downloadId, offset }, signal);
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
    } finally { await Promise.all([...owned].map(release)); }
  }
  async function cacheAsset(key: string, signal: AbortSignal) {
    const cached = assets.get(key);
    if (cached) { assets.delete(key); assets.set(key, cached); return; }
    const existing = preparing.get(key);
    if (existing) return waitFor(existing, signal);
    const pending = (async () => {
      const response = await requestInternal(key, { signal }, false);
      if (!response.ok) return;
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
    const list = [...keys]; let index = 0;
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, list.length) }, async () => {
      while (index < list.length) {
        checkSignal(signal);
        const key = list[index++]!;
        try { await cacheAsset(key, signal); } catch { checkSignal(signal); /* A missing preview must not hide the document. */ }
      }
    }));
  }
  async function requestInternal(input: string | URL, init: RequestInit = {}, prepare = true): Promise<Response> {
    if (closed) throw failure('作品连接已关闭。', 'CLOSED');
    const path = canonical(input);
    const signal = init.signal ? AbortSignal.any([lifetime.signal, init.signal]) : lifetime.signal;
    const unlock = await acquire(signal);
    let response: Response;
    try { response = await perform(path, init, signal); } finally { unlock(); }
    // Release the request slot before fetching previews to avoid nested-request deadlocks.
    if (prepare) await prepareAssets(response, signal);
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
    close() {
      if (closed) return;
      closed = true; lifetime.abort(failure('作品连接已关闭。', 'CLOSED'));
      for (const asset of assets.values()) URL.revokeObjectURL(asset.url);
      assets.clear(); preparing.clear(); transfers.clear(); assetBytes = 0;
    },
  };
}
