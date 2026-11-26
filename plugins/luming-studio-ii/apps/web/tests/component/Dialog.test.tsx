import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest';
import { Dialog } from '../../src/ui/base/index.js';
import type { DialogCloseReason, DialogProps } from '../../src/ui/base/index.js';

let host: HTMLDivElement;
let root: Root;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function close(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: close, configurable: true },
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function renderDialog(props: Partial<DialogProps> = {}) {
  const onRequestClose = vi.fn<(reason: DialogCloseReason) => void>();
  act(() => {
    root.render(
      <Dialog
        open
        title="Rename"
        description="Enter a new board name."
        closeLabel="Close"
        onRequestClose={onRequestClose}
        {...props}
      >
        <input aria-label="Board name" />
      </Dialog>,
    );
  });

  const dialog = host.querySelector('dialog');
  if (!dialog) {
    throw new Error('Expected the public Dialog to render a dialog element.');
  }

  return { dialog, onRequestClose };
}

function dispatchCancel(dialog: HTMLDialogElement) {
  const event = new Event('cancel', { cancelable: true });
  act(() => {
    dialog.dispatchEvent(event);
  });

  return event;
}

function dispatchBackdropPointerEvents(dialog: HTMLDialogElement) {
  act(() => {
    dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dialog.click();
  });
}

it('presents the public name and description without an imperative DOM ref', () => {
  expectTypeOf<DialogProps>().not.toHaveProperty('ref');
  const { dialog } = renderDialog();

  expect(dialog.open).toBe(true);
  expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
    'Rename',
  );
  expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    'Enter a new board name.',
  );
});

it('requests Escape and close-button dismissal without changing the controlled open state', () => {
  const { dialog, onRequestClose } = renderDialog();
  const event = dispatchCancel(dialog);
  const closeButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  expect(closeButton?.querySelector('svg')).not.toBeNull();
  expect(closeButton?.textContent).toBe('');
  act(() => closeButton?.click());

  expect(event.defaultPrevented).toBe(true);
  expect(onRequestClose.mock.calls).toEqual([['escape'], ['close-button']]);
  expect(dialog.open).toBe(true);

  renderDialog({ open: false });
  expect(dialog.open).toBe(false);
});

it('honors the dismissal policy and recognizes pointer gestures on the backdrop', () => {
  const { dialog, onRequestClose } = renderDialog({
    dismissPolicy: { escape: false, backdrop: true },
  });
  const event = dispatchCancel(dialog);
  act(() => {
    dialog.querySelector('input')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dialog.click();
  });

  expect(event.defaultPrevented).toBe(true);
  expect(onRequestClose).not.toHaveBeenCalled();

  dispatchBackdropPointerEvents(dialog);
  expect(onRequestClose.mock.calls).toEqual([['backdrop']]);
  expect(dialog.open).toBe(true);
});

it('runs focus callbacks at actual transitions and preserves focus on ordinary renders', () => {
  const initialFocus = vi.fn();
  const restoreFocus = vi.fn();
  const { dialog } = renderDialog({ initialFocus, restoreFocus });

  expect(initialFocus).toHaveBeenCalledTimes(1);
  expect(dialog.open).toBe(true);

  const nextInitialFocus = vi.fn();
  renderDialog({ initialFocus: nextInitialFocus, restoreFocus });
  expect(nextInitialFocus).not.toHaveBeenCalled();
  expect(restoreFocus).not.toHaveBeenCalled();

  renderDialog({ open: false, restoreFocus });
  expect(dialog.open).toBe(false);
  expect(restoreFocus).toHaveBeenCalledTimes(1);
});
