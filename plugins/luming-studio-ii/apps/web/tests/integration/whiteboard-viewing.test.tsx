import { act } from 'react';
import { expect, test } from 'vitest';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

function action(root: HTMLElement, label: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) {
    throw new Error('Missing whiteboard action: ' + label);
  }

  return button;
}

async function flushViewport() {
  await act(async () => {
    await new Promise<void>((done) => {
      requestAnimationFrame(() => done());
    });
  });
}

test('presents an existing selection without replacing Canvas or writing geometry', async () => {
  const rpc = createWhiteboardRpcMock();
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    const canvas = app.canvas();
    const world = canvas.querySelector<HTMLElement>('.studio-canvas__world');
    const originalTransform = world?.style.transform;
    const grab = { x: 70, y: 70 };
    await app.drag(grab, grab);
    expect(canvas.querySelectorAll('[data-canvas-static-corner]')).toHaveLength(4);

    const origin = action(canvas, '全屏观看选区');
    await app.update(() => origin.click());
    await flushViewport();
    expect(app.canvas()).toBe(canvas);
    expect(canvas.hasAttribute('data-canvas-presentation')).toBe(true);
    expect(canvas.querySelectorAll('[data-canvas-object]')).toHaveLength(1);
    expect(canvas.querySelector('[data-canvas-static-corner]')).toBeNull();

    await app.drag(grab, { x: 100, y: 100 });
    expect(rpc.moves).toHaveLength(0);

    await app.update(() => action(app.host, '退出全屏观看').click());
    await flushViewport();
    expect(app.canvas()).toBe(canvas);
    expect(world?.style.transform).toBe(originalTransform);
    expect(canvas.hasAttribute('data-canvas-presentation')).toBe(false);
    expect(canvas.querySelectorAll('[data-canvas-static-corner]')).toHaveLength(4);
    expect(origin.isConnected).toBe(false);
    expect(document.activeElement).toBe(action(canvas, '全屏观看选区'));
  } finally {
    app.dispose();
  }
});
