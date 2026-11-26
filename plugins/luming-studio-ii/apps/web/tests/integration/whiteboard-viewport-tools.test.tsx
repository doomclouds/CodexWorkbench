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
    const menu = element(app.host, zoomMenu);
    const commands = Array.from(
      menu.querySelectorAll('[role="menuitem"]'),
      (item) => item.getAttribute('aria-label') ?? item.textContent?.trim(),
    );
    expect(commands).toEqual([
      '25%',
      '50%',
      '75%',
      '100%',
      '150%',
      '200%',
      '适应白板',
      '适应选区',
      '撤销',
      '重做',
    ]);
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

    const numberKeys = element<HTMLInputElement>(menu, 'details label:nth-of-type(2) input');
    expect(numberKeys.checked).toBe(true);
    await app.update(() => numberKeys.click());
    expect(numberKeys.checked).toBe(false);

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

function readTimerSeconds(host: HTMLElement) {
  const label = element<HTMLOutputElement>(host, 'output[aria-label="剩余时间"]').textContent ?? '';
  const [minutes = '0', seconds = '0'] = label.split(':');

  return Number(minutes) * 60 + Number(seconds);
}

test('uses the original timer controls to count down, pause, resume and reset', async () => {
  const rpc = createWhiteboardRpcMock();
  const app = createAppMock(rpc.post);
  try {
    await app.open(sampleBoardId);
    const trigger = element<HTMLButtonElement>(app.host, 'button[aria-label="计时器"]');
    await app.update(() => trigger.click());
    const panel = element(app.host, '[role="dialog"][aria-label="计时器"]');
    const minutes = () => element<HTMLInputElement>(panel, 'input[aria-label="计时分钟"]').value;
    const seconds = () => element<HTMLInputElement>(panel, 'input[aria-label="计时秒数"]').value;
    const status = () => element(panel, '[aria-label="计时状态"]').textContent;

    expect([minutes(), seconds(), status()]).toEqual(['05', '00', '待开始']);
    await app.click('减少一分钟');
    expect([minutes(), seconds()]).toEqual(['04', '00']);
    await app.click('开始');
    expect(status()).toBe('计时中');
    const before = readTimerSeconds(panel);

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1300);
      });
    });
    expect(readTimerSeconds(panel)).toBeLessThan(before);

    await app.click('暂停');
    expect(status()).toBe('已暂停');
    await app.click('继续');
    expect(status()).toBe('计时中');
    await app.click('暂停');
    await app.click('重置');
    expect([minutes(), seconds(), status()]).toEqual(['04', '00', '待开始']);
    expect(rpc.moves).toHaveLength(0);
  } finally {
    app.dispose();
  }
});

test('shows the timer in read-only boards without presenting mutation controls', async () => {
  const rpc = createWhiteboardRpcMock();
  const sceneMethod = WhiteboardService.method.getBoardScene;
  const scenePath = '/' + WhiteboardService.typeName + '/' + sceneMethod.name;
  const app = createAppMock(async (path, bytes) => {
    const response = await rpc.post(path, bytes);
    if (path !== scenePath) {
      return response;
    }

    const scene = fromBinary(sceneMethod.output, response);
    if (scene.scene?.access) {
      scene.scene.access.canEdit = false;
    }

    return toBinary(sceneMethod.output, scene);
  });

  try {
    await app.open(sampleBoardId);
    await app.update(() => element(app.host, 'button[aria-label="计时器"]').click());
    const panel = element(app.host, '[role="dialog"][aria-label="计时器"]');
    expect(readTimerSeconds(panel)).toBe(5 * 60);
    expect(panel.querySelector('button')).toBeNull();
    expect(panel.querySelector('input')).toBeNull();
  } finally {
    app.dispose();
  }
});

test('accepts pasted minutes and seconds, with Escape discarding only the timer draft', async () => {
  const rpc = createWhiteboardRpcMock();
  const app = createAppMock(rpc.post);

  function paste(target: HTMLInputElement, text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    target.focus();
    target.dispatchEvent(event);
  }

  function press(target: HTMLInputElement, key: string) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  try {
    await app.open(sampleBoardId);
    await app.click('计时器');
    const panel = element(app.host, '[role="dialog"][aria-label="计时器"]');
    const minutes = element<HTMLInputElement>(panel, '[aria-label="计时分钟"]');
    const seconds = element<HTMLInputElement>(panel, '[aria-label="计时秒数"]');
    await app.update(() => paste(minutes, '７：27'));
    expect([minutes.value, seconds.value]).toEqual(['07', '27']);
    expect(document.activeElement).toBe(seconds);

    await app.update(() => press(seconds, 'Escape'));
    expect(panel.isConnected).toBe(true);
    expect([minutes.value, seconds.value]).toEqual(['05', '00']);
    await app.update(() => press(seconds, 'ArrowLeft'));
    expect(document.activeElement).toBe(minutes);

    await app.update(() => paste(minutes, '2.05'));
    await app.update(() => press(seconds, 'Enter'));
    expect([minutes.value, seconds.value]).toEqual(['02', '05']);
    await app.update(() => press(seconds, 'Escape'));
    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(element(app.host, 'button[aria-label="计时器"]'));
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
