import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WhiteboardCanvas from '../../src/app/features/whiteboard/canvas/WhiteboardCanvas.js';
import {
  LOCAL_ACTOR,
  type Board,
  type StudioClient,
  type Operation,
  type ToolName,
} from '../../src/contracts/studio.js';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { SaveStatus } from '../../src/app/shared/SaveStatus.js';
import type { ProductActivity } from '../../src/app/product-contract.js';

let host: HTMLDivElement;
let root: Root;
let folder: string;
let service: ComposedStudioService;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  folder = await mkdtemp(join(tmpdir(), 'studio-causal-input-'));
  service = createStudioService({ dataRoot: folder });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await service.close();
  await rm(folder, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
const query = (label: string) => host.querySelector(`[aria-label="${label}"]`)!;

async function event(node: Element, type: string, x = 0, y = 0) {
  await act(async () =>
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })),
  );
}

async function input(value: string) {
  await act(async () => {
    const editor = query('编辑文字');
    editor.textContent = value;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

async function setup() {
  const { board } = (await service.execute('artifact_manage', {
    action: 'create',
    title: 'Causal',
    elements: [
      { id: 'one', type: 'shape', x: 0, y: 0, w: 200, h: 100, text: 'original', color: '#0B0B0B' },
      { id: 'two', type: 'text', x: 400, y: 0, w: 100, h: 80, text: 'other' },
    ],
  })) as { board: Board };
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const call = vi.fn(async (name, args) => {
    const receipt = await service.execute(name, args);
    if (name === 'artifact_apply' && ++writes === 1) {
      await blocked;
    }

    return receipt;
  });
  const client = { embedded: true, call } as StudioClient;
  const activity = vi.fn();
  let receive!: (board: Board) => void;
  function Harness() {
    const [value, setValue] = useState(board);
    receive = setValue;

    return (
      <WhiteboardCanvas
        board={value}
        client={client}
        actor={LOCAL_ACTOR}
        onChanged={setValue}
        onAnnotate={() => {}}
        onActivityChange={activity}
        externalViewport={{ x: 0, y: 0, zoom: 1 }}
      />
    );
  }

  await act(async () => root.render(<Harness />));

  return { board, release, call, activity, receive: (value: Board) => receive(value) };
}

async function settled(
  call: ReturnType<typeof vi.fn>,
  expected: number,
  activity: ReturnType<typeof vi.fn>,
) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
    expect(call.mock.calls.filter(([name]) => name === 'artifact_apply')).toHaveLength(expected);
    expect(activity.mock.lastCall?.[0]).toMatchObject({ saving: false, dirty: false });
    expect(host.querySelector('.studio-canvas-error')).toBeNull();
  });
}

