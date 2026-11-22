import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BOARD_OPEN_CHECK,
  BOARD_SCENE_CHECK,
  parseBoardOpenKnown,
} from '../contracts/board-open.js';
import {
  APP_CHUNK_BYTES,
  APP_MAX_BYTES,
  type AppTransferSpool,
  type AppTransferSpoolFactory,
  type AppTransportInput,
  type AppTransportResult,
  type UiHttpRequest,
  type UiRequester,
} from '../contracts/transport.js';
import { TOOL_NAMES } from '../contracts/studio.js';

const transferId = z.uuid();
const base64 = z.string().max(Math.ceil(APP_CHUNK_BYTES / 3) * 4);
export const appTransportSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('request'),
      path: z.string().min(1).max(8192),
      method: z.enum(['GET', 'POST']).optional(),
      headers: z.record(z.string(), z.string().max(4096)).optional(),
      body: base64.optional(),
      uploadId: transferId.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('upload'),
      transferId: transferId.optional(),
      offset: z.number().int().min(0).max(APP_MAX_BYTES),
      size: z.number().int().min(1).max(APP_MAX_BYTES),
      data: base64,
    })
    .strict(),
  z
    .object({
      action: z.literal('download'),
      transferId,
      offset: z.number().int().min(0).max(APP_MAX_BYTES),
    })
    .strict(),
  z.object({ action: z.literal('release'), transferId }).strict(),
]);
const REQUEST_HEADERS = new Set(['content-type', 'x-filename', 'x-content-type']);
const RESPONSE_HEADERS = new Set([
  'content-type',
  'content-disposition',
  'cache-control',
  'content-length',
]);
const TTL_MS = 120_000;
const MAX_TRANSFERS = 8;
const MAX_CONCURRENT = 4;
const MAX_QUEUED = 64;
const MAX_SYNC_WAITERS = 64;
const MAX_BUDGET = APP_MAX_BYTES * 2;
const SPOOL_THRESHOLD = 1024 * 1024;

type PendingSpool = Promise<AppTransferSpool>;
type TransferBody =
  | { size: number; bytes: Buffer; spool?: never }
  | { size: number; bytes?: never; spool: PendingSpool };

interface Transfer {
  kind: 'upload' | 'download';
  body: TransferBody;
  offset: number;
  expiresAt: number;
  busy: boolean;
}
interface RequestSlots {
  active: number;
  queue: Array<() => void>;
}
interface ResponseSpooling {
  create(): PendingSpool;
  dispose(spool: PendingSpool): Promise<void>;
}

function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function uiRequestUrl(path: string): URL {
  if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/')) {
    throw failure('INVALID_ARGUMENT', '作品请求路径无效。');
  }
  if (path.startsWith('//') || /[\\#\u0000-\u0020]/.test(path) || /%(?:2e|2f|5c|25)/i.test(path)) {
    throw failure('INVALID_ARGUMENT', '作品请求路径无效。');
  }

  const url = new URL(path, 'http://studio.invalid');
  if (
    url.origin !== 'http://studio.invalid' ||
    url.pathname.split('/').some((segment) => segment === '.' || segment === '..') ||
    path.split('?')[0] !== url.pathname
  ) {
    throw failure('INVALID_ARGUMENT', '作品请求路径无效。');
  }

  return url;
}

function uiRouteAllowed(pathname: string, method: UiHttpRequest['method']): boolean {
  const tool = /^\/api\/tools\/([^/]+)$/.exec(pathname);
  if (tool) {
    return method === 'POST' && TOOL_NAMES.includes(tool[1] as (typeof TOOL_NAMES)[number]);
  }
  if (pathname === '/api/presence') {
    return true;
  }
  if (['/api/room', '/api/import', '/api/assets'].includes(pathname)) {
    return method === 'POST';
  }
  if (['/api/sync', '/api/session'].includes(pathname)) {
    return method === 'GET';
  }

  return (
    method === 'GET' &&
    /^\/(?:assets\/[^/]+\/[^/]+|api\/(?:assets\/[^/]+(?:\/[^/]+)?|exports\/[^/]+|thumbnails\/[^/]+))$/.test(
      pathname,
    )
  );
}

