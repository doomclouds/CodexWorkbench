import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
  type MessageShape,
} from '@bufbuild/protobuf';
import { Buffer } from 'node:buffer';
import { BridgeError, tooLarge } from './errors.js';
import type { DispatchLocalRequest } from './local-request.js';
import { protobufMediaType } from './operations.js';

export interface ModelToolOptions {
  readonly dispatch: DispatchLocalRequest;
  readonly allocateId: () => string;
  readonly onError: (error: unknown) => void;
  readonly observeRead?: (boardId: string) => (() => void) | undefined;
  readonly readArchiveFile?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  readonly readAssetFile?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  readonly writeExportFile?: (
    name: string,
    bytes: Uint8Array,
    signal: AbortSignal,
  ) => Promise<string>;
}

const modelResponseBytes = 4 * 1024 * 1024;

export async function withAgentRead<T>(
  options: ModelToolOptions,
  boardId: string | undefined,
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  const finish = boardId ? options.observeRead?.(boardId) : undefined;
  try {
    return await operation();
  } finally {
    finish?.();
  }
}

function responseError(status: number): BridgeError {
  switch (status) {
    case 400:
    case 415:
    case 422:
      return new BridgeError('INVALID_ARGUMENT', '白板服务无法处理这组参数。');
    case 403:
      return new BridgeError('FORBIDDEN', '当前身份无权访问白板或执行此操作。');
    case 404:
      return new BridgeError('NOT_FOUND', '未找到指定的白板、对象或资源。');
    case 409:
      return new BridgeError('CONFLICT', '白板状态已变化，请读取当前版本并核对请求。');
    case 413:
      return tooLarge('发送给白板服务的请求超过限制。');
    default:
      return new BridgeError('UNAVAILABLE', '当前无法从本机白板服务取得结果。');
  }
}

export async function readModelBytes(
  response: Response,
  maxBytes = modelResponseBytes,
): Promise<Uint8Array> {
  if (!response.ok) {
    await response.body?.cancel();
    throw responseError(response.status);
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge('白板返回超过单次读取限制，请缩小范围或分页。');
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge('白板返回超过单次读取限制，请缩小范围或分页。');
      }

      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, size);
}

export async function callModelRpc<Input extends DescMessage, Output extends DescMessage>(
  options: Pick<ModelToolOptions, 'dispatch'>,
  method: DescMethodUnary & { readonly input: Input; readonly output: Output },
  input: MessageInitShape<Input>,
  signal: AbortSignal,
  maxBytes?: number,
): Promise<MessageShape<Output>> {
  signal.throwIfAborted();
  const response = await options.dispatch(
    {
      route: '/' + method.parent.typeName + '/' + method.name,
      method: 'POST',
      mediaType: protobufMediaType,
      body: toBinary(method.input, create(method.input, input)),
    },
    signal,
  );
  const bytes = await readModelBytes(response, maxBytes);
  signal.throwIfAborted();

  return fromBinary<Output>(method.output, bytes, { readUnknownFields: false });
}

export function modelToolFailure(error: unknown, report: ModelToolOptions['onError']) {
  if (error instanceof BridgeError) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error.message }],
      structuredContent: { ok: false, error: { code: error.code, message: error.message } },
    };
  }

  report(error);

  const message = '本机白板服务暂时不可用，请重新连接。';
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { ok: false, error: { code: 'UNAVAILABLE', message } },
  };
}
