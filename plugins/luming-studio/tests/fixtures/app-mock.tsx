import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import StudioApp from '../../src/app/shell/StudioApp.js';
import { studioRequest } from '../../src/app/transport/client.js';

export function createAppMock() {
  const container = document.createElement('div');
  document.body.append(container);

  let root: Root | undefined = createRoot(container);

  async function unmount() {
    const mountedRoot = root;

    root = undefined;

    if (mountedRoot) {
      await act(async () => mountedRoot.unmount());
    }
  }

  return {
    container,
    async render(props: Omit<ComponentProps<typeof StudioApp>, 'requestStudio'>) {
      const mountedRoot = (root ??= createRoot(container));

      await act(async () =>
        mountedRoot.render(<StudioApp {...props} requestStudio={studioRequest} />),
      );
    },
    unmount,
    async dispose() {
      try {
        await unmount();
      } finally {
        container.remove();
      }
    },
  };
}