it.each(['pending-lock', 'server-rejection'] as const)(
  'cancels only the empty-text deletion session after %s and retains authoritative text and unrelated drafts',
  async (mode) => {
    const { board } = (await service.execute('artifact_manage', {
      action: 'create',
      title: 'Empty deletion cancellation',
      elements: [
        { id: 'text', type: 'text', x: 20, y: 30, w: 300, h: 100, text: 'authoritative original' },
        { id: 'other', type: 'note', x: 500, y: 30, w: 200, h: 100, text: 'other draft' },
      ],
    })) as { board: Board };
    const lockAck = deferred<void>();
    let receive!: (value: Board) => void;
    let lockWritten = false;
    const call = vi.fn(async (name: ToolName, args: Record<string, unknown> = {}) => {
      const operations = args.operations as Operation[] | undefined;
      if (name === 'artifact_apply' && operations?.some((operation) => operation.id === 'other')) {
        throw new Error('Other property failed');
      }

      if (
        name === 'artifact_apply' &&
        mode === 'server-rejection' &&
        operations?.some((operation) => operation.op === 'delete' && operation.id === 'text')
      ) {
        const current = (await service.execute('artifact_read', {
          artifactId: board.artifact.id,
        })) as Board;
        const { board: locked } = (await service.execute('artifact_apply', {
          artifactId: board.artifact.id,
          operationId: crypto.randomUUID(),
          expectedVersions: {
            text: current.elements.find((element) => element.id === 'text')!.version,
          },
          operations: [{ op: 'update', id: 'text', changes: { locked: true } }],
        })) as { board: Board };
        receive(locked);
      }

      const receipt = await service.execute(name, args);
      if (
        name === 'artifact_apply' &&
        mode === 'pending-lock' &&
        operations?.some(
          (operation) => operation.id === 'text' && operation.changes?.locked === true,
        )
      ) {
        lockWritten = true;
        await lockAck.promise;
      }

      return receipt;
    });
    const client: StudioClient = {
      embedded: true,
      async call<T>(name: ToolName, args?: Record<string, unknown>) {
        return (await call(name, args ?? {})) as T;
      },
    };
    const viewport = { x: 0, y: 0, zoom: 1 };
    function Harness() {
      const [value, setValue] = useState(board);
      receive = setValue;

      return (
        <WhiteboardCanvas
          board={value}
          client={client}
          actor={LOCAL_ACTOR}
          onChanged={(next) =>
            setValue((previous) =>
              next.artifact.revision >= previous.artifact.revision ? next : previous,
            )
          }
          onAnnotate={() => {}}
          externalViewport={viewport}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    if (mode === 'server-rejection') {
      await event(host.querySelector('[data-element-id="other"]')!, 'pointerdown');
      await event(query('白板画布'), 'pointerup');
      await event(query('文字颜色'), 'click');
      await event(query('墨色 蓝色'), 'click');
      await until(() => expect(host.textContent).toContain('Other property failed'));
      await event(query('文字颜色'), 'click');
    }

    await event(host.querySelector('[data-element-id="text"]')!, 'pointerdown');
    await event(query('白板画布'), 'pointerup');
    if (mode === 'pending-lock') {
      await event(query('锁定元素'), 'click');
      await until(() => expect(lockWritten).toBe(true));
    }

    await act(async () =>
      query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F2' })),
    );
    await input('');
    await act(async () =>
      query('编辑文字').dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
      ),
    );

    if (mode === 'pending-lock') {
      expect(host.querySelector('[data-element-id="text"]')).not.toBeNull();
      await act(async () => lockAck.resolve());
      await until(() => expect(query('取消本次文字编辑')).not.toBeNull());
      const operations = call.mock.calls.flatMap(([name, args]) => {
        if (name !== 'artifact_apply') {
          return [];
        }
        if (!args) {
          throw new Error('artifact_apply must receive test arguments');
        }

        return args.operations as Operation[];
      });
      expect(operations.some((operation) => operation.op === 'delete')).toBe(false);
    } else {
      await until(() => expect(query('取消本次文字编辑')).not.toBeNull());
    }

    await event(query('取消本次文字编辑'), 'click');
    expect(host.querySelector('[data-element-id="text"]')?.textContent).toContain(
      'authoritative original',
    );
    expect(query('编辑文字')).toBeNull();
    const canonical = (await service.execute('artifact_read', {
      artifactId: board.artifact.id,
    })) as Board;
    expect(canonical.elements.find((element) => element.id === 'text')).toMatchObject({
      text: 'authoritative original',
      locked: true,
    });

    if (mode === 'server-rejection') {
      expect(host.textContent).toContain('Other property failed');
      expect(host.querySelectorAll('.studio-canvas-error button').length).toBeGreaterThan(1);
      await event(host.querySelector('[data-element-id="other"]')!, 'pointerdown');
      await event(query('白板画布'), 'pointerup');
      await event(query('文字颜色'), 'click');
      expect(query('墨色 蓝色').getAttribute('aria-pressed')).toBe('true');
    } else {
      expect(host.querySelector('.studio-canvas-error')).toBeNull();
    }
  },
);

it.each([
  [['蓝色', '绿色', '蓝色'], '#2F7CC4'],
  [['蓝色', '墨色'], '#0B0B0B'],
] as const)(
  'persists fast %j intent through real service writes while the first ACK is delayed',
  async (colors, expected) => {
    const { board, release, call, activity } = await setup();
    await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
    await event(query('白板画布'), 'pointerup');
    await event(query('文字颜色'), 'click');
    for (const color of colors) {
      await event(query(`墨色 ${color}`), 'click');
    }

    expect(call.mock.calls.filter(([name]) => name === 'artifact_apply')).toHaveLength(1);
    await act(async () => release());
    await settled(call, colors.length, activity);
    const latest = (await service.execute('artifact_read', {
      artifactId: board.artifact.id,
    })) as Board;
    expect(latest.elements[0]!.color).toBe(expected);
  },
);

it('persists deleting live input back to its original value while an earlier text ACK is delayed', async () => {
  const { board, release, call, activity } = await setup();
  await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
  await input('temporary');
  await act(async () =>
    query('编辑文字').dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
  );
  await input('original');
  await act(async () =>
    query('编辑文字').dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
  );
  await act(async () => release());
  await settled(call, 2, activity);
  const latest = (await service.execute('artifact_read', {
    artifactId: board.artifact.id,
  })) as Board;
  expect(latest.elements[0]!.text).toBe('original');
});

it.each([false, true])(
  'retains undo across a remote revision and protects later same-field edits=%s',
  async (sameField) => {
    const { board, release, call, activity, receive } = await setup();
    release();
    await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
    await event(query('白板画布'), 'pointerup');
    await event(query('文字颜色'), 'click');
    await event(query('墨色 蓝色'), 'click');
    await settled(call, 1, activity);
    const current = (await service.execute('artifact_read', {
      artifactId: board.artifact.id,
    })) as Board;
    const target = current.elements.find((element) => element.id === (sameField ? 'one' : 'two'))!;
    const { board: remote } = (await service.execute(
      'artifact_apply',
      {
        artifactId: board.artifact.id,
        operationId: crypto.randomUUID(),
        expectedVersions: { [target.id]: target.version },
        operations: [
          {
            op: 'update',
            id: target.id,
            changes: sameField ? { color: '#2E8B57' } : { text: 'remote survives' },
          },
        ],
      },
      { ...LOCAL_ACTOR, id: 'remote', role: 'editor' },
    )) as { board: Board };
    await act(async () => receive(remote));
    await event(query('缩放菜单'), 'click');
    expect((query('撤销') as HTMLButtonElement).disabled).toBe(false);
    await event(query('撤销'), 'click');
    if (sameField) {
      await until(() =>
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法撤销'),
      );
      expect(activity.mock.lastCall?.[0].saveError).toBe('');
    } else {
      await settled(call, 2, activity);
    }

    const latest = (await service.execute('artifact_read', {
      artifactId: board.artifact.id,
    })) as Board;
    expect(latest.elements.find((element) => element.id === 'one')!.color).toBe(
      sameField ? '#2E8B57' : '#0B0B0B',
    );

    if (!sameField) {
      expect(latest.elements.find((element) => element.id === 'two')!.text).toBe('remote survives');
    }
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function until(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
    check();
  });
}

const mediaWrite = (args: Record<string, unknown>) =>
  (args.operations as Operation[]).some(
    (operation) => operation.op === 'add' && operation.element?.type === 'image',
  );
const file = (name = 'clip.mp4') => new File(['video'], name, { type: 'video/mp4' });
const saveStatus = () => host.querySelector<HTMLElement>('[data-save-status]')!.dataset.saveStatus;
const textButton = (text: string) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent === text)!;

