import { reportMcpWarning } from './diagnostics.js';
import {
  chunkBytes,
  encodeChunk,
  isIdentifier,
  maximumBytes,
  protobufContentType,
  protocolVersion,
  parseToolResult,
  readDownloadResult,
  readResponse,
  readRoute,
  readUploadResult,
  StudioMcpError,
  StudioMcpRequestError,
} from './protocol.js';
import type { AppSession, BinaryResponse, HostExchange } from './protocol.js';

interface McpTransportOptions {
  readonly call: HostExchange;
  readonly session: (signal: AbortSignal) => Promise<AppSession>;
  readonly invalidateSession: (id: string) => void;
  readonly lifetime: AbortSignal;
}

interface SourceBytes {
  readonly size: number;
  readonly slice: (offset: number, end: number) => Promise<Uint8Array>;
}

interface RequestTarget {
  readonly service: string;
  readonly method: string;
  readonly commandId?: string;
}

interface AssetTarget {
  readonly boardId: string;
  readonly assetId: string;
}

interface BinaryResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
}

const archivePath = '/luming.studio.v1.BoardArchiveService/ImportBoardArchive';

function inMemorySource(bytes: Uint8Array): SourceBytes {
  return { size: bytes.length, slice: async (offset, end) => bytes.subarray(offset, end) };
}

function fileSource(file: File): SourceBytes {
  return {
    size: file.size,
    async slice(offset, end) {
      return new Uint8Array(await file.slice(offset, end).arrayBuffer());
    },
  };
}

function protobuf({ bytes, mimeType }: BinaryResult) {
  if (mimeType !== protobufContentType) {
    throw new Error('白板服务返回了无法读取的响应格式。');
  }

  return bytes;
}

export function createMcpTransport({
  call,
  session,
  invalidateSession,
  lifetime,
}: McpTransportOptions) {
  async function exchange(
    id: string,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    try {
      const result = await call({ version: protocolVersion, sessionId: id, ...input }, signal);
      signal.throwIfAborted();
      return parseToolResult(result);
    } catch (error) {
      if (error instanceof StudioMcpError && error.code === 'SESSION_EXPIRED') {
        invalidateSession(id);
      }

      throw error;
    }
  }

  async function release(id: string, transferId: string) {
    try {
      await exchange(id, { action: 'release', transferId }, lifetime);
      return true;
    } catch (error) {
      if (!lifetime.aborted) {
        reportMcpWarning('白板传输片段会在会话到期后回收。', error);
      }

      return false;
    }
  }

  async function upload(id: string, source: SourceBytes, signal: AbortSignal): Promise<string> {
    let transferId: string | undefined;
    try {
      for (let offset = 0; offset < source.size; offset += chunkBytes) {
        signal.throwIfAborted();
        const nextOffset = Math.min(offset + chunkBytes, source.size);
        const bytes = await source.slice(offset, nextOffset);
        if (bytes.length !== nextOffset - offset) {
          throw new Error('无法读取完整的白板文件片段。');
        }

        const frame = {
          action: 'upload',
          transferId,
          offset,
          size: source.size,
          data: encodeChunk(bytes),
        };
        transferId = readUploadResult(await exchange(id, frame, signal), transferId, nextOffset);
      }
    } catch (error) {
      if (transferId) {
        await release(id, transferId);
      }

      throw error;
    }

    if (!transferId) {
      throw new Error('宿主未返回白板上传身份。');
    }

    return transferId;
  }

  async function download(id: string, response: BinaryResponse, signal: AbortSignal) {
    const { body, size } = response;
    if (body.kind === 'inline') {
      return body.data;
    }

    const transferId = body.id;
    const bytes = new Uint8Array(size);
    try {
      for (let offset = 0; offset < size; offset += chunkBytes) {
        const length = Math.min(chunkBytes, size - offset);
        const result = await exchange(id, { action: 'download', transferId, offset }, signal);
        bytes.set(readDownloadResult(result, offset, length, size), offset);
      }

      return bytes;
    } finally {
      await release(id, transferId);
    }
  }

  async function withBinaryResponse(
    id: string,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<BinaryResult> {
    const response = readResponse(await exchange(id, input, signal));

    return { mimeType: response.mimeType, bytes: await download(id, response, signal) };
  }

  function requestSignal(signal: AbortSignal | undefined) {
    return signal ? AbortSignal.any([lifetime, signal]) : lifetime;
  }

  async function request(
    target: RequestTarget,
    source: SourceBytes,
    requestedSignal?: AbortSignal,
  ) {
    if (source.size > maximumBytes) {
      throw new StudioMcpError('TOO_LARGE', '白板文件超过允许的大小。');
    }

    const signal = requestSignal(requestedSignal);
    signal.throwIfAborted();
    const { id } = await session(signal);
    const inline = source.size <= chunkBytes;
    const uploadId = inline ? undefined : await upload(id, source, signal);
    try {
      const body = inline ? encodeChunk(await source.slice(0, source.size)) : undefined;
      return await withBinaryResponse(id, { action: 'request', ...target, body, uploadId }, signal);
    } finally {
      if (uploadId) {
        await release(id, uploadId);
      }
    }
  }

  async function postProtobuf(path: string, bytes: Uint8Array, signal?: AbortSignal) {
    return protobuf(await request(readRoute(path), inMemorySource(bytes), signal));
  }

  async function postArchive(path: string, file: File, commandId: string, signal?: AbortSignal) {
    if (path !== archivePath || !isIdentifier(commandId)) {
      throw new Error('作品备份导入请求无效。');
    }

    const target = { ...readRoute(path), commandId };
    try {
      return protobuf(await request(target, fileSource(file), signal));
    } catch (error) {
      const tooLarge = error instanceof StudioMcpError && error.code === 'TOO_LARGE';
      const rejected = error instanceof StudioMcpRequestError && error.status === 413;
      if (tooLarge || rejected) {
        return 'tooLarge' as const;
      }

      throw error;
    }
  }

  async function getAsset({ boardId, assetId }: AssetTarget, requestedSignal?: AbortSignal) {
    if (!isIdentifier(boardId) || !isIdentifier(assetId)) {
      throw new Error('白板素材引用无效。');
    }

    const signal = requestSignal(requestedSignal);
    signal.throwIfAborted();
    const { id } = await session(signal);

    return withBinaryResponse(id, { action: 'asset', boardId, assetId }, signal);
  }

  return { postProtobuf, postArchive, getAsset };
}
