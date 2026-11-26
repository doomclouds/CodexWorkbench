import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  ArchiveImportRejectionReason,
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import { expect, it } from 'vitest';
import { createArchiveImportService } from '../../src/data/archive-import/index.js';

const commandId = 'zip-import-1';
const file = new File(['test archive'], 'board.studio.zip', { type: 'application/zip' });
const command = { commandId, file };
const board = { boardId: 'new-board', title: 'Studio 工作台' };
const outcome = { case: 'imported', value: board } as const;
const receipt = { commandId, outcome };
const receiptMethod = BoardArchiveService.method.getArchiveImportReceipt;
const servicePath = '/luming.studio.v1.BoardArchiveService/';

function unexpectedReceiptLookup(): Promise<never> {
  return Promise.reject(new Error('Unexpected receipt lookup'));
}

it('uploads the actual selected file and command ID and reads the confirmed board', async () => {
  const signal = new AbortController().signal;
  const bytes = toBinary(
    ImportBoardArchiveResponseSchema,
    create(ImportBoardArchiveResponseSchema, { receipt }),
  );
  const service = createArchiveImportService((path, selected, id, activeSignal) => {
    expect(path).toBe(servicePath + 'ImportBoardArchive');
    expect(selected).toBe(file);
    expect(id).toBe(commandId);
    expect(activeSignal).toBe(signal);

    return Promise.resolve(bytes);
  }, unexpectedReceiptLookup);

  await expect(service.importArchive(command, signal)).resolves.toEqual(board);
});

it('explains an unsupported format using the confirmed rejection', async () => {
  const bytes = toBinary(
    ImportBoardArchiveResponseSchema,
    create(ImportBoardArchiveResponseSchema, {
      receipt: {
        commandId,
        outcome: {
          case: 'rejected',
          value: { reason: ArchiveImportRejectionReason.UNSUPPORTED_VERSION },
        },
      },
    }),
  );
  const service = createArchiveImportService(() => Promise.resolve(bytes), unexpectedReceiptLookup);

  await expect(service.importArchive(command)).rejects.toThrow('格式版本不受支持');
});

it('reports the archive limit for an oversized payload', async () => {
  const service = createArchiveImportService(
    () => Promise.resolve('tooLarge'),
    unexpectedReceiptLookup,
  );

  await expect(service.importArchive(command)).rejects.toThrow('作品备份超过 128 MB');
});

it('looks up the original command after a lost response and uses its receipt', async () => {
  const signal = new AbortController().signal;
  let uploads = 0;
  const service = createArchiveImportService(
    () => {
      uploads++;

      return Promise.reject(new Error('Connection interrupted'));
    },
    (path, body, activeSignal) => {
      expect(path).toBe(servicePath + receiptMethod.name);
      expect(fromBinary(receiptMethod.input, body).commandId).toBe(commandId);
      expect(activeSignal).toBe(signal);

      return Promise.resolve(
        toBinary(
          receiptMethod.output,
          create(receiptMethod.output, { result: { case: 'receipt', value: receipt } }),
        ),
      );
    },
  );

  await expect(service.importArchive(command, signal)).resolves.toEqual(board);
  expect(uploads).toBe(1);
});

it('preserves the transport failure when the result is unconfirmed', async () => {
  const failure = new Error('Connection interrupted');
  const bytes = toBinary(
    receiptMethod.output,
    create(receiptMethod.output, { result: { case: 'notRecorded', value: { commandId } } }),
  );
  const service = createArchiveImportService(
    () => Promise.reject(failure),
    () => Promise.resolve(bytes),
  );

  await expect(service.importArchive(command)).rejects.toMatchObject({
    message: '暂未确认导入结果，请先检查工作台。',
    cause: failure,
  });
});

it('preserves cancellation when the upload is in progress', async () => {
  const controller = new AbortController();
  const cancellation = new Error('Page closed');
  const service = createArchiveImportService(() => {
    controller.abort(cancellation);

    return Promise.reject(new Error('Request interrupted'));
  }, unexpectedReceiptLookup);

  await expect(service.importArchive(command, controller.signal)).rejects.toBe(cancellation);
});