async function drop(files: File[], x = 160, y = 190) {
  await act(async () => {
    const event = new MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
    query('白板画布').dispatchEvent(event);
  });
}

async function setupUpload(
  request: StudioClient['request'],
  afterWrite?: (args: Record<string, unknown>) => Promise<void>,
) {
  const { board } = (await service.execute('artifact_manage', {
    action: 'create',
    title: 'Upload interleaving',
    elements: [
      { id: 'one', type: 'note', x: 0, y: 0, w: 200, h: 100, text: 'note', color: '#0B0B0B' },
    ],
  })) as { board: Board };
  const call = vi.fn(async (name, args) => {
    const receipt = await service.execute(name, args);
    if (name === 'artifact_apply') {
      await afterWrite?.(args!);
    }

    return receipt;
  }) as ReturnType<typeof vi.fn>;
  const client: StudioClient = {
    embedded: false,
    baseUrl: 'http://studio.local',
    token: '',
    call: call as StudioClient['call'],
    request,
  };
  const activity = vi.fn();
  const initialViewport = { x: 0, y: 0, zoom: 1 };
  let setReadonly!: (value: boolean) => void;
  let receive!: (value: Board) => void;
  function Harness() {
    const [value, setValue] = useState(board);
    const [readOnly, setReadOnly] = useState(false);
    const [state, setState] = useState<ProductActivity>({
      editingIds: [],
      movingIds: [],
      dirty: false,
    });
    receive = setValue;
    setReadonly = setReadOnly;

    return (
      <>
        <SaveStatus activity={state} sync="saved" session="valid" canEdit={!readOnly} />
        <WhiteboardCanvas
          key={value.artifact.id}
          board={value}
          client={client}
          actor={LOCAL_ACTOR}
          readOnly={readOnly}
          onChanged={(next) =>
            setValue((previous) =>
              previous.artifact.id === next.artifact.id &&
              next.artifact.revision >= previous.artifact.revision
                ? next
                : previous,
            )
          }
          onAnnotate={() => {}}
          onActivityChange={(next) => {
            activity(next);
            setState(next);
          }}
          externalViewport={initialViewport}
        />
      </>
    );
  }

  await act(async () => root.render(<Harness />));

  return {
    board,
    call,
    activity,
    readonly: (value: boolean) => setReadonly(value),
    receive: (value: Board) => receive(value),
  };
}

