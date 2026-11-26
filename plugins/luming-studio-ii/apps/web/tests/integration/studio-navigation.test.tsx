import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  readStudioLocation,
  subscribeStudioLocation,
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
