import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { APP_CHUNK_BYTES, APP_MAX_BYTES, type AppTransportInput, type AppTransportResult, type UiHttpRequest, type UiRequester } from '../contracts/transport.js';
import { TOOL_NAMES } from '../contracts/studio.js';

const transferId = z.string().uuid();
const base64 = z.string().max(Math.ceil(APP_CHUNK_BYTES / 3) * 4);
export const appTransportSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), path: z.string().min(1).max(8192), method: z.enum(['GET', 'POST']).optional(), headers: z.record(z.string(), z.string().max(4096)).optional(), body: base64.optional(), uploadId: transferId.optional() }).strict(),
  z.object({ action: z.literal('upload'), transferId: transferId.optional(), offset: z.number().int().min(0).max(APP_MAX_BYTES), size: z.number().int().min(1).max(APP_MAX_BYTES), data: base64 }).strict(),
  z.object({ action: z.literal('download'), transferId, offset: z.number().int().min(0).max(APP_MAX_BYTES) }).strict(),
  z.object({ action: z.literal('release'), transferId }).strict(),
]);
const REQUEST_HEADERS = new Set(['content-type', 'x-filename', 'x-content-type']);
const RESPONSE_HEADERS = new Set(['content-type', 'content-disposition', 'cache-control', 'content-length']);
const TTL_MS = 120_000, MAX_TRANSFERS = 8, MAX_CONCURRENT = 4, MAX_BUDGET = APP_MAX_BYTES * 2;
interface Transfer { kind: 'upload' | 'download'; bytes: Buffer; offset: number; expiresAt: number }
function failure(code: string, message: string) { return Object.assign(new Error(message), { code }); }

/** Resolve only the existing UI endpoints; never accept a caller-controlled authority. */
export function validateUiRequest(request: UiHttpRequest): UiHttpRequest {
  const { path, method } = request;
  if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/') || path.startsWith('//') || /[\\#\u0000-\u0020]/.test(path) || /%(?:2e|2f|5c|25)/i.test(path)) throw failure('INVALID_ARGUMENT', '作品请求路径无效。');
  const url = new URL(path, 'http://studio.invalid');
  if (url.origin !== 'http://studio.invalid' || url.pathname.split('/').some(segment => segment === '.' || segment === '..') || path.split('?')[0] !== url.pathname) throw failure('INVALID_ARGUMENT', '作品请求路径无效。');
  if (method !== 'GET' && method !== 'POST') throw failure('INVALID_ARGUMENT', '作品请求方法无效。');
  const tool = /^\/api\/tools\/([^/]+)$/.exec(url.pathname);
  const allowed = tool ? method === 'POST' && TOOL_NAMES.includes(tool[1] as typeof TOOL_NAMES[number])
    : url.pathname === '/api/presence' ? true
    : url.pathname === '/api/sync' ? method === 'GET'
    : url.pathname === '/api/room' ? method === 'POST'
    : url.pathname === '/api/session' ? method === 'GET'
    : url.pathname === '/api/region-view' ? true
    : ['/api/import', '/api/assets'].includes(url.pathname) ? method === 'POST'
    : /^\/(?:assets\/[^/]+\/[^/]+|api\/(?:assets\/[^/]+(?:\/[^/]+)?|exports\/[^/]+|thumbnails\/[^/]+))$/.test(url.pathname) && method === 'GET';
  if (!allowed) throw failure('FORBIDDEN', '此地址不能通过作品界面访问。');
  const thumbnail = method === 'GET' && /^\/api\/thumbnails\/[^/]+$/.test(url.pathname);
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || (thumbnail ? key !== 'revision' : url.pathname === '/api/region-view' ? !['artifactId', 'viewId'].includes(key) : url.pathname === '/api/sync' ? !['artifactId', 'after', 'wait', 'peerId', 'peerEpoch'].includes(key) : key !== 'artifactId')) throw failure('FORBIDDEN', '作品请求不能指定连接凭据、重复或未知查询参数。');
    if (key === 'revision' && (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))) throw failure('INVALID_ARGUMENT', '作品缩略图版本号无效。');
    if (url.pathname === '/api/sync') {
      if (key === 'wait' && (!/^(?:0|[1-9]\d*)$/.test(value) || Number(value) > 20_000)) throw failure('INVALID_ARGUMENT', '同步等待时间应为 0 到 20000 毫秒。');
      if (key === 'after' && !/^[A-Za-z0-9_-]{1,120}:\d{1,16}$/.test(value)) throw failure('INVALID_ARGUMENT', '同步水位无效。');
      if ((key === 'peerId' || key === 'peerEpoch') && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)) throw failure('INVALID_ARGUMENT', '协作页面标识无效。');
    }
    seen.add(key);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers || {})) {
    const lower = key.toLowerCase();
    if (!REQUEST_HEADERS.has(lower) || typeof value !== 'string' || value.length > 4096 || /[\r\n\u0000]/.test(value)) throw failure('FORBIDDEN', '作品请求包含不允许的请求头。');
    headers[lower] = value;
  }
  if (method === 'GET' && request.body !== undefined) throw failure('INVALID_ARGUMENT', '读取请求不能包含内容。');
  if (request.body && request.body.byteLength > APP_MAX_BYTES) throw failure('TOO_LARGE', '作品请求超过 128 MB。');
  return { path: url.pathname + url.search, method, headers, ...(request.body !== undefined ? { body: request.body } : {}) };
}
function decode(value: string) {
  if (value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw failure('INVALID_ARGUMENT', '作品分块不是有效的 Base64。');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > APP_CHUNK_BYTES || bytes.toString('base64') !== value) throw failure('TOO_LARGE', '作品分块超过 128 KiB 或编码无效。');
  return bytes;
}

