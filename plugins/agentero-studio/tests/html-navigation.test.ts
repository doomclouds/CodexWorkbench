import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import {
  buildHtmlRegionDocument,
  validateHtmlNavigationMessage,
} from '../src/app/shared/html-region/runtime.js';

const identity = { channel: 'navigation-channel', regionId: 'region', sourceRevision: 3 };
const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) {
    dom.window.close();
  }

  vi.unstubAllGlobals();
});

async function runtime(annotation = false) {
  const parser = new JSDOM();
  windows.push(parser);
  vi.stubGlobal('DOMParser', parser.window.DOMParser);
  const sent: any[] = [];
  const source =
    '<button id="control" style="cursor:wait!important">Try</button><input id="input"><p id="text">Read me</p><script>window.clicks=0;window.wheels=0;document.getElementById("control").addEventListener("click",()=>window.clicks++);window.addEventListener("wheel",()=>window.wheels++);</script>';
  const dom = new JSDOM(buildHtmlRegionDocument(source, { ...identity, annotation }), {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window, 'CSS', { value: { escape: (value: string) => value } });
      Object.defineProperty(window, 'TextEncoder', { value: TextEncoder });
      window.postMessage = (message: object) => sent.push(message);
    },
  });
  windows.push(dom);
  await new Promise((resolve) => {
    dom.window.addEventListener('load', resolve, { once: true });
  });
  const control = dom.window.document.getElementById('control')!;
  const pointer = (type: string, button: number, screenX = 100, screenY = 120) => {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
      screenX,
      screenY,
      detail: 1,
    });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    control.dispatchEvent(event);

    return event;
  };

  const key = (type: string, target = dom.window.document.body, extra = {}) => {
    const event = new dom.window.KeyboardEvent(type, {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    target.dispatchEvent(event);

    return event;
  };

  return {
    dom,
    control,
    sent,
    pointer,
    key,
    navigation: () => sent.filter((value) => value.type === 'studio-html-navigation'),
  };
}

it.each([false, true])(
  'bridges middle drag before interactive/annotation=%s handlers and restores cursors and ordinary clicks',
  async (annotation) => {
    const { dom, control, pointer, navigation, sent } = await runtime(annotation);
    expect(pointer('pointerdown', 1).defaultPrevented).toBe(true);
    expect((control as HTMLElement).style.cursor).toBe('grabbing');
    pointer('pointermove', 1, 260, 200);
    pointer('pointerup', 1, 260, 200);
    expect(navigation()).toEqual(
      ['start', 'move', 'end'].map((phase) =>
        expect.objectContaining({ ...identity, kind: 'pan', phase, pointerId: 7 }),
      ),
    );
    expect(sent.filter((value) => value.type === 'studio-html-selection')).toHaveLength(0);
    expect((control as HTMLElement).style.cursor).not.toBe('grabbing');
    if (!annotation) {
      expect((control as HTMLElement).style.cursor).toBe('wait');
      pointer('click', 0);
      expect(dom.window.eval('window.clicks')).toBe(0);
      pointer('pointerdown', 0);
      pointer('pointerup', 0);
      pointer('click', 0);
      expect(dom.window.eval('window.clicks')).toBe(1);
    }
  },
);

it('leaves content scrolling alone and forwards only explicit Ctrl/Meta zoom with a normalized anchor', async () => {
  const { dom, control, navigation } = await runtime();
  const ordinary = new dom.window.WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });
  control.dispatchEvent(ordinary);
  expect(ordinary.defaultPrevented).toBe(false);
  expect(dom.window.eval('window.wheels')).toBe(1);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    const zoom = new dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -3,
      deltaMode: 1,
      clientX: 512,
      clientY: 384,
      ...modifiers,
    });
    control.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
  }

  expect(navigation()).toEqual(
    Array.from({ length: 2 }, () =>
      expect.objectContaining({
        ...identity,
        kind: 'zoom',
        x: 0.5,
        y: 0.5,
        deltaY: -3,
        deltaMode: 1,
      }),
    ),
  );
  expect(dom.window.eval('window.wheels')).toBe(1);
});

it('preserves Space in fields/buttons/IME, supports body Space pan, and cancels navigation on blur', async () => {
  const { dom, control, key, pointer, navigation } = await runtime();
  for (const target of [control, dom.window.document.getElementById('input')!]) {
    expect(key('keydown', target as HTMLElement).defaultPrevented).toBe(false);
  }

  expect(key('keydown', undefined, { isComposing: true }).defaultPrevented).toBe(false);
  expect(navigation()).toHaveLength(0);
  key('keydown');
  expect(navigation().at(-1)).toMatchObject({ kind: 'space', held: true });
  expect((control as HTMLElement).style.cursor).toBe('grab');
  pointer('pointerdown', 0);
  pointer('pointermove', 0, 150, 160);
  dom.window.dispatchEvent(new dom.window.Event('blur'));
  expect(navigation().slice(-2)).toEqual([
    expect.objectContaining({ kind: 'pan', phase: 'cancel' }),
    expect.objectContaining({ kind: 'space', held: false }),
  ]);
  const count = navigation().length;
  pointer('pointermove', 0, 300, 200);
  expect(navigation()).toHaveLength(count);
  expect((control as HTMLElement).style.cursor).toBe('wait');
});

it('rejects stale identities, malformed phases, nonfinite coordinates and invalid zoom inputs', () => {
  const pan = {
    type: 'studio-html-navigation',
    ...identity,
    kind: 'pan',
    phase: 'start',
    pointerId: 1,
    screenX: 500,
    screenY: -100,
  };
  expect(validateHtmlNavigationMessage(pan, identity)).toMatchObject({
    kind: 'pan',
    pointerId: 1,
    screenY: -100,
  });

  for (const patch of [
    { channel: 'stale' },
    { regionId: 'other' },
    { sourceRevision: 2 },
    { phase: 'edit' },
    { pointerId: -1 },
    { screenX: NaN },
    { screenY: Infinity },
  ]) {
    expect(validateHtmlNavigationMessage({ ...pan, ...patch }, identity)).toBeNull();
  }

  const zoom = {
    type: 'studio-html-navigation',
    ...identity,
    kind: 'zoom',
    x: 0.2,
    y: 0.6,
    deltaY: 120,
    deltaMode: 0,
  };
  expect(validateHtmlNavigationMessage(zoom, identity)).toMatchObject({ kind: 'zoom', x: 0.2 });
  for (const patch of [{ x: -1 }, { y: 2 }, { deltaY: NaN }, { deltaMode: 7 }]) {
    expect(validateHtmlNavigationMessage({ ...zoom, ...patch }, identity)).toBeNull();
  }
});
