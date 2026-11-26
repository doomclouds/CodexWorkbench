import { create, fromBinary, fromJson, toBinary } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import { WhiteboardService as wireService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  createWhiteboardService,
  type WhiteboardPost,
  type WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { resolveArchiveAssetUrl } from '../../src/platform/browser/index.js';

const { getObjectPayloads } = wireService.method;
const boardId = 'imported-board';
const documentId = 'document';
const coverPath = '/studio-archive-assets/imported-board/cover';
const nestedPath = '/studio-archive-assets/imported-board/detail';
const externalUrl = 'https://example.test/image.png';
const ordinaryPath = '/assets/docs/manual';
const inlineImage = 'data:image/png;base64,iVBORw0KGgo=';

function image(blockId: string, url: string) {
  return { blockId, type: 'image', props: { url, caption: '文档图片' } };
}

const postDocument: WhiteboardPost = async (path, body) => {
  expect(path).toBe('/' + wireService.typeName + '/' + getObjectPayloads.name);
  expect(fromBinary(getObjectPayloads.input, body)).toMatchObject({
    boardId,
    objectIds: [documentId],
  });

  const document = {
    title: '归档文档',
    schemaVersion: 1,
    blocks: [
      image('cover', coverPath),
      {
        blockId: 'paragraph',
        type: 'paragraph',
        props: { url: coverPath },
        content: fromJson(ValueSchema, coverPath),
        children: [
          image('nested', nestedPath),
          image('external', externalUrl),
          image('ordinary', ordinaryPath),
          image('inline', inlineImage),
        ],
      },
    ],
  };

  return toBinary(
    getObjectPayloads.output,
    create(getObjectPayloads.output, {
      boardId,
      results: [
        {
          objectId: documentId,
          result: {
            case: 'payload',
            value: {
              payloadVersion: 1n,
              body: { case: 'document', value: document },
            },
          },
        },
      ],
    }),
  );
};

async function readDocument(service: WhiteboardService) {
  const [result] = await service.getPayloads(boardId, [documentId]);
  if (result?.kind !== 'loaded' || result.payload.body.kind !== 'document') {
    throw new Error('Expected the imported document payload.');
  }

  return result.payload.body.value.document;
}

test('resolves archived image URLs in top-level and nested document blocks', async () => {
  const service = createWhiteboardService(postDocument, resolveArchiveAssetUrl);

  expect(await readDocument(service)).toMatchObject({
    blocks: [
      { id: 'cover', props: { url: new URL(coverPath, window.location.origin).href } },
      {
        id: 'paragraph',
        props: { url: coverPath },
        content: coverPath,
        children: [
          { id: 'nested', props: { url: new URL(nestedPath, window.location.origin).href } },
          { id: 'external', props: { url: externalUrl } },
          { id: 'ordinary', props: { url: ordinaryPath } },
          { id: 'inline', props: { url: inlineImage } },
        ],
      },
    ],
  });
});

test('preserves archived image paths in a service without a URL resolver', async () => {
  const service = createWhiteboardService(postDocument);

  expect(await readDocument(service)).toMatchObject({
    blocks: [
      { id: 'cover', props: { url: coverPath } },
      {
        id: 'paragraph',
        children: [
          { id: 'nested', props: { url: nestedPath } },
          { id: 'external', props: { url: externalUrl } },
          { id: 'ordinary', props: { url: ordinaryPath } },
          { id: 'inline', props: { url: inlineImage } },
        ],
      },
    ],
  });
});
