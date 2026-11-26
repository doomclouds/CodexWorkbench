import { act } from 'react';
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest';

import { AnchoredPopover } from '../../src/ui/base/index.js';
import type {
  AnchoredPopoverCloseReason,
  AnchoredPopoverPlacement,
  AnchoredPopoverProps,
} from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;
let anchor: HTMLButtonElement;
let anchors: HTMLDivElement;

beforeEach(() => {
  fixture = createControlFixture();
  anchors = document.createElement('div');
  anchor = document.createElement('button');
  anchor.textContent = 'Open details';
  anchors.append(anchor);
  document.body.append(anchors);

  const bounds = new DOMRect(80, 60, 80, 32);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(bounds);
  vi.spyOn(anchor, 'getClientRects').mockReturnValue(
    Object.assign([bounds], { item: (index: number) => (index === 0 ? bounds : null) }),
  );
});

afterEach(() => {
  fixture.dispose();
  anchors.remove();
  vi.restoreAllMocks();
});

function renderPopover(props: Partial<AnchoredPopoverProps> = {}) {
  const onRequestClose = vi.fn<(reason: AnchoredPopoverCloseReason) => void>();
  fixture.render(
    <AnchoredPopover
      open
      anchor={anchor}
      label="Board details"
      onRequestClose={onRequestClose}
      {...props}
    >
      <input aria-label="Board name" />
    </AnchoredPopover>,
  );

  return onRequestClose;
}

function findPopover(container: ParentNode = fixture.host) {
  return container.querySelector<HTMLDivElement>('[role="dialog"]');
}

function focusBoardName() {
  fixture.host.querySelector('input')?.focus();
}

function focusAnchor() {
  anchor.focus();
}

function pressOutside() {
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
}

