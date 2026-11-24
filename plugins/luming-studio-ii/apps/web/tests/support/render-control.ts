import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export function createControlFixture() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  function render(child: ReactNode) {
    act(() => root.render(child));
  }

  function dispose() {
    act(() => root.unmount());
    host.remove();
  }

  return { host, render, dispose };
}