function validateSyncParameter(key: string, value: string): void {
  if (key === 'wait' && (!/^(?:0|[1-9]\d*)$/.test(value) || Number(value) > 20_000)) {
    throw failure('INVALID_ARGUMENT', '同步等待时间应为 0 到 20000 毫秒。');
  }
  if (key === 'after' && !/^[A-Za-z0-9_-]{1,120}:\d{1,16}$/.test(value)) {
    throw failure('INVALID_ARGUMENT', '同步水位无效。');
  }
  if (
    (key === 'peerId' || key === 'peerEpoch') &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)
  ) {
    throw failure('INVALID_ARGUMENT', '协作页面标识无效。');
  }
}

function validateQuery(url: URL, method: UiHttpRequest['method']): void {
  const thumbnail = method === 'GET' && /^\/api\/thumbnails\/[^/]+$/.test(url.pathname);
  const sync = url.pathname === '/api/sync';
  const check = sync ? url.searchParams.get('check') : null;
  let allowedKeys = ['artifactId'];
  if (thumbnail) {
    allowedKeys = ['revision'];
  }
  if (sync) {
    allowedKeys = ['artifactId', 'after', 'wait', 'peerId', 'peerEpoch'];
  }
  if (check === BOARD_SCENE_CHECK) {
    allowedKeys = ['artifactId', 'check'];
  }
  if (check === BOARD_OPEN_CHECK) {
    allowedKeys = ['artifactId', 'check', 'knownRevision', 'knownEpoch'];
  }
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !allowedKeys.includes(key)) {
      throw failure('FORBIDDEN', '作品请求不能指定连接凭据、重复或未知查询参数。');
    }
    if (
      key === 'revision' &&
      (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    ) {
      throw failure('INVALID_ARGUMENT', '作品缩略图版本号无效。');
    }

    if (sync) {
      validateSyncParameter(key, value);
    }
    seen.add(key);
  }
  if (
    check === BOARD_OPEN_CHECK &&
    parseBoardOpenKnown(
      url.searchParams.get('knownRevision'),
      url.searchParams.get('knownEpoch'),
    ) === null
  ) {
    throw failure('INVALID_ARGUMENT', '白板读取版次或服务代次无效。');
  }
}

function validateBody({ method, body, bodyBlob }: UiHttpRequest): void {
  if (body !== undefined && bodyBlob !== undefined) {
    throw failure('INVALID_ARGUMENT', '作品请求不能重复指定内容。');
  }
  if (method === 'GET' && (body !== undefined || bodyBlob !== undefined)) {
    throw failure('INVALID_ARGUMENT', '读取请求不能包含内容。');
  }
  if ((body?.byteLength ?? bodyBlob?.size ?? 0) > APP_MAX_BYTES) {
    throw failure('TOO_LARGE', '作品请求超过 128 MB。');
  }
}

export function validateUiRequest(request: UiHttpRequest): UiHttpRequest {
  const { path, method } = request;
  const url = uiRequestUrl(path);
  if (method !== 'GET' && method !== 'POST') {
    throw failure('INVALID_ARGUMENT', '作品请求方法无效。');
  }
  if (!uiRouteAllowed(url.pathname, method)) {
    throw failure('FORBIDDEN', '此地址不能通过作品界面访问。');
  }

  validateQuery(url, method);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers || {})) {
    const lower = key.toLowerCase();
    const validValue =
      typeof value === 'string' && value.length <= 4096 && !/[\r\n\u0000]/.test(value);

    if (!REQUEST_HEADERS.has(lower) || !validValue) {
      throw failure('FORBIDDEN', '作品请求包含不允许的请求头。');
    }

    headers[lower] = value;
  }
  validateBody(request);
  const { body, bodyBlob } = request;

  return {
    path: url.pathname + url.search,
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(bodyBlob !== undefined ? { bodyBlob } : {}),
  };
}