/** Per-MCP-connection transfer storage. Bytes are private to the App result metadata. */
export function createAppTransport(requestUi: UiRequester) {
  const transfers = new Map<string, Transfer>();
  let budget = 0, active = 0, closed = false;
  const lifetime = new AbortController();
  function reserve(size: number) { if (budget + size > MAX_BUDGET) throw failure('BUSY', '作品传输缓存已满，请稍后重试。'); budget += size; }
  function remove(id: string) { const value = transfers.get(id); if (value) { transfers.delete(id); budget -= value.bytes.length; } return !!value; }
  function sweep() { const now = Date.now(); for (const [id, value] of transfers) if (value.expiresAt <= now) remove(id); }
  function get(id: string, kind: Transfer['kind']) { const value = transfers.get(id); if (!value || value.kind !== kind) throw failure('TRANSFER_EXPIRED', '作品传输已失效，请重新执行操作。'); value.expiresAt = Date.now() + TTL_MS; return value; }
  function add(kind: Transfer['kind'], bytes: Buffer, offset = 0) {
    if (transfers.size >= MAX_TRANSFERS) throw failure('BUSY', '同时进行的作品传输过多，请稍后重试。');
    const id = randomUUID(); transfers.set(id, { kind, bytes, offset, expiresAt: Date.now() + TTL_MS }); return id;
  }
  const timer = setInterval(sweep, TTL_MS); timer.unref();
  return {
    async execute(value: AppTransportInput, signal?: AbortSignal): Promise<AppTransportResult> {
      if (closed) throw failure('CLOSED', '作品连接已关闭。');
      const input = appTransportSchema.parse(value);
      sweep();
      const requestSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
      requestSignal.throwIfAborted();
      if (input.action === 'release') return { released: remove(input.transferId) };
      if (input.action === 'upload') {
        const bytes = decode(input.data);
        if (!bytes.length || input.offset + bytes.length > input.size) throw failure('INVALID_ARGUMENT', '作品上传分块大小无效。');
        let id = input.transferId;
        if (!id) {
          if (input.offset !== 0) throw failure('INVALID_ARGUMENT', '作品上传必须从第一个分块开始。');
          if (transfers.size >= MAX_TRANSFERS) throw failure('BUSY', '同时进行的作品传输过多，请稍后重试。');
          reserve(input.size);
          try { id = add('upload', Buffer.alloc(input.size)); } catch (error) { budget -= input.size; throw error; }
        }
        const upload = get(id, 'upload');
        if (upload.bytes.length !== input.size || upload.offset !== input.offset) throw failure('INVALID_ARGUMENT', '作品上传分块顺序或总长度不匹配。');
        bytes.copy(upload.bytes, input.offset); upload.offset += bytes.length;
        return { transferId: id, nextOffset: upload.offset };
      }
      if (input.action === 'download') {
        const download = get(input.transferId, 'download');
        if (input.offset !== download.offset) throw failure('INVALID_ARGUMENT', '作品下载分块顺序不匹配。');
        const end = Math.min(download.bytes.length, input.offset + APP_CHUNK_BYTES);
        const data = download.bytes.subarray(input.offset, end).toString('base64'); download.offset = end;
        return { data, nextOffset: end, done: end === download.bytes.length };
      }
      if (active >= MAX_CONCURRENT) throw failure('BUSY', '同时进行的作品请求过多，请稍后重试。');
      if (input.body !== undefined && input.uploadId) throw failure('INVALID_ARGUMENT', '作品请求不能重复指定内容。');
      let uploaded: Transfer | undefined, responseBytes = 0;
      const bytes = input.body === undefined ? undefined : decode(input.body);
      const request = validateUiRequest({ path: input.path, method: input.method ?? 'GET', headers: input.headers ?? {}, ...(bytes ? { body: bytes } : {}) });
      if (input.uploadId) {
        uploaded = get(input.uploadId, 'upload');
        if (uploaded.offset !== uploaded.bytes.length) throw failure('INVALID_ARGUMENT', '作品上传尚未完成。');
        if (request.method !== 'POST') throw failure('INVALID_ARGUMENT', '读取请求不能包含上传内容。');
        transfers.delete(input.uploadId); request.body = uploaded.bytes;
      }
      active++;
      try {
        const response = await requestUi(request, requestSignal);
        const declaredSize = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && declaredSize > APP_MAX_BYTES) { await response.body?.cancel(); throw failure('TOO_LARGE', '作品响应超过 128 MB。'); }
        const chunks: Buffer[] = [];
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              requestSignal.throwIfAborted();
              const next = await reader.read(); if (next.done) break;
              if (responseBytes + next.value.byteLength > APP_MAX_BYTES) throw failure('TOO_LARGE', '作品响应超过 128 MB。');
              reserve(next.value.byteLength); responseBytes += next.value.byteLength; chunks.push(Buffer.from(next.value));
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const body = Buffer.concat(chunks, responseBytes), headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { if (RESPONSE_HEADERS.has(key)) headers[key] = value; });
        const result = { status: response.status, headers, size: body.length };
        if (body.length <= APP_CHUNK_BYTES) return { ...result, body: body.toString('base64') };
        const downloadId = add('download', body); responseBytes = 0;
        return { ...result, downloadId };
      } finally { active--; budget -= responseBytes; if (uploaded) budget -= uploaded.bytes.length; }
    },
    close() { if (!closed) { closed = true; lifetime.abort(failure('CLOSED', '作品连接已关闭。')); clearInterval(timer); for (const id of transfers.keys()) remove(id); } },
  };
}
