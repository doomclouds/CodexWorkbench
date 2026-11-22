import { createDraftWorkspace } from '../../src/app/features/whiteboard/draft-workspace.js';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhiteboardCanvas, {
  type WhiteboardCanvasProps,
} from '../../src/app/features/whiteboard/canvas/WhiteboardCanvas.js';
import { makeElement } from '../../src/app/features/whiteboard/canvas/scene/canvas-model.js';
import {
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
  type Operation,
  type StudioClient,
  type ToolName,
} from '../../src/contracts/studio.js';
import {
  boardView,
  initialWhiteboard,
  whiteboardAdapter,
} from '../../src/core/products/whiteboard.js';
import {
  applyMutation,
  createState,
  initializeVersionClocks,
} from '../../src/core/shared/history.js';

const ownedCanvasDraft = (artifactId = 'board') =>
  createDraftWorkspace({ embedded: true }, LOCAL_ACTOR.id, artifactId)
    .open('canvas')
    .list()
    .find((record) => record.source !== 'legacy')?.raw ?? null;

let host: HTMLDivElement;
let root: Root;
const viewport = { x: 0, y: 0, zoom: 1 };
const element = (type: BoardElement['type'], changes: Partial<BoardElement> = {}) =>
  makeElement(type, { x: 100, y: 100 }, { id: 'target', text: 'Saved content', ...changes });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  host = document.createElement('div');
  host.className = 'studio';
  document.body.append(host);
  root = createRoot(host);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(elements: BoardElement[] = [], props: Partial<WhiteboardCanvasProps> = {}) {
  const content = initialWhiteboard(elements);
  const now = new Date().toISOString();
  const state = createState(
    {
      id: 'component-matrix',
      type: 'whiteboard',
      title: 'Components',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    },
    content,
    LOCAL_ACTOR,
    'create',
    elements.map((value) => value.id),
  );
  initializeVersionClocks(state, whiteboardAdapter);
  const activity = vi.fn();
  const call = vi.fn(async (_name: string, args: Parameters<typeof applyMutation>[1]) => {
    const result = applyMutation(state, args, LOCAL_ACTOR, whiteboardAdapter);

    return { board: boardView(state), historyEntry: result.historyEntry };
  });
  const client: StudioClient = {
    embedded: true,
    async call<T>(name: ToolName, args?: Record<string, unknown>): Promise<T> {
      const applyArgs = name === 'artifact_apply' && args;
      if (
        !applyArgs ||
        typeof applyArgs.operationId !== 'string' ||
        !Array.isArray(applyArgs.operations)
      ) {
        throw new Error('Expected an artifact_apply mutation');
      }

      const result = await call(name, {
        ...applyArgs,
        operationId: applyArgs.operationId,
        operations: applyArgs.operations,
      });

      return result as T;
    },
  };
  function Harness() {
    const [value, setValue] = useState<Board>(boardView(state));

    return (
      <WhiteboardCanvas
        board={value}
        client={client}
        actor={LOCAL_ACTOR}
        onChanged={setValue}
        onAnnotate={() => {}}
        externalViewport={viewport}
        onActivityChange={activity}
        {...props}
      />
    );
  }

  await act(async () => root.render(<Harness />));

  return {
    call,
    activity,
    current: () => boardView(state),
    operations: () => call.mock.calls.flatMap(([, args]) => args.operations as Operation[]),
  };
}

const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const target = () => host.querySelector<HTMLElement>('[data-element-id="target"]')!;

async function event(node: Element | null, name: string, x = 0, y = 0) {
  expect(node, `Missing target for ${name}`).not.toBeNull();
  await act(async () =>
    node!.dispatchEvent(new MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: y })),
  );
}

async function click(label: string) {
  await event(query(label), 'click');
}

async function key(node: Element | null, value: string, options: KeyboardEventInit = {}) {
  expect(node, `Missing target for ${value}`).not.toBeNull();
  await act(async () =>
    node!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options })),
  );
}