async function flushResponseChunks(spool: PendingSpool, chunks: Buffer[]): Promise<void> {
  const file = await spool;
  for (const chunk of chunks) {
    await file.append(chunk);
  }

  chunks.length = 0;
}

async function readResponse(
  response: Response,
  signal: AbortSignal,
  reserveChunk: (size: number) => void,
  spooling?: ResponseSpooling,
): Promise<TransferBody> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > APP_MAX_BYTES) {
    await response.body?.cancel();
    throw failure('TOO_LARGE', '作品响应超过 128 MB。');
  }
  if (!response.body) {
    return { size: 0, bytes: Buffer.alloc(0) };
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let spool: PendingSpool | undefined;
  const reader = response.body.getReader();
  const reportCancelFailure = (error: unknown) => {
    if (!signal.aborted) {
      console.error('Studio 作品响应流未能取消。', error);
    }
  };
  const abort = () => {
    reader.cancel(signal.reason).catch(reportCancelFailure);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) {
        break;
      }

      const length = next.value.byteLength;
      if (size + length > APP_MAX_BYTES) {
        throw failure('TOO_LARGE', '作品响应超过 128 MB。');
      }

      reserveChunk(length);
      size += length;
      if (!spool && spooling && size > SPOOL_THRESHOLD) {
        spool = spooling.create();
        await flushResponseChunks(spool, chunks);
      }
      if (spool) {
        await (await spool).append(next.value);
      } else {
        chunks.push(Buffer.from(next.value));
      }
    }

    return spool ? { size, spool } : { size, bytes: Buffer.concat(chunks, size) };
  } catch (error) {
    if (spool && spooling) {
      await spooling.dispose(spool);
    }

    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(reportCancelFailure);
    reader.releaseLock();
  }
}

function decode(value: string) {
  if (
    value.length % 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw failure('INVALID_ARGUMENT', '作品分块不是有效的 Base64。');
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > APP_CHUNK_BYTES || bytes.toString('base64') !== value) {
    throw failure('TOO_LARGE', '作品分块超过 128 KiB 或编码无效。');
  }

  return bytes;
}