function pressEscape() {
  act(() => {
    findPopover()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

function mockPlacement(bounds: DOMRect, width = 480, height = 220) {
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(bounds);
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width, height),
  );
}

const anchorOffset = '--studio-ui-anchor-offset';

it('keeps the arrow centered on the anchor when the popover needs no horizontal clamp', () => {
  mockPlacement(new DOMRect(420, 12, 36, 32));
  renderPopover({ placement: 'bottom' });
  const layer = findPopover();

  expect(layer?.dataset.placement).toBe('bottom');
  expect(layer?.style.left).toBe('198px');
  expect(layer?.style.top).toBe('52px');
  expect(layer?.style.getPropertyValue(anchorOffset)).toBe('240px');
});

it('supports only end alignment as the optional public override', () => {
  expectTypeOf<AnchoredPopoverProps['align']>().toEqualTypeOf<'end' | undefined>();
  expectTypeOf<{ align: 'center' }>().not.toExtend<Pick<AnchoredPopoverProps, 'align'>>();
});

it('aligns the end of an element popover and keeps the offset on its anchor', () => {
  mockPlacement(new DOMRect(586, 12, 36, 32));
  renderPopover({ align: 'end' });
  const layer = findPopover();

  expect(layer?.dataset.placement).toBe('bottom');
  expect(layer?.style.left).toBe('142px');
  expect(layer?.style.top).toBe('52px');
  expect(layer?.style.getPropertyValue(anchorOffset)).toBe('462px');
});

it('clamps end alignment to the viewport and leaves side placements unchanged', () => {
  mockPlacement(new DOMRect(45, 56, 36, 32));
  renderPopover({ placement: 'bottom', align: 'end' });
  const layer = findPopover();
  expect(layer?.style.left).toBe('8px');
  expect(layer?.style.getPropertyValue(anchorOffset)).toBe('55px');

  renderPopover({ placement: 'right', align: 'end' });
  expect(layer?.dataset.placement).toBe('right');
  expect(layer?.style.left).toBe('89px');
  expect(layer?.style.getPropertyValue(anchorOffset)).toBe('');
});

it.each([
  { edge: 'left', left: () => 0, expectedLeft: () => 8, offset: '16px' },
  {
    edge: 'right',
    left: () => window.innerWidth - 24,
    expectedLeft: () => window.innerWidth - 488,
    offset: '464px',
  },
])(
  'keeps the arrow inside the rounded $edge edge of a clamped popover',
  ({ left, expectedLeft, offset }) => {
    mockPlacement(new DOMRect(left(), 12, 36, 32));
    renderPopover({ placement: 'bottom' });
    const layer = findPopover();

    expect(layer?.style.left).toBe(expectedLeft() + 'px');
    expect(layer?.style.getPropertyValue(anchorOffset)).toBe(offset);
  },
);

it('keeps the arrow with the top fallback and clears its offset for a side placement', () => {
  const anchorTop = window.innerHeight - 38;
  mockPlacement(new DOMRect(420, anchorTop, 36, 20));
  renderPopover({ placement: 'bottom' });
  const layer = findPopover();

  expect(layer?.dataset.placement).toBe('top');
  expect(layer?.style.top).toBe(anchorTop - 228 + 'px');
  expect(layer?.style.getPropertyValue(anchorOffset)).toBe('240px');

  renderPopover({ placement: 'right' });
  expect(findPopover()).toBe(layer);
  expect(layer?.dataset.placement).toBe('right');
  expect(layer?.style.left).toBe('464px');
  expect(layer?.style.getPropertyValue(anchorOffset)).toBe('');
});

it('keeps Escape with the newer layer after the earlier layer is repositioned', () => {
  const closeEarlier = vi.fn();
  const closeLater = vi.fn();

  function renderLayers(placement: AnchoredPopoverPlacement, laterOpen: boolean) {
    fixture.render(
      <>
        <AnchoredPopover
          open
          anchor={anchor}
          placement={placement}
          label="Earlier"
          onRequestClose={closeEarlier}
        >
          Earlier content
        </AnchoredPopover>
        <AnchoredPopover open={laterOpen} anchor={anchor} label="Later" onRequestClose={closeLater}>
          Later content
        </AnchoredPopover>
      </>,
    );
  }

  renderLayers('bottom', false);
  renderLayers('bottom', true);
  renderLayers('top', true);
  pressEscape();

  expect(closeLater).toHaveBeenCalledExactlyOnceWith('escape');
  expect(closeEarlier).not.toHaveBeenCalled();
});

it('renders a named non-modal layer inline and leaves open state controlled', () => {
  expectTypeOf<AnchoredPopoverProps>().not.toHaveProperty('ref');
  expectTypeOf<AnchoredPopoverPlacement>().toEqualTypeOf<'top' | 'bottom' | 'left' | 'right'>();

  const onRequestClose = renderPopover();
  const layer = findPopover();
  expect(layer?.getAttribute('role')).toBe('dialog');
  expect(layer?.getAttribute('aria-label')).toBe('Board details');
  expect(layer?.hasAttribute('aria-modal')).toBe(false);

  pressOutside();
  expect(onRequestClose.mock.calls).toEqual([['outside-press']]);
  expect(findPopover()).toBe(layer);

  renderPopover({ open: false });
  expect(findPopover()).toBeNull();
});

it('suppresses outside presses only when persistent', () => {
  const onRequestClose = renderPopover({ persistent: true });
  pressOutside();
  expect(onRequestClose).not.toHaveBeenCalled();

  pressEscape();
  expect(onRequestClose.mock.calls).toEqual([['escape']]);
});

it('requests dismissal when a persistent popover loses its anchor', () => {
  const onRequestClose = renderPopover({ persistent: true });
  renderPopover({ anchor: null, persistent: true, onRequestClose });

  expect(onRequestClose.mock.calls).toEqual([['anchor-hidden']]);
});

it('hands off focus only on actual open and close transitions', () => {
  const initialFocus = vi.fn(focusBoardName);
  const restoreFocus = vi.fn(focusAnchor);
  const onRequestClose = renderPopover({ initialFocus, restoreFocus });
  expect(initialFocus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(fixture.host.querySelector('input'));

  pressEscape();
  expect(onRequestClose.mock.calls).toEqual([['escape']]);
  expect(restoreFocus).not.toHaveBeenCalled();

  const nextInitialFocus = vi.fn();
  renderPopover({ initialFocus: nextInitialFocus, restoreFocus });
  expect(nextInitialFocus).not.toHaveBeenCalled();
  expect(restoreFocus).not.toHaveBeenCalled();

  renderPopover({ open: false, restoreFocus });
  expect(restoreFocus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(anchor);
});

it('uses an explicit portal root without escaping the anchor dialog', () => {
  const dialog = document.createElement('dialog');
  const inside = document.createElement('div');
  const outside = document.createElement('div');
  dialog.open = true;
  dialog.append(anchor, inside);
  anchors.append(dialog, outside);

  renderPopover({ portalRoot: inside });
  expect(findPopover(inside)?.style.visibility).toBe('visible');
  expect(findPopover()).toBeNull();

  renderPopover({ portalRoot: outside });
  expect(findPopover(dialog)?.style.visibility).toBe('visible');
  expect(findPopover(outside)).toBeNull();
});
