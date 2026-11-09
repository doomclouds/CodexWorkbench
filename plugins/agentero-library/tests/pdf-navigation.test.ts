import { expect, test } from 'vitest';
import { PageAnchorCoordinator, pageAtOffset, pageSlots, type PageSize } from '../src/app/pdf/virtualization';

const portrait = { width: 612, height: 792 }; const landscape = { width: 792, height: 612 };
const positions = (sizes = new Map<number, PageSize>()) => pageSlots(400, sizes, portrait, 0, 3, undefined, 226);

test('a cold jump to page 400 supersedes a queued page-1 layout anchor', () => {
  const anchor = new PageAnchorCoordinator(); const old = anchor.remember(1, 0);
  const jump = anchor.navigate(400); const before = positions();
  anchor.settle(old.sequence); expect(anchor.pending?.page).toBe(400);
  // Lazy page 399 is landscape; discovering it changes the entire following prefix.
  const after = positions(new Map([[399, landscape]]));
  anchor.remember(1, 0); expect(anchor.pending).toEqual(jump);
  const top = after[jump.page - 1].top + after[jump.page - 1].height * jump.ratio;
  expect(top).toBeLessThan(before[399].top); expect(pageAtOffset(after, top + 150)).toBe(399);
  anchor.settle(jump.sequence); expect(anchor.pending).toBeNull();
});

test('repeated explicit jumps remain authoritative while mixed page sizes arrive out of order', () => {
  const anchor = new PageAnchorCoordinator(); const sizes = new Map<number, PageSize>();
  let previous = anchor.remember(1, .25);
  for (const goal of [400, 1, 400, 7, 399, 400]) {
    const requested = anchor.navigate(goal);
    for (const page of [goal - 1, goal + 1, goal]) if (page >= 1 && page <= 400) sizes.set(page, page % 7 === 0 ? landscape : portrait);
    anchor.remember(previous.page, previous.ratio); anchor.settle(previous.sequence);
    expect(anchor.pending?.sequence).toBe(requested.sequence);
    const slots = positions(sizes); const top = slots[goal - 1].top + slots[goal - 1].height * requested.ratio;
    expect(pageAtOffset(slots, top + 150) + 1).toBe(goal);
    anchor.settle(requested.sequence); previous = requested;
  }
});

test('layout preservation after navigation uses the current page and relative position', () => {
  const anchor = new PageAnchorCoordinator(); const requested = anchor.navigate(400); anchor.settle(requested.sequence);
  const position = anchor.remember(400, .6); const sizes = new Map([[399, landscape]]);
  const zoomed = pageSlots(400, sizes, portrait, 90, 1.5, undefined, 226);
  const top = zoomed[position.page - 1].top + zoomed[position.page - 1].height * position.ratio;
  expect(pageAtOffset(zoomed, top) + 1).toBe(400); expect(position.ratio).toBe(.6);
});

test('an old document animation cannot consume a new document restoration intent', () => {
  const anchor = new PageAnchorCoordinator(); const old = anchor.navigate(1);
  anchor.clear(); const restored = anchor.navigate(400, .2); anchor.settle(old.sequence);
  expect(anchor.pending).toEqual(restored);
});