it.each([
  ['picked.png', 'image/png'],
  ['picked.mp4', 'video/mp4'],
])(
  'snapshots the live input FileList before clearing %s across a tool-switch await',
  async (name, type) => {
    const request = vi.fn().mockResolvedValue(Response.json({ src: `/assets/${name}` }));
    const { board, call } = await setupUpload(request);
    await event(query('贴纸'), 'click');
    const input = host.querySelector<HTMLInputElement>('input[type="file"][accept^="image/"]')!;
    const picked = new File(['media'], name, { type });
    const entries = [picked];
    const live = {
      get length() {
        return entries.length;
      },
      item: (index: number) => entries[index] ?? null,
      [Symbol.iterator]: () => entries.values(),
    } as FileList;
    Object.defineProperty(input, 'files', { configurable: true, get: () => live });
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value.get!.call(input),
      set: (next) => {
        value.set!.call(input, next);
        if (next === '') {
          entries.splice(0);
        }
      },
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(live.length).toBe(0);
    await until(() => expect(request).toHaveBeenCalledTimes(1));
    await until(() => expect(saveStatus()).toBe('saved'));
    expect(request.mock.calls[0]![1].body).toBe(picked);
    const writes = call.mock.calls.filter(([name]) => name === 'artifact_apply');
    expect(writes).toHaveLength(1);
    expect(writes[0]![1].operations).toHaveLength(1);
    const canonical = (await service.execute('artifact_read', {
      artifactId: board.artifact.id,
    })) as Board;
    const media = canonical.elements.find((element) => element.type === 'image')!;
    expect(media[type.startsWith('video/') ? 'video' : 'src']).toBe(`/assets/${name}`);
    expect(
      host.querySelector(`[data-element-id="${media.id}"]`)?.classList.contains('is-selected'),
    ).toBe(true);
    expect(query('选择').getAttribute('aria-pressed')).toBe('true');
  },
);

