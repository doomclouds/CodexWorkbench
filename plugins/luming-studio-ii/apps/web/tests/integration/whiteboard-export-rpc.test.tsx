import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardExportFormat,
  BoardExportRejectionReason,
  WhiteboardService as wireService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  createWhiteboardExportService,
  type ExportBoardFile,
  type ExportBoardRequest,
  type ExportBoardResult,
  type WhiteboardPost,
} from '../../src/data/whiteboard/index.js';

const method = wireService.method.exportBoard;
const boardId = 'release-board';
const revision = 17n;
const svgContent = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const jsonContent = new TextEncoder().encode('{"objects":[]}');

const svgFile: ExportBoardFile = {
  filename: '发布白板.svg',
  revision,
  mimeType: 'image/svg+xml',
  content: svgContent,
};

const request: ExportBoardRequest = {
  boardId,
  expectedRevision: revision,
  scope: { kind: 'whole' },
  format: 'svg',
};

function respond(result: MessageInitShape<typeof method.output>): WhiteboardPost {
  return async () => toBinary(method.output, create(method.output, result));
}

function expectFile(result: ExportBoardResult, expected: ExportBoardFile) {
  if (result.kind !== 'file') {
    throw new Error('Expected an exported file.');
  }

  const { content, ...identity } = result.file;
  const { content: expectedContent, ...expectedIdentity } = expected;
  expect(identity).toEqual(expectedIdentity);
  expect([...content]).toEqual([...expectedContent]);
}

test('pins the selected object IDs and their expected revision on the public export RPC', async () => {
  const controller = new AbortController();
  const exportBoard = createWhiteboardExportService(async (path, bytes, signal) => {
    expect(path).toBe('/luming.studio.v1.WhiteboardService/ExportBoard');
    expect(signal).toBe(controller.signal);
    expect(fromBinary(method.input, bytes)).toMatchObject({
      boardId,
      expectedRevision: revision,
      scope: { case: 'selection', value: { objectIds: ['frame', 'card'] } },
      format: BoardExportFormat.SVG,
    });

    return toBinary(
      method.output,
      create(method.output, { result: { case: 'file', value: svgFile } }),
    );
  });

  const result = await exportBoard(
    { ...request, scope: { kind: 'selection', objectIds: ['frame', 'card'] } },
    controller.signal,
  );
  expectFile(result, svgFile);
});

test('sends an explicit whole scope and keeps the optional revision zero present', async () => {
  const jsonFile: ExportBoardFile = {
    filename: '发布白板.json',
    revision: 0n,
    mimeType: 'application/json',
    content: jsonContent,
  };
  const exportBoard = createWhiteboardExportService(async (_path, bytes) => {
    expect(fromBinary(method.input, bytes)).toMatchObject({
      boardId,
      expectedRevision: 0n,
      scope: { case: 'whole', value: {} },
      format: BoardExportFormat.JSON,
    });

    return toBinary(
      method.output,
      create(method.output, { result: { case: 'file', value: jsonFile } }),
    );
  });

  const result = await exportBoard({ ...request, expectedRevision: 0n, format: 'json' });
  expectFile(result, jsonFile);
});

test('exposes stale and rejected outcomes without producing a file', async () => {
  const stale = createWhiteboardExportService(
    respond({ result: { case: 'stale', value: { revision: 18n } } }),
  );
  const rejected = createWhiteboardExportService(
    respond({
      result: { case: 'rejected', value: { reason: BoardExportRejectionReason.ASSET_UNAVAILABLE } },
    }),
  );

  await expect(stale(request)).resolves.toEqual({ kind: 'stale', revision: 18n });
  await expect(rejected(request)).resolves.toEqual({
    kind: 'rejected',
    reason: 'assetUnavailable',
  });
});

test.each([
  [{ ...svgFile, revision: 18n }, '版次与请求不一致'],
  [{ ...svgFile, mimeType: 'text/html' }, '格式与请求不一致'],
  [{ ...svgFile, filename: '发布白板.json' }, '格式与请求不一致'],
  [{ ...svgFile, content: new Uint8Array() }, '空文件'],
])('rejects a malformed successful download', async (file, message) => {
  const exportBoard = createWhiteboardExportService(
    respond({ result: { case: 'file', value: file } }),
  );

  await expect(exportBoard(request)).rejects.toThrow(message);
});