export function createAppTransport(requestUi: UiRequester, createSpool?: AppTransferSpoolFactory) {
  const transfers = new Map<string, Transfer>();
  const spools = new Map<PendingSpool, Promise<void> | undefined>();
  let budget = 0;
  let closed = false;
  let closing: Promise<void> | undefined;
  const requests: RequestSlots = { active: 0, queue: [] };
  const waits: RequestSlots = { active: 0, queue: [] };
  const lifetime = new AbortController();
  async function acquire(signal: AbortSignal, waiting: boolean) {
    const slots = waiting ? waits : requests;
    const maximum = waiting ? MAX_SYNC_WAITERS : MAX_CONCURRENT;
    signal.throwIfAborted();
    if (slots.active >= maximum) {
      if (waiting || slots.queue.length >= MAX_QUEUED) {
        throw failure(
          'BUSY',
          waiting
            ? '同时打开的同步页面过多，请关闭不使用的作品页面。'
            : '作品请求队列已满，请稍后重试。',
        );
      }

      await new Promise<void>((resolve, reject) => {
        const enter = () => {
          signal.removeEventListener('abort', abort);
          slots.active++;
          resolve();
        };
        const abort = () => {
          const index = slots.queue.indexOf(enter);
          if (index !== -1) {
            slots.queue.splice(index, 1);
          }
          reject(signal.reason);
        };
        slots.queue.push(enter);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else {
      slots.active++;
    }
    let released = false;
    return () => {
      if (!released) {
        released = true;
        slots.active--;
        slots.queue.shift()?.();
      }
    };
  }
  function reserve(size: number) {
    if (budget + size > MAX_BUDGET) {
      throw failure('BUSY', '作品传输缓存已满，请稍后重试。');
    }

    budget += size;
  }
  function startSpool() {
    const pending = createSpool!();
    spools.set(pending, undefined);
    return pending;
  }
  async function discardSpool(spool?: PendingSpool) {
    if (!spool || !spools.has(spool)) {
      return;
    }

    const cleaning =
      spools.get(spool) ??
      spool
        .then((file) => file.dispose())
        .catch((error: unknown) => {
          console.error('Studio 作品传输临时文件未能清理。', error);
        })
        .finally(() => {
          spools.delete(spool);
        });
    spools.set(spool, cleaning);
    await cleaning;
  }
  async function remove(id: string) {
    const value = transfers.get(id);
    if (!value) {
      return false;
    }

    transfers.delete(id);
    await discardSpool(value.body.spool);
    budget -= value.body.size;
    return true;
  }
  async function sweep() {
    const now = Date.now();
    const expired: Promise<boolean>[] = [];
    for (const [id, value] of transfers) {
      if (!value.busy && value.expiresAt <= now) {
        expired.push(remove(id));
      }
    }
    await Promise.all(expired);
  }
  function get(id: string, kind: Transfer['kind']) {
    const value = transfers.get(id);
    if (!value || value.kind !== kind) {
      throw failure('TRANSFER_EXPIRED', '作品传输已失效，请重新执行操作。');
    }

    value.expiresAt = Date.now() + TTL_MS;
    return value;
  }
  function transferSlot() {
    if (transfers.size >= MAX_TRANSFERS) {
      throw failure('BUSY', '同时进行的作品传输过多，请稍后重试。');
    }
  }
  function add(kind: Transfer['kind'], body: TransferBody) {
    transferSlot();

    const id = randomUUID();
    transfers.set(id, { kind, body, offset: 0, busy: false, expiresAt: Date.now() + TTL_MS });
    return id;
  }
  function startUpload(size: number) {
    transferSlot();
    reserve(size);
    try {
      return add(
        'upload',
        createSpool && size > SPOOL_THRESHOLD
          ? { size, spool: startSpool() }
          : { size, bytes: Buffer.alloc(size) },
      );
    } catch (error) {
      budget -= size;
      throw error;
    }
  }
  async function appendUpload(
    input: Extract<AppTransportInput, { action: 'upload' }>,
    signal: AbortSignal,
  ) {
    const bytes = decode(input.data);
    if (!bytes.length || input.offset + bytes.length > input.size) {
      throw failure('INVALID_ARGUMENT', '作品上传分块大小无效。');
    }

    let id = input.transferId;
    if (!id) {
      if (input.offset !== 0) {
        throw failure('INVALID_ARGUMENT', '作品上传必须从第一个分块开始。');
      }

      id = startUpload(input.size);
    }
    const upload = get(id, 'upload');
    if (upload.busy || upload.body.size !== input.size || upload.offset !== input.offset) {
      throw failure('INVALID_ARGUMENT', '作品上传分块顺序或总长度不匹配。');
    }

    upload.busy = true;
    try {
      if (upload.body.spool) {
        await (await upload.body.spool).append(bytes);
        signal.throwIfAborted();
        get(id, 'upload');
      } else {
        bytes.copy(upload.body.bytes, input.offset);
      }
      upload.offset += bytes.length;
      return { transferId: id, nextOffset: upload.offset };
    } catch (error) {
      await remove(id);
      throw error;
    } finally {
      upload.busy = false;
    }
  }
  async function readDownload(
    input: Extract<AppTransportInput, { action: 'download' }>,
    signal: AbortSignal,
  ) {
    const download = get(input.transferId, 'download');
    if (download.busy || input.offset !== download.offset) {
      throw failure('INVALID_ARGUMENT', '作品下载分块顺序不匹配。');
    }

    download.busy = true;
    try {
      const body = download.body;
      const end = Math.min(body.size, input.offset + APP_CHUNK_BYTES);
      const data = body.spool
        ? Buffer.from(await (await body.spool).read(input.offset, end - input.offset))
        : body.bytes.subarray(input.offset, end);
      signal.throwIfAborted();
      get(input.transferId, 'download');
      download.offset = end;
      return { data: data.toString('base64'), nextOffset: end, done: end === body.size };
    } finally {
      download.busy = false;
    }
  }
  function takeUpload(id: string, method: UiHttpRequest['method']) {
    const upload = get(id, 'upload');
    if (upload.busy || upload.offset !== upload.body.size) {
      throw failure('INVALID_ARGUMENT', '作品上传尚未完成。');
    }
    if (method !== 'POST') {
      throw failure('INVALID_ARGUMENT', '读取请求不能包含上传内容。');
    }

    transfers.delete(id);
    return upload.body;
  }
  async function sendRequest(
    input: Extract<AppTransportInput, { action: 'request' }>,
    requestSignal: AbortSignal,
  ): Promise<AppTransportResult> {
    if (input.body !== undefined && input.uploadId) {
      throw failure('INVALID_ARGUMENT', '作品请求不能重复指定内容。');
    }

    let uploaded: TransferBody | undefined;
    let downloaded: TransferBody | undefined;
    let responseBytes = 0;
    const bytes = input.body === undefined ? undefined : decode(input.body);
    const request = validateUiRequest({
      path: input.path,
      method: input.method ?? 'GET',
      headers: input.headers ?? {},
      ...(bytes ? { body: bytes } : {}),
    });
    const endpoint = new URL(request.path, 'http://studio.invalid');

    const unlock = await acquire(
      requestSignal,
      endpoint.pathname === '/api/sync' && Number(endpoint.searchParams.get('wait')) > 0,
    );

    try {
      requestSignal.throwIfAborted();
      if (input.uploadId) {
        uploaded = takeUpload(input.uploadId, request.method);
        if (uploaded.spool) {
          request.bodyBlob = await (await uploaded.spool).blob();
          requestSignal.throwIfAborted();
        } else {
          request.body = uploaded.bytes;
        }
      }
      const response = await requestUi(request, requestSignal);
      const isZip =
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ===
        'application/zip';
      downloaded = await readResponse(
        response,
        requestSignal,
        (size) => {
          reserve(size);
          responseBytes += size;
        },
        createSpool && isZip ? { create: startSpool, dispose: discardSpool } : undefined,
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (RESPONSE_HEADERS.has(key)) {
          headers[key] = value;
        }
      });
      const result = { status: response.status, headers, size: downloaded.size };
      if (downloaded.bytes && downloaded.size <= APP_CHUNK_BYTES) {
        return { ...result, body: downloaded.bytes.toString('base64') };
      }

      const downloadId = add('download', downloaded);
      downloaded = undefined;
      responseBytes = 0;
      return { ...result, downloadId };
    } finally {
      unlock();
      await Promise.all([discardSpool(downloaded?.spool), discardSpool(uploaded?.spool)]);
      budget -= responseBytes + (uploaded?.size ?? 0);
    }
  }
  const timer = setInterval(() => {
    sweep().catch((error: unknown) => {
      console.error('Studio 作品传输过期清理失败。', error);
    });
  }, TTL_MS);
  timer.unref();
  return {
    async execute(value: AppTransportInput, signal?: AbortSignal): Promise<AppTransportResult> {
      if (closed) {
        throw failure('CLOSED', '作品连接已关闭。');
      }

      const input = appTransportSchema.parse(value);
      await sweep();
      const requestSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
      requestSignal.throwIfAborted();
      switch (input.action) {
        case 'release':
          return { released: await remove(input.transferId) };
        case 'upload':
          return appendUpload(input, requestSignal);
        case 'download':
          return readDownload(input, requestSignal);
        case 'request':
          return sendRequest(input, requestSignal);
      }
    },
    close() {
      if (!closing) {
        closed = true;
        lifetime.abort(failure('CLOSED', '作品连接已关闭。'));
        clearInterval(timer);
        closing = Promise.all([
          ...Array.from(transfers.keys(), remove),
          ...Array.from(spools.keys(), discardSpool),
        ]).then(() => undefined);
      }
      return closing;
    },
  };
}
