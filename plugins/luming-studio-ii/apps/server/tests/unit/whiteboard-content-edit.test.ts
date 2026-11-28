import { expect, test } from 'vitest';
import {
  editDocumentContent,
  editEmbedSource,
  editTextContent,
  editTodoContent,
  type JsonObject,
  type TodoContentEdit,
} from '../../src/modules/whiteboard/domain/index.js';

test('permits unrelated edits or removal of a legacy inline resource without adding copies', () => {
  const image = '<img src="data:image/svg+xml,%3Csvg%2F%3E">';
  const current = {
    objectId: 'legacy-diagram',
    payloadVersion: 2n,
    bodyKind: 'embed',
    data: { html: '<p>Old text</p>' + image, title: 'Legacy diagram', sourceRevision: '1' },
  };
  const edit = (html: string) =>
    editEmbedSource(current, {
      kind: 'embedSource',
      objectId: current.objectId,
      expectedPayloadVersion: 2n,
      expectedSourceRevision: 1n,
      title: 'Legacy diagram',
      html,
    });

  expect(edit('<p>New text</p>' + image)).toMatchObject({
    kind: 'updated',
    data: { html: '<p>New text</p>' + image, sourceRevision: '2' },
  });
  expect(edit('<p>New text</p>')).toMatchObject({ kind: 'updated' });
  expect(edit(image + image)).toEqual({ kind: 'rejected', reason: 'inlineHtmlResource' });
  expect(edit(image.replace('%3Csvg%2F%3E', '%3Csvg%3E'))).toEqual({
    kind: 'rejected',
    reason: 'inlineHtmlResource',
  });
});

const boardId = 'content-board';
const assetId = 'asset-1';
const assetPath = '/studio-archive-assets/content-board/asset-1';
const remoteImage = 'https://example.test:8443/archived.png';
const assets = { boardId, hasAsset: (id: string) => id === assetId };

function imageBlock(source: string): JsonObject {
  return {
    blockId: 'image-1',
    type: 'image',
    props: { url: source },
  };
}

function documentBody(...blocks: JsonObject[]): JsonObject {
  return { title: ' Revised document ', schemaVersion: 1, blocks };
}

test('preserves document block identity and validates linked images within the board', () => {
  const child = imageBlock(assetPath);
  const oldImage = { ...imageBlock(remoteImage), blockId: 'image-2' };
  const heading = { blockId: 'heading-1', type: 'heading', content: 'Details', children: [child] };
  const current = documentBody(oldImage);
  const next = documentBody(heading, oldImage);

  expect(editDocumentContent(next, current, assets)).toEqual({
    kind: 'updated',
    label: 'Revised document',
    data: { ...next, title: 'Revised document' },
  });
});

test('rejects foreign, missing, new remote and absolute loopback image paths', () => {
  const invalid = [
    '/studio-archive-assets/other-board/asset-1',
    '/studio-archive-assets/content-board/missing-asset',
    'http://127.0.0.1:4329/studio-archive-assets/content-board/asset-1',
    remoteImage,
  ];

  for (const source of invalid) {
    expect(editDocumentContent(documentBody(imageBlock(source)), {}, assets)).toEqual({
      kind: 'rejected',
      reason: 'invalidEdit',
    });
  }
});

test('rejects duplicate block IDs and unbounded document trees', () => {
  const paragraph = { blockId: 'paragraph-1', type: 'paragraph', content: 'Body' };
  expect(editDocumentContent(documentBody(paragraph, paragraph), {}, assets)).toEqual({
    kind: 'rejected',
    reason: 'invalidEdit',
  });

  let subtree: JsonObject = paragraph;
  for (let index = 0; index < 65; index++) {
    subtree = { blockId: 'block-' + index, type: 'paragraph', children: [subtree] };
  }

  expect(editDocumentContent(documentBody(subtree), {}, assets)).toEqual({
    kind: 'rejected',
    reason: 'tooLarge',
  });
});

const first = {
  itemId: 'task-1',
  text: 'Initial task',
  checked: true,
  sourceRef: { objectId: 'source-1', blockId: 'paragraph-1' },
};
const second = { itemId: 'task-2', text: 'Ready to review', checked: false };
const list: JsonObject = { title: 'Tasks', items: [first, second] };

test('applies typed row operations in order while preserving and clearing sources explicitly', () => {
  const next = { itemId: 'task-3', text: 'Follow up', checked: false };
  const edits: TodoContentEdit[] = [
    { kind: 'rename', title: ' Daily review ' },
    { kind: 'insert', item: next, placement: { kind: 'after', itemId: first.itemId } },
    { kind: 'move', itemId: second.itemId, placement: { kind: 'first' } },
    { kind: 'update', itemId: first.itemId, checked: false },
  ];

  expect(editTodoContent(list, edits, () => false)).toEqual({
    kind: 'updated',
    label: 'Daily review',
    data: { title: 'Daily review', items: [second, { ...first, checked: false }, next] },
  });

  const unsetSource: TodoContentEdit = { kind: 'update', itemId: first.itemId, sourceRef: null };
  expect(editTodoContent(list, [unsetSource], () => false)).toEqual({
    kind: 'updated',
    label: 'Tasks',
    data: {
      title: 'Tasks',
      items: [{ itemId: first.itemId, text: first.text, checked: true }, second],
    },
  });
});

test('rejects unstable todo positions and references without altering input', () => {
  const edits: TodoContentEdit[] = [
    { kind: 'delete', itemId: first.itemId },
    { kind: 'insert', item: first, placement: { kind: 'append' } },
  ];
  expect(editTodoContent(list, edits, () => true)).toEqual({
    kind: 'rejected',
    reason: 'invalidEdit',
  });

  const badReference: TodoContentEdit = {
    kind: 'update',
    itemId: first.itemId,
    sourceRef: { boardId: 'foreign-board', objectId: 'another-object' },
  };
  expect(editTodoContent(list, [badReference], () => false)).toEqual({
    kind: 'rejected',
    reason: 'invalidEdit',
  });
  expect(list.items).toEqual([first, second]);
});

test('supports empty text and preserves omitted style fields', () => {
  const current = {
    text: 'Before',
    color: '#2d3142',
    fontFamily: 'Arial',
    fontSize: 24,
    align: 'TEXT_ALIGNMENT_CENTER',
  };

  expect(editTextContent({ text: '', align: 'TEXT_ALIGNMENT_UNSPECIFIED' }, current)).toEqual({
    kind: 'updated',
    label: '',
    data: { ...current, text: '' },
  });
  expect(editTextContent({ text: 'After', fontSize: 0 }, current)).toEqual({
    kind: 'rejected',
    reason: 'invalidEdit',
  });
});
