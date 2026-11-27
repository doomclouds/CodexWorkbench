import { Buffer } from 'node:buffer';
import { invalidArgument, tooLarge } from './errors.js';
import { bridgeChunkBytes, bridgeMaximumResponseBytes, type BridgeInput } from './schema.js';

export interface TransferFile {
  append(bytes: Uint8Array): Promise<void>;
  read(offset: number, size: number): Promise<Uint8Array>;
  body(): Promise<Blob>;
  dispose(): Promise<void>;
}

type Upload = Extract<BridgeInput, { action: 'upload' }>;
type TransferKind = 'upload' | 'download';

export interface PrivateResponse {
  readonly status: number;
  readonly contentType?: string;
  readonly size: number;
  readonly body?: string;
  readonly downloadId?: string;
}

interface Transfer {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: TransferKind;
  readonly file: Promise<TransferFile>;
  capacity: number;
  offset: number;
  active: boolean;
  removed: boolean;
}

const maxTransfers = 8;
const maxBudget = bridgeMaximumResponseBytes * 2;

export function decodeChunk(data: string): Uint8Array {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.byteLength > bridgeChunkBytes || bytes.toString('base64') !== data) {
    throw invalidArgument('文件分块必须为规范 Base64。');
  }

  return bytes;
}

async function declaredLength(response: Response, body: ReadableStream<Uint8Array>) {
  const claimed = response.headers.get('content-length');
  if (claimed === null) {
    return undefined;
  }

  const size = Number(claimed);
  if (!Number.isSafeInteger(size) || size < 0) {
    await body.cancel();
    throw invalidArgument('本机服务返回的文件长度无效。');
  }
  if (size > bridgeMaximumResponseBytes) {
    await body.cancel();
    throw tooLarge('本机服务响应超过面板传输限制。');
  }

  return size;
}

