import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'vitest';
import { planImageChanges } from '../../src/modules/whiteboard/domain/index.js';
import type { ImageOperation } from '../../src/modules/whiteboard/domain/index.js';
import { pngImage } from '../fixtures/board-image-bytes.js';

const boardId = 'images-board';
const imageId = 'picture-1';
const mimePng = 'image/png';
const mimeJpeg = 'image/jpeg';
const mimeWebp = 'image/webp';
const invalidImage = { kind: 'rejected', reason: 'invalidImage' } as const;
const invalidEdit = { kind: 'rejected', reason: 'invalidEdit' } as const;
const geometry = { x: 32, y: -16, width: 120, height: 180, rotation: 0 };
const sampleSize = { width: 2, height: 3 };

function imageBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

const cases = [
  ['PNG', mimePng, pngImage],
  [
    'progressive JPEG',
    mimeJpeg,
    imageBytes(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/9oADAMBAAIQAxAAAAGITO//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
    ),
  ],
  [
    'lossy WebP',
    mimeWebp,
    imageBytes(
      'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+4uC/8zRMcx+1f/5SrwWNzfAAAA==',
    ),
  ],
  ['lossless WebP', mimeWebp, imageBytes('UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAEAdQwAIVuKuBiOh/AAA=')],
  [
    'extended WebP with alpha',
    mimeWebp,
    imageBytes(
      'UklGRloAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAq6urq6urAFZQOCAsAAAA0AEAnQEqAgADAAFAJiWgAnS6AfgAA7AA/uLgv/M0THMftX/+Uq8Fjc3wAAA=',
    ),
  ],
] as const;

function placement(content: Uint8Array, overrides?: Partial<ImageOperation>): ImageOperation {
  return { objectId: imageId, displayName: '产品截图.png', geometry, content, ...overrides };
}

test.each(cases)('plans immutable asset storage for %s', (_name, mimeType, content) => {
  const plan = planImageChanges(boardId, placement(content));
  assert.equal(plan.kind, 'changes');

  assert.deepEqual(plan.objects, [
    {
      objectId: imageId,
      kind: 'image',
      label: '产品截图.png',
      geometry,
      geometryVersion: 0n,
      payloadVersion: 0n,
      locked: false,
    },
  ]);
  assert.deepEqual(plan.assets, [{ assetId: 'image-picture-1', mimeType, bytes: content }]);
  assert.deepEqual(plan.payloads, [
    {
      objectId: imageId,
      payloadVersion: 0n,
      bodyKind: 'image',
      data: {
        src: '/studio-archive-assets/images-board/image-picture-1',
        naturalSize: sampleSize,
      },
    },
  ]);
});

test.each(cases)('rejects truncated %s', (_name, _mimeType, content) => {
  const truncated = content.subarray(0, -1);

  assert.deepEqual(planImageChanges(boardId, placement(truncated)), invalidImage);
});

test('keeps file content scoped to the supplied byte view', () => {
  const file = new Uint8Array(pngImage.length + 3);
  file.set(pngImage, 1);
  const sample = file.subarray(1, file.length - 2);

  assert.equal(planImageChanges(boardId, placement(sample)).kind, 'changes');
});

test('rejects non-image data and invalid image dimensions', () => {
  const text = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.deepEqual(planImageChanges(boardId, placement(text)), invalidImage);

  const large = new Uint8Array(pngImage);
  const view = new DataView(large.buffer);
  view.setUint32(16, 8_192);
  view.setUint32(20, 8_192);
  assert.deepEqual(planImageChanges(boardId, placement(large)), invalidImage);

  view.setUint32(16, 16_385);
  view.setUint32(20, 1);
  assert.deepEqual(planImageChanges(boardId, placement(large)), invalidImage);
});

test('rejects animated WebP and mismatched canvas sizes', () => {
  const extended = imageBytes(
    'UklGRloAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAq6urq6urAFZQOCAsAAAA0AEAnQEqAgADAAFAJiWgAnS6AfgAA7AA/uLgv/M0THMftX/+Uq8Fjc3wAAA=',
  );
  const animationFlag = 2;
  const flagsOffset = 20;
  extended[flagsOffset] = animationFlag;
  assert.deepEqual(planImageChanges(boardId, placement(extended)), invalidImage);

  extended[flagsOffset] = 16;
  extended[24] = 2;
  assert.deepEqual(planImageChanges(boardId, placement(extended)), invalidImage);
});

test('limits file bytes before trying to interpret the format', () => {
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);

  assert.deepEqual(planImageChanges(boardId, placement(oversized)), {
    kind: 'rejected',
    reason: 'tooLarge',
  });
});

test('rejects unstable IDs, path labels and invalid placement geometry', () => {
  assert.deepEqual(planImageChanges('../outside', placement(pngImage)), invalidEdit);
  assert.deepEqual(
    planImageChanges(boardId, placement(pngImage, { objectId: '../outside' })),
    invalidEdit,
  );
  assert.deepEqual(
    planImageChanges(boardId, placement(pngImage, { displayName: 'C:/private/picture.png' })),
    invalidEdit,
  );
  assert.deepEqual(
    planImageChanges(boardId, placement(pngImage, { geometry: { ...geometry, width: 0 } })),
    invalidEdit,
  );
  assert.deepEqual(
    planImageChanges(boardId, placement(pngImage, { geometry: { ...geometry, x: Infinity } })),
    invalidEdit,
  );
});
