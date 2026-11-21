import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  roots: [] as import('react-dom/client').Root[],
  navigate: vi.fn(),
  receive: undefined as ((artifactId?: string, view?: string) => void) | undefined,
}));
vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>();

  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      harness.roots.push(root);

      return root;
    },
  };
});
vi.mock('../../src/app/shared/escape', () => ({ installEscapeBoundary: () => () => {} }));
vi.mock('../../src/app/transport/bridge', () => ({
  createStudioBridge: async (receive: typeof harness.receive) => {
    harness.receive = receive;

    return {
      client: { embedded: false },
      actor: { id: 'local', name: 'Owner', kind: 'human', role: 'owner' },
      artifactId: 'first',
      view: 'editor',
      navigate: harness.navigate,
      close: async () => {},
    };
  },
}));
vi.mock('../../src/app/shell/StudioApp', () => ({
  default: ({
    initialArtifactId,
    initialView,
    onNavigate,
  }: {
    initialArtifactId?: string;
    initialView?: string;
    onNavigate?: (artifactId?: string, view?: string) => void;
  }) => (
    <main>
      <output>{`${initialView}:${initialArtifactId ?? ''}`}</output>
      <button onClick={() => onNavigate?.('created', 'editor')}>Open created</button>
      <button onClick={() => onNavigate?.(undefined, 'trash')}>Trash</button>
    </main>
  ),
}));
afterEach(async () => {
  for (const root of harness.roots.splice(0)) {
    await act(async () => root.unmount());
  }

  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('wires UI navigation into the standalone bridge while applying external history routes through existing props', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  harness.navigate.mockImplementation((id, view) => harness.receive?.(id, view));
  await act(async () => {
    await import('../../src/app/main');
  });
  expect(document.querySelector('output')!.textContent).toBe('editor:first');
  await act(async () => document.querySelectorAll('button')[0]!.click());
  expect(harness.navigate).toHaveBeenLastCalledWith('created', 'editor');
  expect(document.querySelector('output')!.textContent).toBe('editor:created');
  await act(async () => harness.receive?.('first', 'board'));
  expect(document.querySelector('output')!.textContent).toBe('board:first');
  await act(async () => document.querySelectorAll('button')[1]!.click());
  expect(harness.navigate).toHaveBeenLastCalledWith(undefined, 'trash');
  expect(document.querySelector('output')!.textContent).toBe('trash:');
});