export function createTransfers(allocateId: () => string, createFile: () => Promise<TransferFile>) {
  const records = new Map<string, Transfer>();
  let reserved = 0;

  function reserve(sessionId: string, kind: TransferKind, capacity: number): Transfer {
    if (records.size >= maxTransfers || reserved + capacity > maxBudget) {
      throw tooLarge('文件传输并发或缓存预算已用尽。');
    }

    const id = allocateId();
    const file = createFile();
    const transfer = {
      id,
      sessionId,
      kind,
      file,
      capacity,
      offset: 0,
      active: false,
      removed: false,
    };
    records.set(id, transfer);
    reserved += capacity;

    return transfer;
  }

  async function cleanup(transfer: Transfer): Promise<void> {
    records.delete(transfer.id);
    reserved -= transfer.capacity;
    const file = await transfer.file;

    await file.dispose();
  }

  async function retire(transfer: Transfer): Promise<void> {
    if (transfer.removed) {
      return;
    }

    transfer.removed = true;
    if (!transfer.active) {
      await cleanup(transfer);
    }
  }

  async function use<T>(transfer: Transfer, work: (file: TransferFile) => Promise<T>): Promise<T> {
    if (transfer.active || transfer.removed) {
      throw invalidArgument('文件分块正在处理或已失效。');
    }

    transfer.active = true;
    try {
      const result = await work(await transfer.file);
      if (transfer.removed) {
        throw invalidArgument('文件传输已关闭。');
      }

      return result;
    } finally {
      transfer.active = false;
      if (transfer.removed) {
        await cleanup(transfer);
      }
    }
  }

  function lookup(sessionId: string, id: string, kind?: TransferKind): Transfer {
    const transfer = records.get(id);
    if (!transfer || transfer.removed || transfer.sessionId !== sessionId) {
      throw invalidArgument('文件分块不属于当前面板。');
    }
    if (kind && transfer.kind !== kind) {
      throw invalidArgument('文件分块的传输方向不匹配。');
    }

    return transfer;
  }

  async function upload(input: Upload) {
    const { sessionId, transferId, offset, size, data } = input;
    const bytes = decodeChunk(data);
    if (!bytes.byteLength || offset + bytes.byteLength > size) {
      throw invalidArgument('上传分块超出文件长度。');
    }
    if (!transferId && offset !== 0) {
      throw invalidArgument('首个上传分块必须从零开始。');
    }

    const transfer = transferId
      ? lookup(sessionId, transferId, 'upload')
      : reserve(sessionId, 'upload', size);

    if (transfer.capacity !== size || transfer.offset !== offset) {
      throw invalidArgument('上传分块的位置与文件不匹配。');
    }
    if (transfer.active) {
      throw invalidArgument('前一个上传分块尚未确认。');
    }

    try {
      await use(transfer, (file) => file.append(bytes));
      transfer.offset += bytes.byteLength;

      return { transferId: transfer.id, nextOffset: transfer.offset };
    } catch (error) {
      await retire(transfer);
      throw error;
    }
  }

  async function withUpload<T>(
    sessionId: string,
    id: string,
    maximum: number,
    work: (blob: Blob) => Promise<T>,
  ): Promise<T> {
    const transfer = lookup(sessionId, id, 'upload');
    if (transfer.offset !== transfer.capacity) {
      throw invalidArgument('文件还未完整上传。');
    }
    if (transfer.capacity > maximum) {
      throw tooLarge('文件大小超过该操作的限制。');
    }
    if (transfer.active) {
      throw invalidArgument('该上传已经在提交。');
    }

    try {
      return await use(transfer, async (file) => work(await file.body()));
    } finally {
      await retire(transfer);
    }
  }

  async function download(sessionId: string, transferId: string, offset: number) {
    const transfer = lookup(sessionId, transferId, 'download');
    if (offset >= transfer.offset) {
      throw invalidArgument('下载分块的位置超出文件长度。');
    }

    const end = Math.min(offset + bridgeChunkBytes, transfer.offset);
    const bytes = await use(transfer, (file) => file.read(offset, end - offset));

    return {
      data: Buffer.from(bytes).toString('base64'),
      nextOffset: end,
      done: end === transfer.offset,
    };
  }

  async function receive(
    sessionId: string,
    response: Response,
    signal: AbortSignal,
  ): Promise<PrivateResponse> {
    const { status, body } = response;
    const contentType = response.headers.get('content-type') ?? undefined;
    if (!body) {
      return { status, contentType, size: 0, body: '' };
    }

    const declared = await declaredLength(response, body);
    const reader = body.getReader();
    const inline = new Uint8Array(bridgeChunkBytes);
    let size = 0;
    let transfer: Transfer | undefined;

    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const next = size + value.byteLength;
        if (next > bridgeMaximumResponseBytes) {
          throw tooLarge('本机服务响应超过面板传输限制。');
        }
        if (declared !== undefined && next > declared) {
          throw invalidArgument('本机服务实际返回的文件长度与声明不一致。');
        }

        if (transfer) {
          await use(transfer, (file) => file.append(value));
        } else if (next > bridgeChunkBytes) {
          transfer = reserve(sessionId, 'download', declared || bridgeMaximumResponseBytes);
          const prefix = inline.subarray(0, size);
          await use(transfer, async (file) => {
            await file.append(prefix);
            await file.append(value);
          });
        } else {
          inline.set(value, size);
        }
        size = next;
      }

      if (declared !== undefined && size !== declared) {
        throw invalidArgument('本机服务实际返回的文件长度与声明不一致。');
      }

      if (transfer) {
        if (transfer.removed) {
          throw invalidArgument('文件传输已关闭。');
        }

        reserved -= transfer.capacity - size;
        transfer.capacity = size;
        transfer.offset = size;

        return { status, contentType, size, downloadId: transfer.id };
      }

      return {
        status,
        contentType,
        size,
        body: Buffer.from(inline.subarray(0, size)).toString('base64'),
      };
    } catch (error) {
      try {
        if (transfer) {
          await retire(transfer);
        }
      } finally {
        await reader.cancel(error);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async function release(sessionId: string, transferId: string): Promise<void> {
    await retire(lookup(sessionId, transferId));
  }

  async function closeSession(sessionId: string): Promise<void> {
    const transfers = [...records.values()].filter((transfer) => transfer.sessionId === sessionId);
    await Promise.all(transfers.map((transfer) => retire(transfer)));
  }

  return { upload, withUpload, download, receive, release, closeSession };
}