async function input(value: string, editor: HTMLElement | null = query('编辑文字')) {
  expect(editor).not.toBeNull();
  await act(async () => {
    editor!.textContent = value;
    editor!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pointer(x: number, y: number, end = { x, y }) {
  await event(query('白板画布'), 'pointerdown', x, y);
  if (end.x !== x || end.y !== y) {
    await event(query('白板画布'), 'pointermove', end.x, end.y);
  }

  await event(query('白板画布'), 'pointerup', end.x, end.y);
}

async function select(value: BoardElement) {
  const node =
    value.type === 'arrow' ? target().querySelector('path[pointer-events="stroke"]') : target();
  await event(node, 'pointerdown', value.x + 10, value.y + 10);
  await event(query('白板画布'), 'pointerup', value.x + 10, value.y + 10);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('plain text finish and empty-content boundaries', () => {
  it.each(['Escape', 'blur', 'tool'] as const)(
    'retires a new empty text through %s after its add was acknowledged',
    async (exit) => {
      const fixture = await mount();
      await click('文字');
      await pointer(100, 100, { x: 380, y: 260 });
      const added = fixture.current().elements[0]!;
      expect(added).toMatchObject({ type: 'text', text: '', w: 280, h: 160 });
      if (exit === 'Escape') {
        await key(query('编辑文字'), 'Escape');
      } else if (exit === 'blur') {
        await act(async () => query('编辑文字')!.blur());
      } else {
        await click('平移');
      }

      expect(fixture.current().elements).toEqual([]);
      expect(host.querySelector(`[data-element-id="${added.id}"]`)).toBeNull();
      expect(fixture.operations().at(-1)).toMatchObject({ op: 'delete', id: added.id });
      expect(fixture.call.mock.lastCall![1].expectedVersions).toMatchObject({
        [added.id]: added.version,
      });
    },
  );

  it('keeps a cleared existing text local until finish, then deletes with its actual version', async () => {
    vi.useFakeTimers();
    const fixture = await mount([element('text')]);
    await event(target(), 'dblclick');
    await input(' \n ');
    await advance(1200);
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.current().elements[0]!.text).toBe('Saved content');
    expect(fixture.activity.mock.lastCall![0].dirty).toBe(true);
    await key(query('编辑文字'), 'Escape');
    expect(fixture.operations()).toEqual([{ op: 'delete', id: 'target' }]);
    expect(fixture.current().elements).toEqual([]);
    expect(fixture.call.mock.lastCall![1].expectedVersions).toEqual({ target: 1 });
  });

  it('never autosaves a locked text empty and retains the rejected empty draft on finish', async () => {
    vi.useFakeTimers();
    const fixture = await mount([element('text', { locked: true })]);
    await event(target(), 'dblclick');
    await input('');
    await advance(1200);
    expect(fixture.call).not.toHaveBeenCalled();
    await key(query('编辑文字'), 'Escape');
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.current().elements[0]).toMatchObject({
      text: 'Saved content',
      locked: true,
      version: 1,
    });
    expect(query('编辑文字')?.textContent).toBe('');
    expect(fixture.activity.mock.lastCall![0].dirty).toBe(true);
    expect(host.textContent).toMatch(/锁定/);
    const draft = ownedCanvasDraft('component-matrix');
    expect(JSON.parse(draft!).text).toMatchObject({ id: 'target', text: '' });
  });

  it.each([false, true])(
    'resumes normal nonempty autosave after an empty draft, text locked=%s',
    async (locked) => {
      vi.useFakeTimers();
      const fixture = await mount([element('text', { locked })]);
      await event(target(), 'dblclick');
      await input('');
      await advance(300);
      expect(fixture.call).not.toHaveBeenCalled();
      await input('Recovered words');
      await advance(300);
      expect(fixture.current().elements[0]).toMatchObject({
        text: 'Recovered words',
        locked,
        version: 2,
      });
      expect(fixture.operations()).toEqual([
        expect.objectContaining({ op: 'update', changes: { text: 'Recovered words' } }),
      ]);
      await key(query('编辑文字'), 'Escape');
      expect(fixture.current().elements[0]!.text).toBe('Recovered words');
      expect(fixture.operations().some((operation) => operation.op === 'delete')).toBe(false);
    },
  );

  it('does not collect a previously empty text when its unchanged editor ends', async () => {
    const fixture = await mount([element('text', { text: '' })]);
    await event(target(), 'dblclick');
    await key(query('编辑文字'), 'Escape');
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.current().elements[0]).toMatchObject({ id: 'target', text: '', version: 1 });
  });

  it('keeps an empty composition local without treating Escape as finished input', async () => {
    vi.useFakeTimers();
    const fixture = await mount([element('text')]);
    await event(target(), 'dblclick');
    await act(async () => {
      const editor = query('编辑文字')!;
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      editor.textContent = '';
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: true,
          inputType: 'insertCompositionText',
        }),
      );
    });
    await key(query('编辑文字'), 'Escape', { isComposing: true });
    await advance(1200);
    expect(query('编辑文字')).not.toBeNull();
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.current().elements[0]!.text).toBe('Saved content');
  });

  it.each([false, true])(
    'protects linked-arrow deletion while clearing text, arrow locked=%s',
    async (locked) => {
      const arrow = element('arrow', {
        id: 'linked',
        text: undefined,
        from: 'target',
        to: [500, 200],
        locked,
      });
      const fixture = await mount([element('text'), arrow]);
      await event(target(), 'dblclick');
      await input('');
      await key(query('编辑文字'), 'Escape');
      if (locked) {
        expect(fixture.call).not.toHaveBeenCalled();
        expect(fixture.current().elements).toHaveLength(2);
        expect(fixture.current().elements.find((value) => value.id === 'target')!.text).toBe(
          'Saved content',
        );
        expect(query('编辑文字')?.textContent).toBe('');
        expect(fixture.activity.mock.lastCall![0].dirty).toBe(true);
        expect(host.textContent).toMatch(/锁定/);
      } else {
        expect(fixture.current().elements).toEqual([]);
        expect(fixture.operations()).toEqual([{ op: 'delete', id: 'target' }]);
        expect(fixture.call.mock.lastCall![1].expectedVersions).toEqual({ target: 1, linked: 1 });
      }
    },
  );

  it.each(['note', 'shape'] as const)(
    'preserves a %s when its label is explicitly cleared',
    async (type) => {
      const fixture = await mount([element(type)]);
      await event(target(), 'dblclick');
      await input('');
      await key(query('编辑文字'), 'Escape');
      expect(fixture.current().elements[0]).toMatchObject({ id: 'target', type, text: '' });
      expect(fixture.operations()).toEqual([
        expect.objectContaining({ op: 'update', changes: expect.objectContaining({ text: '' }) }),
      ]);
      expect(
        target().querySelector(type === 'note' ? '.studio-note-fill' : '.studio-shape-svg'),
      ).not.toBeNull();
    },
  );
});

