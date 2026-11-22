import { expect, it } from 'vitest';
import { defaultDocument } from '../../src/contracts/document.js';
import type { BoardElement } from '../../src/contracts/studio.js';
import { whiteboardAdapter, whiteboardProduct } from '../../src/core/products/whiteboard.js';

const region: BoardElement = {
  id: 'region',
  type: 'html',
  version: 1,
  x: 0,
  y: 0,
  w: 800,
  h: 600,
  html: '',
};

it('applies the same UTF-8 byte limit to archived boards with shared elements', () => {
  const content = whiteboardProduct.create({});
  const empty = { ...content, elements: [region] };
  const limit = 8 * 1024 * 1024;
  const room = limit - Buffer.byteLength(JSON.stringify(empty));
  const html = '鹿'.repeat(Math.floor(room / 3)) + 'x'.repeat(room % 3);
  const shared = { ...region, html };
  const board = { ...content, elements: [shared] };
  const over = {
    ...board,
    style: { ...board.style, paper: board.style.paper + 'x' },
  };
  const validateArchive = whiteboardProduct.createArchiveContentValidator!();

  expect(Buffer.byteLength(JSON.stringify(board))).toBe(limit);
  expect(Buffer.byteLength(JSON.stringify(over))).toBe(limit + 1);
  expect(() => whiteboardAdapter.validate(board)).not.toThrow();
  expect(() => validateArchive(board)).not.toThrow();
  expect(() => validateArchive({ ...board, elements: [shared] })).not.toThrow();
  expect(() => whiteboardAdapter.validate(over)).toThrow(
    expect.objectContaining({ code: 'TOO_LARGE' }),
  );
  expect(() => validateArchive(over)).toThrow(expect.objectContaining({ code: 'TOO_LARGE' }));
});

it('validates a changed document with the same element ID in another archived version', () => {
  const content = whiteboardProduct.create({});
  const valid: BoardElement = {
    ...region,
    type: 'document',
    html: undefined,
    document: defaultDocument(),
  };
  const invalid = { ...valid, version: 2, html: '<p>混用的 HTML</p>' };
  const validateArchive = whiteboardProduct.createArchiveContentValidator!();

  expect(() => validateArchive({ ...content, elements: [valid] })).not.toThrow();
  expect(() => validateArchive({ ...content, elements: [invalid] })).toThrow(
    expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
  );
});
