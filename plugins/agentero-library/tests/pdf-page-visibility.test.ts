import { expect, test } from 'vitest';
import { latestPageIntersection, pageIsNearViewport } from '../src/app/pdf/page-visibility';

test('a batched old-outside then new-visible observation keeps the newest state', () => {
  const target = {}; const entries = [{ target, time: 10, isIntersecting: false }, { target, time: 20, isIntersecting: true }];
  expect(latestPageIntersection(entries, target)?.isIntersecting).toBe(true);
});
test('observations older than the accepted visible state or for a disconnected target are ignored', () => {
  const target = {};
  expect(latestPageIntersection([{ target, time: 5, isIntersecting: false }], target, 20)).toBeNull();
  expect(latestPageIntersection([{ target: {}, time: 30, isIntersecting: false }], target, 20)).toBeNull();
});
test('the reported visible 300-percent last page is retained despite an old outside snapshot', () => {
  const page = { left: 56, top: 55, right: 56 + 1836, bottom: 55 + 2376 };
  const viewport = { left: 48, top: 40, right: 48 + 1232, bottom: 40 + 680 };
  expect(pageIsNearViewport(page, viewport)).toBe(true);
});
test('offscreen and hidden pages still leave the bounded prefetch window', () => {
  const viewport = { left: 0, top: 0, right: 500, bottom: 700 };
  expect(pageIsNearViewport({ left: 0, top: 1690, right: 500, bottom: 2200 }, viewport)).toBe(true);
  expect(pageIsNearViewport({ left: 0, top: 1701, right: 500, bottom: 2200 }, viewport)).toBe(false);
  expect(pageIsNearViewport({ left: 0, top: -1600, right: 500, bottom: -1001 }, viewport)).toBe(false);
  expect(pageIsNearViewport({ left: 0, top: 0, right: 500, bottom: 700 }, { left: 0, top: 0, right: 0, bottom: 0 })).toBe(false);
});
