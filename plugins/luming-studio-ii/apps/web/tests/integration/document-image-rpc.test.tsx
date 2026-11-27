import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { expect, test } from 'vitest';
import { createWhiteboardEditService } from '../../src/data/whiteboard/index.js';

const method = BoardEditService.method.uploadBoardDocumentImage;
const command = {
  boardId: 'document-image-board',
  commandId: 'upload-image',
  objectId: 'document',
  content: new Uint8Array([1, 2, 3]),
};
const assetId = 'document-image-' + 'a'.repeat(64);
const source = '/studio-archive-assets/' + command.boardId + '/' + assetId;

function client(assetUrl: string) {
  const service = createWhiteboardEditService(async (path, bytes) => {
    expect(path).toBe('/luming.studio.v1.BoardEditService/UploadBoardDocumentImage');
    expect(fromBinary(method.input, bytes)).toMatchObject(command);

    return toBinary(
      method.output,
      create(method.output, {
        receipt: {
          boardId: command.boardId,
          commandId: command.commandId,
          outcome: { case: 'applied', value: { boardRevision: 7n } },
        },
        assetUrl,
      }),
    );
  });

  return (input: typeof command) => {
    if (!service.uploadDocumentImage) {
      throw new Error('The data client must expose document image upload.');
    }

    return service.uploadDocumentImage(input);
  };
}

test('preserves the durable upload URL and an asset-only receipt', async () => {
  const upload = client(source);
  await expect(upload(command)).resolves.toMatchObject({
    assetUrl: source,
    receipt: { kind: 'applied', revision: 7n, objects: [], payloads: [] },
  });
});

test('rejects image URLs from another board before returning to the document editor', async () => {
  const upload = client('/studio-archive-assets/other-board/' + assetId);
  await expect(upload(command)).rejects.toThrow('board-scoped asset URL');
});
