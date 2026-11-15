// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReaderHud, ReaderTools, type ReaderToolActions, type ReaderToolState } from '../src/app/pdf/ReaderTools';
import { registerEscapeLayer } from '../src/app/ui/escape';

let host: HTMLDivElement, root: Root, unregister: (() => void) | undefined;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { unregister?.(); unregister = undefined; await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const state: ReaderToolState = { ready: true, hasPaper: true, page: 1, total: 1, pageInput: '1', scale: 1, fit: true, tone: 'white', outlineOpen: false, searchOpen: true, marksOpen: false, notesOpen: false, notesDirty: false, translationOpen: true, translating: false, cards: false, targetLanguage: '' };
function key(target: EventTarget, type = 'keydown', options: KeyboardEventInit = {}) { const event = new KeyboardEvent(type, { key: 'Escape', bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); return event; }

it.each([false, true])('closes zoom before the reading tools, restores its trigger and isolates release/repeat (compact=%s)', async compact => {
  const fallback = vi.fn(), action = vi.fn();
  const actions: ReaderToolActions = { toggleOutline: action, toggleSearch: action, toggleMarks: action, toggleNotes: action, toggleTranslation: action, toggleCards: action, pageInput: action, goToPage: action, previous: action, next: action, zoom: action, fit: action, rotate: action, tone: action, targetLanguage: action };
  await act(async () => root.render(<><ReaderTools state={state} actions={actions} collapsed={compact} />{compact && <ReaderHud state={state} actions={actions} />}</>));
  unregister = registerEscapeLayer(host, fallback, 0);
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="设置缩放"]')!;
  await act(async () => trigger.click());
  const slider = host.querySelector<HTMLInputElement>('[aria-label="PDF 缩放"]')!; slider.focus();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  let pressed!: KeyboardEvent; await act(async () => { pressed = key(slider); });
  expect(pressed.defaultPrevented).toBe(true); expect(host.querySelector('.reader-zoom__detail')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger);
  expect(host.querySelector('[aria-label="查找"]')!.getAttribute('aria-pressed')).toBe('true'); expect(host.querySelector('[aria-label="翻译"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(fallback).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
  await act(async () => { expect(key(trigger, 'keydown', { repeat: true }).defaultPrevented).toBe(true); expect(key(trigger, 'keyup').defaultPrevented).toBe(true); });
  expect(fallback).not.toHaveBeenCalled();
  await act(async () => { key(trigger); }); expect(fallback).toHaveBeenCalledOnce();
});
