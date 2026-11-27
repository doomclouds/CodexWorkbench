export const protocolVersion = 1;
export const chunkBytes = 128 * 1024;
export const maximumBytes = 128 * 1024 * 1024;
export const protobufContentType = 'application/protobuf';

type Packet = Readonly<Record<string, unknown>>;

export type HostExchange = (arguments_: Packet, signal?: AbortSignal) => Promise<unknown>;

export interface AppSession {
  readonly id: string;
  readonly expiresAtMillis: number;
  readonly boardId?: string;
}

export class StudioMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class StudioMcpRequestError extends Error {
  constructor(readonly status: number) {
    super('白板服务请求失败（HTTP ' + status + '）。');
  }
}

const identifier = /^[A-Za-z0-9_-]{1,128}$/u;
const contentType = /^[a-z][a-z0-9+.-]*\/[a-z0-9][a-z0-9+.-]*$/iu;
const methodPath = /^\/(luming\.studio\.v1\.[A-Za-z]{1,40})\/([A-Z][A-Za-z]{0,63})$/u;
const suggestionService = 'luming.studio.v1.BoardSuggestionService';
const suggestionReviewMethods = new Set([
  'CreateBoardReviewSource',
  'ListBoardSuggestions',
  'PreviewBoardSuggestion',
  'AcceptBoardSuggestion',
  'RejectBoardSuggestion',
]);
const allowedServices = new Set(
  [
    'WhiteboardService',
    'BoardEditService',
    'BoardHistoryService',
    'FeedbackService',
    'BoardCatalogService',
    'BoardArchiveService',
    'BoardSharingService',
    'BoardRoomService',
    'BoardSuggestionService',
  ].map((name) => 'luming.studio.v1.' + name),
);

export function record(value: unknown): Packet | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Packet;
  }
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifier.test(value);
}

export function parseToolResult(value: unknown) {
  const result = record(value);
  if (!result) {
    throw new Error('宿主未返回有效的白板操作结果。');
  }

  const structured = record(result.structuredContent);
  if (result.isError === true || structured?.ok === false) {
    const rejection = record(structured?.error);
    const code = isIdentifier(rejection?.code) ? rejection.code : 'UNAVAILABLE';
    const message = typeof rejection?.message === 'string' ? rejection.message.slice(0, 400) : '';
    throw new StudioMcpError(code, message || '宿主无法完成白板操作。');
  }
  if (structured?.ok !== true) {
    throw new Error('宿主未确认白板操作成功。');
  }

  return result;
}

export function decodeSession(result: Packet, boardId?: string): AppSession | undefined {
  const metadata = record(result._meta);
  const session = record(metadata?.session);
  const { id, expiresAtMillis } = session ?? {};
  if (isIdentifier(id) && boundedInteger(expiresAtMillis, Number.MAX_SAFE_INTEGER)) {
    return { id, expiresAtMillis, boardId };
  }
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function readRoute(path: string) {
  const [, service, method] = methodPath.exec(path) ?? [];
  if (!service || !method || !allowedServices.has(service)) {
    throw new Error('白板面板仅支持已声明的 Protobuf 服务。');
  }
  if (service === suggestionService && !suggestionReviewMethods.has(method)) {
    throw new Error('白板面板仅支持已声明的建议评审操作。');
  }

  return { service, method };
}

export function encodeChunk(bytes: Uint8Array) {
  const step = 8 * 1024;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }

  return btoa(binary);
}

export function decodeChunk(encoded: unknown, expectedSize: number) {
  const expectedLength = 4 * Math.ceil(expectedSize / 3);
  if (typeof encoded !== 'string' || encoded.length !== expectedLength) {
    throw new Error('宿主返回的白板数据长度与记录不匹配。');
  }

  const binary = atob(encoded);
  if (binary.length !== expectedSize || btoa(binary) !== encoded) {
    throw new Error('宿主返回的白板数据格式无效。');
  }

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

type ResponseBody =
  | { readonly kind: 'inline'; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'download'; readonly id: string };

export interface BinaryResponse {
  readonly size: number;
  readonly mimeType: string;
  readonly body: ResponseBody;
}

function responseBody(response: Packet, size: number): ResponseBody {
  if (isIdentifier(response.downloadId) && response.body === undefined) {
    return { kind: 'download', id: response.downloadId };
  }
  if (size > chunkBytes || response.downloadId !== undefined) {
    throw new Error('宿主返回了不受支持的白板传输帧。');
  }

  const data =
    size === 0 && response.body === undefined ? new Uint8Array() : decodeChunk(response.body, size);

  return { kind: 'inline', data };
}

export function readResponse(result: Packet): BinaryResponse {
  const response = record(record(result._meta)?.response);
  const status = response?.status;
  if (!response || !boundedInteger(status, 599) || status < 100) {
    throw new Error('宿主未返回白板服务状态。');
  }
  if (status < 200 || status >= 300) {
    throw new StudioMcpRequestError(status);
  }

  const { size, contentType: rawType } = response;
  const mimeType =
    typeof rawType === 'string' ? rawType.split(';', 1)[0]?.trim().toLowerCase() : undefined;

  if (!boundedInteger(size, maximumBytes)) {
    throw new Error('宿主返回的白板数据超过大小限制。');
  }
  if (typeof mimeType !== 'string' || !contentType.test(mimeType)) {
    throw new Error('宿主返回了不支持的白板响应类型。');
  }

  return { size, mimeType, body: responseBody(response, size) };
}

export function readUploadResult(
  result: Packet,
  currentId: string | undefined,
  expectedOffset: number,
) {
  const transfer = record(record(result._meta)?.transfer);
  const returnedId = transfer?.transferId;
  if (!isIdentifier(returnedId) || transfer?.nextOffset !== expectedOffset) {
    throw new Error('宿主未确认已发送的白板文件片段。');
  }
  if (currentId !== undefined && currentId !== returnedId) {
    throw new Error('宿主返回的白板上传身份不一致。');
  }

  return returnedId;
}

export function readDownloadResult(result: Packet, offset: number, length: number, size: number) {
  const chunk = record(record(result._meta)?.chunk);
  const nextOffset = offset + length;
  if (!chunk || chunk.nextOffset !== nextOffset || chunk.done !== (nextOffset === size)) {
    throw new Error('宿主返回的白板下载片段不连续。');
  }

  return decodeChunk(chunk.data, length);
}
