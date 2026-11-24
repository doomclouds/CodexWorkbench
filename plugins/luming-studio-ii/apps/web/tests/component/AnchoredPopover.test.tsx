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