it('keeps unrelated edit, pan, resize, rotate and creation available during an asset upload and combines both save lifetimes', async () => {
  const asset = deferred<Response>();
  const mediaAck = deferred<void>();
  const noteAck = deferred<void>();
  const request = vi.fn().mockReturnValue(asset.promise);
  const { board, call, activity } = await setupUpload(request, async (args) => {
    if (mediaWrite(args)) {
      await mediaAck.promise;
    }
    if ((args.operations as Operation[]).some((operation) => operation.changes?.italic === true)) {
      await noteAck.promise;
    }
  });
  await drop([file()]);
  const placeholderId = host.querySelector<HTMLElement>('[data-upload-placeholder]')!.dataset
    .uploadPlaceholder;
  expect(saveStatus()).toBe('saving');
  const activityStart = activity.mock.calls.length - 1;
  await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
  await event(query('白板画布'), 'pointerup');
  expect((query('加粗') as HTMLButtonElement).disabled).toBe(false);
  await event(query('加粗'), 'click');
  await until(() => expect(activity.mock.lastCall?.[0].editingIds).toEqual([]));
  expect(saveStatus()).toBe('saving');
  await event(query('平移'), 'click');
  await event(query('白板画布'), 'pointerdown', 10, 10);
  await event(query('白板画布'), 'pointermove', 60, 40);
  await event(query('白板画布'), 'pointerup', 60, 40);
  expect((host.querySelector('.studio-canvas-world') as HTMLElement).style.transform).toContain(
    'translate(50px,30px)',
  );
  expect((host.querySelector('[data-upload-placeholder]') as HTMLElement).style.left).toBe('160px');
  await event(query('选择'), 'click');
  await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
  await event(query('白板画布'), 'pointerup');
  await event(query('调整元素大小 e'), 'pointerdown', 250, 80);
  await event(query('白板画布'), 'pointermove', 300, 80);
  await event(query('白板画布'), 'pointerup', 300, 80);
  await until(() => expect(activity.mock.lastCall?.[0].editingIds).toEqual([]));
  await event(query('旋转所选元素 ne'), 'pointerdown', 300, 30);
  await event(query('白板画布'), 'pointermove', 300, 180);
  await event(query('白板画布'), 'pointerup', 300, 180);
  await until(() => expect(activity.mock.lastCall?.[0].editingIds).toEqual([]));
  await event(query('形状'), 'click');
  await event(query('白板画布'), 'pointerdown', 750, 600);
  await event(query('白板画布'), 'pointerup', 750, 600);
  await until(() =>
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-element-id].is-selected')].some(
        (node) => node.dataset.elementId !== 'one',
      ),
    ).toBe(true),
  );
  expect(query('编辑文字')).toBeNull();
  const edited = (await service.execute('artifact_read', {
    artifactId: board.artifact.id,
  })) as Board;
  expect(edited.elements.find((element) => element.id === 'one')).toMatchObject({
    bold: true,
    w: 250,
  });
  expect(typeof edited.elements.find((element) => element.id === 'one')!.rotation).toBe('number');
  expect(edited.elements.find((element) => element.id === 'one')!.rotation).not.toBe(0);
  expect(edited.elements.filter((element) => element.type === 'shape')).toHaveLength(1);
  await act(async () => asset.resolve(Response.json({ src: '/assets/clip.mp4' })));
  await until(() => expect(host.querySelector('[data-upload-phase="queued"]')).not.toBeNull());
  expect(saveStatus()).toBe('saving');
  await event(query('选择'), 'click');
  await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
  await event(query('白板画布'), 'pointerup');
  expect((query('斜体') as HTMLButtonElement).disabled).toBe(false);
  await event(query('斜体'), 'click');
  await until(() =>
    expect(
      call.mock.calls.some(([, args]) =>
        (args.operations as Operation[]).some((operation) => operation.changes?.italic === true),
      ),
    ).toBe(true),
  );
  await act(async () => mediaAck.resolve());
  await until(() => expect(host.querySelector('[data-upload-placeholder]')).toBeNull());
  expect(saveStatus()).toBe('saving');
  expect(activity.mock.calls.slice(activityStart).every(([state]) => state.saving)).toBe(true);
  await act(async () => noteAck.resolve());
  await until(() => expect(saveStatus()).toBe('saved'));
  const final = (await service.execute('artifact_read', {
    artifactId: board.artifact.id,
  })) as Board;
  expect(final.elements.find((element) => element.type === 'image')).toMatchObject({
    id: placeholderId,
    x: 160,
    y: 190,
    video: '/assets/clip.mp4',
  });
  expect(final.elements.find((element) => element.id === 'one')!.italic).toBe(true);
});

