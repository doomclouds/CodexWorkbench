import { expect, test } from 'vitest';
import { resolveArchiveAssetUrl } from '../../src/platform/browser/index.js';

test('resolves the exact authorized archive asset path on the application origin', () => {
  const path = '/studio-archive-assets/board-id/asset-id';

  expect(resolveArchiveAssetUrl(path)).toBe(new URL(path, window.location.origin).href);
});

test.each([
  '/assets/docs/manual',
  '/studio-archive-assets/board-id/asset-id?download=1',
  '/studio-archive-assets/board-id/../settings',
  '//example.test/studio-archive-assets/board-id/asset-id',
])('leaves other references alone for the document renderer to validate', (source) => {
  expect(resolveArchiveAssetUrl(source)).toBe(source);
});
