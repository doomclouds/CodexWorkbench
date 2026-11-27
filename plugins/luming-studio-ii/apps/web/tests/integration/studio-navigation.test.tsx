import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  readPreferences,
  readStudioLocation,
  rememberTheme,
  subscribeStudioLocation,
  subscribeTheme,
  writeStudioLocation,
} from '../../src/platform/browser/index.js';

let previousUrl: string;

beforeEach(() => {
  previousUrl = window.location.href;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', previousUrl);
});

test('reads the Workbench, board and Recycle Bin through the public URL contract', () => {
  expect(readStudioLocation()).toEqual({ kind: 'workbench' });

  window.history.replaceState(null, '', '/?board=desk');
  expect(readStudioLocation()).toEqual({ kind: 'whiteboard', boardId: 'desk' });

  window.history.replaceState(null, '', '/?board=desk&view=trash');
  expect(readStudioLocation()).toEqual({ kind: 'recycle-bin' });
});

test('switches between registered destinations and preserves other URL parameters', () => {
  window.history.replaceState(null, '', '/?locale=zh-CN#preview');
  writeStudioLocation({ kind: 'recycle-bin' });
  expect(window.location.search).toBe('?locale=zh-CN&view=trash');
  expect(readStudioLocation()).toEqual({ kind: 'recycle-bin' });

  writeStudioLocation({ kind: 'whiteboard', boardId: 'desk' });
  expect(window.location.search).toBe('?locale=zh-CN&board=desk');
  expect(readStudioLocation()).toEqual({ kind: 'whiteboard', boardId: 'desk' });

  writeStudioLocation({ kind: 'workbench' });
  expect(window.location.search).toBe('?locale=zh-CN');
  expect(window.location.hash).toBe('#preview');
});

test('reports browser navigation and releases its history listener', () => {
  const routes: string[] = [];
  const unsubscribe = subscribeStudioLocation(() => routes.push(readStudioLocation().kind));
  window.history.replaceState(null, '', '/?view=trash');
  window.dispatchEvent(new PopStateEvent('popstate'));
  unsubscribe();
  window.history.replaceState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));

  expect(routes).toEqual(['recycle-bin']);
});

test('follows system theme changes until a local override is chosen', () => {
  const media = Object.assign(new EventTarget(), { matches: false });
  const themeKey = 'luming-studio-ii:theme';
  const previous = window.localStorage.getItem(themeKey);
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const themes: string[] = [];
  let unsubscribe: (() => void) | undefined;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media });
  window.localStorage.removeItem(themeKey);

  try {
    expect(readPreferences().resolvedTheme).toBe('light');
    unsubscribe = subscribeTheme((theme) => themes.push(theme));
    media.matches = true;
    media.dispatchEvent(new Event('change'));
    expect(themes).toEqual(['light', 'dark']);

    rememberTheme('light');
    media.dispatchEvent(new Event('change'));
    expect(themes).toEqual(['light', 'dark', 'light']);

    unsubscribe();
    media.dispatchEvent(new Event('change'));
    expect(themes).toHaveLength(3);
  } finally {
    unsubscribe?.();
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
    if (previous === null) {
      window.localStorage.removeItem(themeKey);
    } else {
      window.localStorage.setItem(themeKey, previous);
    }
  }
});