it('selects the persisted uploaded media and returns the placement tool to selection', async () => {
  const { board } = await setupUpload(
    vi.fn().mockResolvedValue(Response.json({ src: '/assets/placed.mp4' })),
  );
  await event(query('贴纸'), 'click');
  await drop([file()]);
  await until(() => expect(saveStatus()).toBe('saved'));
  const saved = (await service.execute('artifact_read', {
    artifactId: board.artifact.id,
  })) as Board;
  const media = saved.elements.find((element) => element.type === 'image')!;
  expect(query('选择').getAttribute('aria-pressed')).toBe('true');
  expect(
    host.querySelector(`[data-element-id="${media.id}"]`)?.classList.contains('is-selected'),
  ).toBe(true);
  expect(host.querySelectorAll('.studio-selection-corner')).toHaveLength(4);
});

it.each(['tool', 'selection', 'deleted'] as const)(
  'does not replace a later %s intent when an uploaded reference receipt arrives',
  async (mode) => {
    const referenceAck = deferred<void>();
    let referenceWritten = false;
    const { board, receive } = await setupUpload(
      vi.fn().mockResolvedValue(Response.json({ src: '/assets/late.mp4' })),
      async (args) => {
        if (mediaWrite(args)) {
          referenceWritten = true;
          await referenceAck.promise;
        }
      },
    );
    await drop([file()]);
    await until(() => expect(referenceWritten).toBe(true));
    const accepted = (await service.execute('artifact_read', {
      artifactId: board.artifact.id,
    })) as Board;
    const media = accepted.elements.find((element) => element.type === 'image')!;
    if (mode === 'tool') {
      await event(query('平移'), 'click');
    } else if (mode === 'selection') {
      await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
      await event(query('白板画布'), 'pointerup');
    } else {
      const { board: deleted } = (await service.execute('artifact_apply', {
        artifactId: board.artifact.id,
        operationId: crypto.randomUUID(),
        expectedVersions: { [media.id]: media.version },
        operations: [{ op: 'delete', id: media.id }],
      })) as { board: Board };
      await act(async () => receive(deleted));
    }

    await act(async () => referenceAck.resolve());
    await until(() => expect(saveStatus()).toBe('saved'));
    if (mode === 'tool') {
      expect(query('平移').getAttribute('aria-pressed')).toBe('true');
    }
    if (mode === 'selection') {
      expect(host.querySelector('[data-element-id="one"]')?.classList.contains('is-selected')).toBe(
        true,
      );
    }
    if (mode === 'deleted') {
      expect(host.querySelector(`[data-element-id="${media.id}"]`)).toBeNull();
    } else {
      expect(
        host.querySelector(`[data-element-id="${media.id}"]`)?.classList.contains('is-selected'),
      ).toBe(false);
    }
  },
);