describe('placement and geometry are separate from content editing', () => {
  it('keeps a new empty text creation session while changing font size and width before typing', async () => {
    const fixture = await mount();
    await click('文字');
    await pointer(100, 100, { x: 380, y: 260 });
    const created = fixture.current().elements[0]!;
    const id = created.id;
    const fontSize = query('文字大小') as HTMLSelectElement;
    expect(fontSize).not.toBeNull();
    await act(async () => {
      fontSize.focus();
      fontSize.value = '48';
      fontSize.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(fixture.current().elements[0]).toMatchObject({
      id,
      type: 'text',
      text: '',
      fontSize: 48,
    });
    await event(
      query('调整元素大小 e'),
      'pointerdown',
      created.x + created.w,
      created.y + created.h / 2,
    );
    await event(
      query('白板画布'),
      'pointermove',
      created.x + created.w + 120,
      created.y + created.h / 2,
    );
    await event(
      query('白板画布'),
      'pointerup',
      created.x + created.w + 120,
      created.y + created.h / 2,
    );
    const resized = fixture.current().elements.find((value) => value.id === id)!;
    expect(resized).toBeDefined();
    expect(resized.w).toBeGreaterThan(created.w);
    expect(fixture.operations().some((operation) => operation.op === 'delete')).toBe(false);
    if (!query('编辑文字')) {
      await event(host.querySelector(`[data-element-id="${id}"]`), 'dblclick');
    }

    await input('Text after sizing');
    await key(query('编辑文字'), 'Escape');
    expect(fixture.current().elements).toHaveLength(1);
    expect(fixture.current().elements[0]).toMatchObject({
      id,
      type: 'text',
      text: 'Text after sizing',
      fontSize: 48,
      w: resized.w,
      h: resized.h,
    });
    expect(fixture.operations().filter((operation) => operation.op === 'add')).toHaveLength(1);
    expect(fixture.operations().some((operation) => operation.op === 'delete')).toBe(false);
  });

  it.each(['shape', 'person', 'container', 'sticker'] as const)(
    'places %s selected with geometry handles and no text editor',
    async (kind) => {
      const fixture = await mount();
      if (kind === 'sticker') {
        await click('贴纸');
        await click('贴纸 想法');
      } else if (kind === 'container') {
        await click('分区');
      } else {
        await click('形状');
        if (kind === 'person') {
          await click('形状 人物');
        }
      }

      await pointer(100, 100, { x: 320, y: 260 });
      const added = fixture.current().elements[0]!;
      expect(added.type).toBe(kind === 'person' ? 'shape' : kind);
      if (kind === 'person') {
        expect(added.kind).toBe('person');
      }

      expect(host.querySelector(`[data-element-id="${added.id}"].is-selected`)).not.toBeNull();
      expect(host.querySelector('[contenteditable="true"]')).toBeNull();
      expect(host.querySelectorAll('button.studio-selection-corner')).toHaveLength(4);
      expect(fixture.activity.mock.lastCall![0]).toMatchObject({
        editingIds: [],
        movingIds: [],
        dirty: false,
      });
    },
  );

  it.each(['text', 'note'] as const)(
    'ends %s input before resizing the saved text',
    async (type) => {
      const fixture = await mount();
      await click(type === 'text' ? '文字' : '便签');
      await pointer(100, 100);
      const id = fixture.current().elements[0]!.id;
      await input('Keep this text');
      await key(query('编辑文字'), 'Escape');
      expect(host.querySelector('[contenteditable="true"]')).toBeNull();
      const saved = fixture.current().elements[0]!;
      await event(query('调整元素大小 se'), 'pointerdown', saved.x + saved.w, saved.y + saved.h);
      await event(query('白板画布'), 'pointermove', saved.x + saved.w + 80, saved.y + saved.h + 50);
      await event(query('白板画布'), 'pointerup', saved.x + saved.w + 80, saved.y + saved.h + 50);
      expect(fixture.current().elements[0]).toMatchObject({ id, text: 'Keep this text' });
      expect(fixture.current().elements[0]!.w).toBeGreaterThan(saved.w);
      expect(
        fixture
          .operations()
          .some((operation) => operation.op === 'update' && operation.changes?.w !== undefined),
      ).toBe(true);
    },
  );
});

const capabilityFixtures = [
  element('text'),
  element('note'),
  element('shape', { kind: 'person' }),
  element('container'),
  element('stroke', { points: [0, 0, 50, 50] }),
  element('arrow', { from: [100, 100], to: [300, 160] }),
  element('sticker', { data: { stickerIconId: 'bulb' } }),
  element('sticker', { text: '😀' }),
  element('table', {
    data: {
      rows: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    },
  }),
  element('image', { src: 'data:image/png;base64,AA==' }),
  element('image', { src: 'data:image/png;base64,AA==', video: 'data:video/mp4;base64,AA==' }),
  element('link', { href: 'https://example.com' }),
  element('html', { html: '<p>Embedded</p>' }),
  element('diagram', { html: '<p>Legacy embedded diagram</p>' }),
  element('diagram', { text: 'Legacy diagram' }),
  element('chart', { text: 'Legacy chart' }),
].map((value, index) => {
  let suffix = '';
  if (index === 7) {
    suffix = '-emoji';
  } else if (value.video) {
    suffix = '-video';
  } else if (value.type === 'diagram' && value.html) {
    suffix = '-html';
  }

  return { name: `${value.type}${suffix}`, value };
});

describe('component capability matrix', () => {
  it.each(capabilityFixtures)(
    'selects $name without declaring content or geometry edits',
    async ({ value }) => {
      const fixture = await mount([value]);
      const hit =
        value.type === 'arrow' ? target().querySelector('path[pointer-events="stroke"]') : target();
      await event(hit, 'pointerdown', value.x + 10, value.y + 10);
      expect(fixture.activity.mock.lastCall![0]).toMatchObject({
        editingIds: [],
        movingIds: [],
        dirty: false,
      });
      await event(query('白板画布'), 'pointerup', value.x + 10, value.y + 10);
      expect(fixture.call).not.toHaveBeenCalled();
      expect(host.querySelector('[contenteditable="true"]')).toBeNull();
    },
  );

  it('edits an arrow label without changing it into text or deleting an unlabeled arrow', async () => {
    const value = element('arrow', { label: 'Label', from: [100, 100], to: [300, 160] });
    const fixture = await mount([value]);
    await event(target().querySelector('path[pointer-events="stroke"]'), 'dblclick');
    await input('', query('连接线文字'));
    await key(query('连接线文字'), 'Escape');
    expect(fixture.current().elements[0]).toMatchObject({ type: 'arrow', label: '' });
    expect(fixture.operations()).toEqual([
      expect.objectContaining({ op: 'update', changes: { label: '' } }),
    ]);
  });

  it('edits a table cell through its cell editor and leaves ordinary element text untouched', async () => {
    const fixture = await mount([
      element('table', {
        data: {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      }),
    ]);
    await select(fixture.current().elements[0]!);
    await event(target().querySelector('th,td'), 'dblclick');
    const editor = target().querySelector<HTMLElement>('[contenteditable="true"]');
    expect(editor).not.toBeNull();
    expect(query('编辑文字')).toBeNull();
    await input('Cell changed', editor);
    await key(editor, 'Escape');
    expect(fixture.current().elements[0]!.data?.rows).toEqual([
      ['Cell changed', 'B'],
      ['C', 'D'],
    ]);
    expect(fixture.current().elements[0]!.text).toBe('Saved content');
  });

  it.each(['image', 'link', 'html', 'diagram-html', 'diagram', 'chart'] as const)(
    'routes %s double click to its actual capability without a generic text editor',
    async (kind) => {
      const value = capabilityFixtures.find((item) => item.name === kind)!.value;
      const fixture = await mount([value]);
      const frame = target().querySelector('iframe');
      if (frame) {
        expect(frame.style.pointerEvents).toBe('none');
        expect(frame.tabIndex).toBe(-1);
      }

      await select(fixture.current().elements[0]!);
      if (frame) {
        expect(frame.style.pointerEvents).toBe('auto');
        expect(frame.tabIndex).toBe(0);
      }

      await event(target(), 'dblclick');
      expect(query('编辑文字')).toBeNull();
      if (kind === 'image') {
        expect(host.querySelector('[role="dialog"][aria-label="裁剪图片"]')).not.toBeNull();
      } else if (kind === 'link') {
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      } else if (kind === 'html' || kind === 'diagram-html') {
        expect(frame).not.toBeNull();
        expect(target().querySelector('iframe')).toBe(frame);
        expect(frame!.style.pointerEvents).toBe('auto');
        expect(query('与 HTML 内容交互')).toBeNull();
        expect(query('编辑 HTML 源码')).not.toBeNull();
      } else {
        expect(host.querySelector('[role="dialog"]')).toBeNull();
      }

      expect(fixture.call).not.toHaveBeenCalled();
    },
  );
});
