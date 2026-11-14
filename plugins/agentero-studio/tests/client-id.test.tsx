// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newClientId } from '../src/app/shared/client-id.js';
import HtmlRegion from '../src/app/shared/html-region/HtmlRegion.js';

let root: Root | undefined, container: HTMLDivElement | undefined;
beforeEach(() => {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  vi.stubGlobal('isSecureContext', false);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = undefined; container = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('creates valid client UUIDs with only the WebCrypto API available on HTTP LAN origins', () => {
  expect(globalThis.isSecureContext).toBe(false);
  expect(globalThis.crypto.randomUUID).toBeUndefined();
  const first = newClientId(), second = newClientId('view');
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).toMatch(/^view-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).not.toBe(`view-${first}`);
});

it('renders the real HTML region without randomUUID instead of throwing during useMemo startup', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const element = { id: 'lan-html', version: 1, sourceRevision: 1, html: '<h1>HTTP LAN rendering</h1>' };
  await act(async () => { root!.render(<HtmlRegion element={element} annotation={false} interactive onAnnotate={() => {}} />); });
  const frame = container.querySelector('iframe');
  expect(frame).not.toBeNull(); expect(frame!.srcdoc).toContain('HTTP LAN rendering');
  expect(frame!.srcdoc).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
  expect(frame!.getAttribute('sandbox')).toBe('allow-scripts');
});
