import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { act } from 'react';
import { expect, test } from 'vitest';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createAppMock } from '../support/whiteboard-app-mock.js';

function element<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const match = root.querySelector<T>(selector);
  if (!match) {
    throw new Error('Missing viewport control: ' + selector);
  }

  return match;
}

async function flushViewport() {
  await act(async () => {
    await new Promise<void>((done) => {
      requestAnimationFrame(() => done());
    });
  });
}

const zoomLabel = '[aria-label="缩放菜单"]';
const zoomMenu = '[aria-label="缩放与视图"]';
const grab = { x: 70, y: 70 };

test('recovers original viewport tools, grid visibility and menu dismissal through the whiteboard app', async () => {
  const rpc = createWhiteboardRpcMock();
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    const trigger = element<HTMLButtonElement>(app.host, zoomLabel);
    const background = element(app.host, '.studio-canvas__background');
    await app.update(() => trigger.click());
    const fitSelection = [
      ...app.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === '适应选区');

    expect(fitSelection?.disabled).toBe(true);
    expect(background.style.backgroundImage).toBe('');
    await app.update(() => element(app.host, 'summary').click());
    const grid = element<HTMLInputElement>(app.host, 'input[type="checkbox"]');
    expect(grid.checked).toBe(true);
    await app.update(() => grid.click());
    expect(background.style.backgroundImage).toBe('none');

    await app.update(() => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(app.host.querySelector(zoomMenu)).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await app.update(() => trigger.click());
    await app.drag({ x: 770, y: 540 }, { x: 770, y: 540 });
    expect(app.host.querySelector(zoomMenu)).toBeNull();

    await app.drag(grab, grab);
    await app.update(() => trigger.click());
    await app.click('适应选区');
    await flushViewport();
    expect(trigger.textContent?.trim()).toBe('570%');

    await app.update(() => trigger.click());
    await app.click('适应白板');
    await flushViewport();
    expect(trigger.textContent?.trim()).toBe('12%');
    expect(rpc.moves).toHaveLength(0);
  } finally {
    app.dispose();
  }
});

test('steps above 400% and stops at the same 800% maximum as Canvas', async () => {
  const rpc = createWhiteboardRpcMock();
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    const trigger = element<HTMLButtonElement>(app.host, zoomLabel);
    await app.update(() => trigger.click());
    await app.click('200%');
    await flushViewport();

    await app.update(() => trigger.click());
    const zoomIn = element<HTMLButtonElement>(app.host, '[aria-label="放大"]');
    for (let step = 0; step < 4; step += 1) {
      await app.update(() => zoomIn.click());
      await flushViewport();
    }
    expect(trigger.textContent?.trim()).toBe('415%');

    for (let step = 0; step < 4; step += 1) {
      await app.update(() => zoomIn.click());
      await flushViewport();
    }
    expect(trigger.textContent?.trim()).toBe('800%');
    expect(rpc.moves).toHaveLength(0);
  } finally {
    app.dispose();
  }
});

test('fits selected sections including their locked descendants while leaving the scene untouched', async () => {
  const rpc = createWhiteboardRpcMock();
  const sceneMethod = WhiteboardService.method.getBoardScene;
  const scenePath = '/' + WhiteboardService.typeName + '/' + sceneMethod.name;
  const app = createAppMock(async (path, bytes) => {
    const reply = await rpc.post(path, bytes);
    if (path !== scenePath) {
      return reply;
    }

    const response = fromBinary(sceneMethod.output, reply);
    const [rectangle, , distant] = response.scene?.objects ?? [];
    if (!rectangle || !distant) {
      throw new Error('The section fixture must contain a selected section and its descendant.');
    }

    rectangle.kind = 'section';
    distant.parentId = rectangle.objectId;
    distant.locked = true;
    return toBinary(sceneMethod.output, response);
  });

  try {
    await app.open(sampleBoardId);
    await app.drag(grab, grab);
    const trigger = element<HTMLButtonElement>(app.host, zoomLabel);
    await app.update(() => trigger.click());
    await app.click('适应选区');
    await flushViewport();

    expect(trigger.textContent?.trim()).toBe('12%');
    expect(app.host.querySelector('[data-canvas-object="distant"]')).not.toBeNull();
    expect(rpc.moves).toHaveLength(0);
  } finally {
    app.dispose();
  }
});
