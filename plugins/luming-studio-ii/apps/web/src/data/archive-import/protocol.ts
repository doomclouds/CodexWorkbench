import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  ArchiveImportRejectionReason,
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
  type ArchiveImportReceipt as WireReceipt,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';

export interface ArchiveImportCommand {
  readonly file: File;
  readonly commandId: string;
}

export interface ArchiveImportReceipt {
  readonly boardId: string;
  readonly title: string;
}

export interface ArchiveImportService {
  readonly importArchive: (
    command: ArchiveImportCommand,
    signal?: AbortSignal,
  ) => Promise<ArchiveImportReceipt>;
}

type ArchivePost = (
  path: string,
  file: File,
  commandId: string,
  signal?: AbortSignal,
) => Promise<Uint8Array | 'tooLarge'>;

type ReceiptPost = (path: string, body: Uint8Array, signal?: AbortSignal) => Promise<Uint8Array>;

type Receipt =
  | { readonly kind: 'imported'; readonly board: ArchiveImportReceipt }
  | { readonly kind: 'rejected'; readonly message: string };

const receiptMethod = BoardArchiveService.method.getArchiveImportReceipt;
const servicePath = '/' + BoardArchiveService.typeName + '/';
const importPath = servicePath + 'ImportBoardArchive';
const receiptPath = servicePath + receiptMethod.name;
const rejectionMessages = new Map([
  [ArchiveImportRejectionReason.INVALID_ARCHIVE, '无法读取此作品备份。'],
  [
    ArchiveImportRejectionReason.UNSUPPORTED_VERSION,
    '此作品备份的格式版本不受支持。请使用当前版本导出的备份。',
  ],
  [ArchiveImportRejectionReason.INCOMPATIBLE_CONTENT, '此作品备份包含暂不支持的内容。'],
  [ArchiveImportRejectionReason.COMMAND_ID_REUSE, '本次导入请求已用于其他作品备份。'],
]);

function readReceipt(receipt: WireReceipt | undefined, commandId: string): Receipt {
  if (receipt?.commandId !== commandId) {
    throw new Error('作品备份回执与本次请求不匹配。');
  }

  const { case: kind, value } = receipt.outcome;
  if (kind === 'imported' && value.boardId.trim()) {
    return { kind, board: { boardId: value.boardId, title: value.title } };
  }

  if (kind === 'rejected') {
    const message = rejectionMessages.get(value.reason) ?? '作品备份未能导入。';

    return { kind, message };
  }

  throw new Error('缺少作品备份的导入结果。');
}

async function lookupReceipt(
  post: ReceiptPost,
  commandId: string,
  signal?: AbortSignal,
): Promise<Receipt | undefined> {
  const body = toBinary(receiptMethod.input, create(receiptMethod.input, { commandId }));
  const bytes = await post(receiptPath, body, signal);
  const { result } = fromBinary(receiptMethod.output, bytes, { readUnknownFields: false });
  if (result.case === 'receipt') {
    return readReceipt(result.value, commandId);
  }
  if (result.case === 'notRecorded' && result.value.commandId === commandId) {
    return undefined;
  }

  throw new Error('无法核对作品备份的导入回执。');
}

async function recoverReceipt(
  post: ReceiptPost,
  commandId: string,
  failure: unknown,
  signal?: AbortSignal,
): Promise<Receipt> {
  signal?.throwIfAborted();
  let receipt: Receipt | undefined;
  try {
    receipt = await lookupReceipt(post, commandId, signal);
  } catch (lookupFailure) {
    signal?.throwIfAborted();
    throw new AggregateError([failure, lookupFailure], '无法确认导入结果，请先检查工作台。', {
      cause: lookupFailure,
    });
  }

  signal?.throwIfAborted();

  if (!receipt) {
    throw new Error('暂未确认导入结果，请先检查工作台。', { cause: failure });
  }

  return receipt;
}

async function submitArchive(
  upload: ArchivePost,
  post: ReceiptPost,
  { file, commandId }: ArchiveImportCommand,
  signal?: AbortSignal,
): Promise<Receipt> {
  try {
    const bytes = await upload(importPath, file, commandId, signal);
    if (bytes === 'tooLarge') {
      return { kind: 'rejected', message: '作品备份超过 128 MB。' };
    }

    const { receipt } = fromBinary(ImportBoardArchiveResponseSchema, bytes, {
      readUnknownFields: false,
    });

    return readReceipt(receipt, commandId);
  } catch (failure) {
    return recoverReceipt(post, commandId, failure, signal);
  }
}

export function createArchiveImportService(
  upload: ArchivePost,
  post: ReceiptPost,
): ArchiveImportService {
  return {
    async importArchive(command, signal) {
      signal?.throwIfAborted();
      const receipt = await submitArchive(upload, post, command, signal);
      signal?.throwIfAborted();
      if (receipt.kind === 'rejected') {
        throw new Error(receipt.message);
      }

      return receipt.board;
    },
  };
}
