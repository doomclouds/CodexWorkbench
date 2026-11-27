import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { expect, test } from 'vitest';

import { createBoardCatalogService } from '../../src/data/catalog/index.js';

const thumbnailMethod = BoardCatalogService.method.getBoardThumbnail;
const catalogMethod = BoardCatalogService.method.listBoards;
const boardId = 'board';
const revision = 7n;
const mimeType = 'image/svg+xml';
const content = new TextEncoder().encode('<svg/>');
const thumbnailRequest = { boardId, revision, trashed: true };

test('forwards the pinned filter and reads the authoritative preview revision', async () => {
  const service = createBoardCatalogService(async (path, bytes) => {
    expect(path).toBe('/' + catalogMethod.parent.typeName + '/' + catalogMethod.name);
    expect(fromBinary(catalogMethod.input, bytes)).toMatchObject({
      pinnedOnly: true,
      query: '交付',
      cursor: 'after',
      pageSize: 30,
    });
    const response = create(catalogMethod.output, {
      boards: [
        { boardId, title: '交付白板', pinned: true, entryVersion: 1n, previewRevision: revision },
      ],
    });

    return toBinary(catalogMethod.output, response);
  });
  const list = await service.listBoards({
    query: '交付',
    order: 'recent',
    pinnedOnly: true,
    pageSize: 30,
    cursor: 'after',
  });

  expect(list.boards[0]).toMatchObject({ boardId, previewRevision: revision });
});

function serveThumbnail(value: MessageInitShape<typeof thumbnailMethod.output>) {
  return createBoardCatalogService(async (path, bytes, signal) => {
    expect(path).toBe('/' + thumbnailMethod.parent.typeName + '/' + thumbnailMethod.name);
    expect(fromBinary(thumbnailMethod.input, bytes)).toMatchObject(thumbnailRequest);
    signal?.throwIfAborted();

    return toBinary(thumbnailMethod.output, create(thumbnailMethod.output, value));
  });
}

test('renders a safe image URL for an exact trash preview request', async () => {
  const service = serveThumbnail({ thumbnail: { content, mimeType, revision } });
  await expect(service.getBoardThumbnail(thumbnailRequest)).resolves.toBe(
    'data:image/svg+xml;base64,PHN2Zy8+',
  );
});

test('leaves the placeholder for stale or missing previews', async () => {
  const stale = serveThumbnail({ thumbnail: { content, mimeType, revision: revision - 1n } });
  const missing = serveThumbnail({});
  await expect(stale.getBoardThumbnail(thumbnailRequest)).resolves.toBeUndefined();
  await expect(missing.getBoardThumbnail(thumbnailRequest)).resolves.toBeUndefined();
});

test('rejects invalid thumbnail media and size', async () => {
  const wrongMedia = serveThumbnail({ thumbnail: { content, mimeType: 'text/html', revision } });
  const tooLarge = serveThumbnail({
    thumbnail: { content: new Uint8Array(128 * 1024 + 1), mimeType, revision },
  });
  await expect(wrongMedia.getBoardThumbnail(thumbnailRequest)).rejects.toThrow('缩略图');
  await expect(tooLarge.getBoardThumbnail(thumbnailRequest)).rejects.toThrow('缩略图');
});
