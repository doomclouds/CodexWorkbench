import { act } from 'react';
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest';

import { Tooltip } from '../../src/ui/base/index.js';
import type { TooltipPlacement, TooltipProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;
let anchor: HTMLButtonElement;
let otherAnchor: HTMLButtonElement;

function findTooltip(target: Element) {
  const ids = target.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  const tooltip = ids
    .map((id) => document.getElementById(id))
    .find((element) => element?.getAttribute('role') === 'tooltip');

  if (!tooltip) {
    throw new Error('Expected the trigger to describe a tooltip.');
  }

  return tooltip;
}

function movePointer(
  element: Element,
  action: 'pointerenter' | 'pointerleave',
  relatedTarget: EventTarget | null = null,
  pointerType = 'mouse',
) {
  act(() => {
    element.dispatchEvent(new PointerEvent(action, { relatedTarget, pointerType }));
  });
}

function advanceDelay(time: number) {
  act(() => {
    vi.advanceTimersByTime(time);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fixture = createControlFixture();
  anchor = document.createElement('button');
  anchor.setAttribute('aria-label', 'Project settings');
  otherAnchor = document.createElement('button');
  document.body.append(anchor, otherAnchor);
});

afterEach(() => {
  fixture.dispose();
  anchor.remove();
  otherAnchor.remove();
  vi.useRealTimers();
});

it('adds a stable description while preserving the independent trigger name and other IDs', () => {
  expectTypeOf<TooltipProps>().not.toHaveProperty('ref');
  expectTypeOf<TooltipPlacement>().toEqualTypeOf<'top' | 'bottom' | 'left' | 'right'>();
  anchor.setAttribute('aria-describedby', 'existing-help');
  fixture.render(<Tooltip anchor={anchor} text="Change the project settings." />);
  const tooltip = findTooltip(anchor);

  expect(tooltip.hidden).toBe(true);
  expect(tooltip.textContent).toBe('Change the project settings.');
  expect(anchor.getAttribute('aria-label')).toBe('Project settings');
  expect(anchor.getAttribute('aria-describedby')).toBe('existing-help ' + tooltip.id);
  fixture.render(<Tooltip anchor={anchor} text="Change the project settings." />);
  expect(findTooltip(anchor)).toBe(tooltip);

  anchor.setAttribute('aria-describedby', 'existing-help ' + tooltip.id + ' later-help');
  fixture.render(null);
  expect(anchor.getAttribute('aria-describedby')).toBe('existing-help later-help');
  expect(document.getElementById(tooltip.id)).toBeNull();
});

it('shows after the pointer delay and remains visible over the tooltip text', () => {
  fixture.render(<Tooltip anchor={anchor} text="Help" delay={60} />);
  const tooltip = findTooltip(anchor);
  movePointer(anchor, 'pointerenter', null, 'touch');
  advanceDelay(60);
  expect(tooltip.hidden).toBe(true);

  movePointer(anchor, 'pointerenter');
  advanceDelay(59);
  expect(tooltip.hidden).toBe(true);
  advanceDelay(1);
  expect(tooltip.hidden).toBe(false);

  movePointer(anchor, 'pointerleave', tooltip);
  movePointer(tooltip, 'pointerenter', anchor);
  expect(tooltip.hidden).toBe(false);
  movePointer(tooltip, 'pointerleave');
  expect(tooltip.hidden).toBe(true);
});

it('supports keyboard focus, Escape and blur while keeping focus on the trigger', () => {
  fixture.render(<Tooltip anchor={anchor} text="Help" delay={30} />);
  const tooltip = findTooltip(anchor);
  act(() => anchor.focus());
  expect(tooltip.hidden).toBe(true);
  advanceDelay(30);
  expect(tooltip.hidden).toBe(false);
  expect(document.activeElement).toBe(anchor);

  act(() => {
    anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(tooltip.hidden).toBe(true);
  expect(document.activeElement).toBe(anchor);
  advanceDelay(30);
  expect(tooltip.hidden).toBe(true);

  act(() => otherAnchor.focus());
  act(() => anchor.focus());
  advanceDelay(30);
  expect(tooltip.hidden).toBe(false);
  act(() => otherAnchor.focus());
  expect(tooltip.hidden).toBe(true);
});

it('keeps a pending and then visible tooltip stable over ordinary renders', () => {
  fixture.render(<Tooltip anchor={anchor} text="Initial help" delay={60} />);
  const tooltip = findTooltip(anchor);
  movePointer(anchor, 'pointerenter');
  advanceDelay(45);
  fixture.render(<Tooltip anchor={anchor} text="Updated help" delay={60} placement="right" />);
  expect(tooltip.hidden).toBe(true);

  advanceDelay(15);
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.textContent).toBe('Updated help');
  fixture.render(<Tooltip anchor={anchor} text="Final help" delay={90} placement="right" />);
  expect(findTooltip(anchor)).toBe(tooltip);
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.textContent).toBe('Final help');
});

it('clears pending visibility and descriptions when the anchor changes or unmounts', () => {
  fixture.render(<Tooltip anchor={anchor} text="First help" delay={50} />);
  movePointer(anchor, 'pointerenter');
  advanceDelay(25);

  fixture.render(<Tooltip anchor={otherAnchor} text="Second help" delay={50} />);
  const tooltip = findTooltip(otherAnchor);
  expect(anchor.getAttribute('aria-describedby')).toBeNull();
  advanceDelay(50);
  expect(tooltip.hidden).toBe(true);

  movePointer(otherAnchor, 'pointerenter');
  fixture.render(null);
  advanceDelay(50);
  expect(otherAnchor.getAttribute('aria-describedby')).toBeNull();
  expect(document.getElementById(tooltip.id)).toBeNull();
});