it('retries only unfinished assets and replays a lost reference receipt with the same element ids, position and operation id', async () => {
  const referenceAck = deferred<void>();
  let mediaAttempts = 0;
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ src: '/assets/first.mp4' }))
    .mockRejectedValueOnce(new Error('Second asset failed'))
    .mockResolvedValueOnce(Response.json({ src: '/assets/second.mp4' }));
  const { board, call } = await setupUpload(request, async (args) => {
    if (mediaWrite(args) && ++mediaAttempts === 1) {
      await referenceAck.promise;
      throw new Error('Reference response lost');
    }
  });
  await drop([file('first.mp4'), file('second.mp4')], 210, 310);
  await until(() => expect(host.querySelector('[data-upload-phase="failed"]')).not.toBeNull());
  const ids = [...host.querySelectorAll<HTMLElement>('[data-upload-placeholder]')].map(
    (node) => node.dataset.uploadPlaceholder,
  );
  expect(saveStatus()).toBe('error');
  await event(textButton('重试加入白板'), 'click');
  await until(() => expect(host.querySelector('[data-upload-phase="queued"]')).not.toBeNull());
  expect(request).toHaveBeenCalledTimes(3);
  expect(
    request.mock.calls.map(([, init]) => decodeURIComponent(init.headers['X-Filename'])),
  ).toEqual(['first.mp4', 'second.mp4', 'second.mp4']);
  await act(async () => referenceAck.resolve());
  await until(() => expect(host.querySelector('[data-upload-phase="failed"]')).not.toBeNull());
  await event(textButton('重试加入白板'), 'click');
  await until(() => expect(saveStatus()).toBe('saved'));
  const writes = call.mock.calls.filter(([, args]) => mediaWrite(args));
  expect(writes).toHaveLength(2);
  expect(writes[1]![1]).toEqual(writes[0]![1]);
  expect(request).toHaveBeenCalledTimes(3);
  const final = (await service.execute('artifact_read', {
    artifactId: board.artifact.id,
  })) as Board;
  const images = final.elements.filter((element) => element.type === 'image');
  expect(images.map((element) => element.id)).toEqual(ids);
  expect(images.map((element) => [element.x, element.y])).toEqual([
    [210, 310],
    [242, 342],
  ]);
});

it('retains uploaded references during a read-only transition and waits for an explicit retry after editing returns', async () => {
  const asset = deferred<Response>();
  const request = vi.fn().mockReturnValue(asset.promise);
  const { call, readonly } = await setupUpload(request);
  await drop([file()], 80, 120);
  const id = host.querySelector<HTMLElement>('[data-upload-placeholder]')!.dataset
    .uploadPlaceholder;
  await act(async () => readonly(true));
  await act(async () => asset.resolve(Response.json({ src: '/assets/ready.mp4' })));
  await until(() => expect(host.querySelector('[data-upload-phase="failed"]')).not.toBeNull());
  expect(call).not.toHaveBeenCalled();
  expect((textButton('重试加入白板') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => readonly(false));
  expect(call).not.toHaveBeenCalled();
  await event(textButton('重试加入白板'), 'click');
  await until(() => expect(saveStatus()).toBe('saved'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![1].operations[0].element).toMatchObject({
    id,
    x: 80,
    y: 120,
    video: '/assets/ready.mp4',
  });
});

it('aborts the departing board upload and prevents its late response from creating an element in either board', async () => {
  const oldAsset = deferred<Response>();
  const request = vi
    .fn()
    .mockReturnValueOnce(oldAsset.promise)
    .mockResolvedValue(Response.json({ src: '/assets/new.mp4' }));
  const { board, call, receive } = await setupUpload(request);
  await drop([file('old.mp4')]);
  const { board: next } = (await service.execute('artifact_manage', {
    action: 'create',
    title: 'Next board',
  })) as { board: Board };
  await act(async () => receive(next));
  expect(request.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(host.querySelector('[data-upload-placeholder]')).toBeNull();
  await act(async () => oldAsset.resolve(Response.json({ src: '/assets/old.mp4' })));
  expect(call).not.toHaveBeenCalled();
  await drop([file('new.mp4')]);
  await until(() => expect(saveStatus()).toBe('saved'));
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![1].artifactId).toBe(next.artifact.id);
  expect(
    (
      (await service.execute('artifact_read', { artifactId: board.artifact.id })) as Board
    ).elements.filter((element) => element.type === 'image'),
  ).toHaveLength(0);
});
