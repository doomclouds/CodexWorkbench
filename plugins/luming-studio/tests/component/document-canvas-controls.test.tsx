import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type StudioClient,
} from '../../src/contracts/studio.js';

const editorAction = vi.hoisted(() => vi.fn());
vi.mock('../../src/app/features/whiteboard/canvas/objects/document/DocumentEditor.js', () => ({
  default: () => (
    <div>
      <textarea aria-label="控件回归编辑器" />
      <div contentEditable suppressContentEditableWarning aria-label="控件回归富文本编辑器">
        正文
      </div>
      <button type="button" aria-label="编辑器内部操作" onClick={editorAction}>
        正文编辑器操作
      </button>
    </div>
  ),
}));
import WhiteboardCanvas from '../../src/app/features/whiteboard/canvas/WhiteboardCanvas.js';

let host: HTMLDivElement;
let root: Root;
const modeChanged = vi.fn();
const annotated = vi.fn();
const changed = vi.fn();
const downloaded = vi.fn();
const board: Board = {
  artifact: {
    id: 'document-controls',
    type: 'whiteboard',
    title: 'Document controls',
    revision: 1,
    pinned: false,
    createdAt: '',
    updatedAt: '',
  },
  style: DEFAULT_STYLE,
  elements: [
    {
      id: 'doc',
      type: 'document',
      text: '文档控件',
      x: 100,
      y: 80,
      w: 600,
      h: 400,
      version: 1,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'paragraph',
            type: 'paragraph',
            props: {},
            content: '普通正文仍然可以添加备注。',
            children: [],
          },
        ],
      },
    },
    { id: 'shape', type: 'shape', text: '普通形状', x: 800, y: 80, w: 160, h: 100, version: 1 },
  ],
};
const client: StudioClient = { embedded: true, call: vi.fn(), downloadFile: downloaded };
const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const doc = () => host.querySelector<HTMLElement>('[data-element-id="doc"]')!;

async function pointer(target: Element, type: string, x = 160, y = 180) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: type === 'click' ? 1 : 0,
    clientX: x,
    clientY: y,
  });
  await act(async () => {
    target.dispatchEvent(event);
    if (type === 'pointerup') {
      target.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    }
  });

  return event;
}

async function clickControl(label: string) {
  const button = query(label);
  const target = button.querySelector('svg') || button;
  await pointer(target, 'pointerdown');
  await pointer(target, 'pointerup');

  return pointer(target, 'click');
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  localStorage.clear();
  modeChanged.mockClear();
  annotated.mockClear();
  changed.mockClear();
  downloaded.mockClear();
  editorAction.mockClear();
  host = document.createElement('div');
  host.className = 'studio';
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [annotationActive, setAnnotationActive] = useState(true);

    return (
      <WhiteboardCanvas
        board={board}
        actor={LOCAL_ACTOR}
        client={client}
        onChanged={changed}
        onAnnotate={() => {}}
        onAnnotateNative={annotated}
        annotationActive={annotationActive}
        onAnnotationModeChange={(active) => {
          modeChanged(active);
          setAnnotationActive(active);
        }}
        externalViewport={{ x: 0, y: 0, zoom: 1 }}
      />
    );
  }

  await act(async () => root.render(<Harness />));
  await vi.waitFor(() =>
    expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('annotate'),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lets the actual inline document Expand control run in annotation mode and restores that mode on return', async () => {
  const event = await clickControl('展开文档');
  expect(event.defaultPrevented).toBe(false);
  expect(host.querySelector('.studio-document-focus')).not.toBeNull();
  expect(modeChanged).not.toHaveBeenCalledWith(false);
  expect(annotated).not.toHaveBeenCalled();
  const back = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('返回画板'),
  )!;
  await pointer(back, 'pointerdown');
  await pointer(back, 'pointerup');
  await pointer(back, 'click');
  expect(host.querySelector('.studio-document-focus')).toBeNull();
  expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('annotate');
});

it('explicitly leaves annotation mode before expanded editing so body editor controls are not swallowed', async () => {
  await clickControl('编辑文档');
  await vi.waitFor(() => expect(query('控件回归编辑器')).not.toBeNull());
  expect(modeChanged).toHaveBeenCalledWith(false);
  expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('select');
  await clickControl('编辑器内部操作');
  expect(editorAction).toHaveBeenCalledTimes(1);
  expect(annotated).not.toHaveBeenCalled();
});

it('removes the canvas focus target during expanded document reading and writing and restores it on return', async () => {
  const viewport = query('白板画布');
  expect(viewport.getAttribute('tabindex')).toBe('0');
  await clickControl('编辑文档');
  await vi.waitFor(() => expect(query('控件回归富文本编辑器')).not.toBeNull());
  expect(viewport.hasAttribute('tabindex')).toBe(false);
  const editor = query('控件回归富文本编辑器');
  editor.focus();
  viewport.focus();
  expect(document.activeElement).toBe(editor);
  await clickControl('阅读文档');
  expect(viewport.hasAttribute('tabindex')).toBe(false);
  const reader = query('文档正文：文档控件');
  reader.focus();
  viewport.focus();
  expect(document.activeElement).toBe(reader);
  const back = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('返回画板'),
  )!;
  await pointer(back, 'click');
  expect(viewport.getAttribute('tabindex')).toBe('0');
  viewport.focus();
  expect(document.activeElement).toBe(viewport);
});

it('allows the actual document export menu and JSON action while annotation mode remains active', async () => {
  await clickControl('导出文档');
  const item = host.querySelector<HTMLElement>('[role="menuitem"]:last-child');
  expect(item?.textContent).toBe('块 JSON');
  await pointer(item!, 'pointerdown');
  await pointer(item!, 'pointerup');
  await pointer(item!, 'click');
  expect(downloaded).toHaveBeenCalledTimes(1);
  expect(downloaded.mock.calls[0]?.[1]).toBe('文档控件.json');
  expect(modeChanged).not.toHaveBeenCalledWith(false);
  expect(annotated).not.toHaveBeenCalled();
});

it('routes unselected document paragraphs to semantic comments and keeps other objects as whole-object targets', async () => {
  const body = doc().querySelector('[data-document-block-id="paragraph"]')!;
  await pointer(body, 'pointerdown');
  await pointer(body, 'pointerup');
  await pointer(body, 'click');
  expect(annotated).toHaveBeenLastCalledWith(
    expect.objectContaining({
      anchor: expect.objectContaining({
        coordinateSpace: 'document',
        elementIds: ['doc'],
        blockIds: ['paragraph'],
      }),
    }),
  );
  const shape = host.querySelector('[data-element-id="shape"]')!;
  await pointer(shape, 'pointerdown', 840, 100);
  await pointer(shape, 'pointerup', 840, 100);
  await pointer(shape, 'click', 840, 100);
  expect(annotated).toHaveBeenCalledTimes(2);
  expect(annotated).toHaveBeenLastCalledWith(
    expect.objectContaining({ anchor: expect.objectContaining({ elementIds: ['shape'] }) }),
  );
  expect(changed).not.toHaveBeenCalled();
});

it('does not turn a plain body double-click into editing while annotation mode is active', async () => {
  const body = doc().querySelector('[data-document-block-id="paragraph"]')!;
  await pointer(body, 'dblclick');
  expect(modeChanged).not.toHaveBeenCalledWith(false);
  expect(query('控件回归编辑器')).toBeNull();
  expect(doc().querySelector('.studio-document-region')?.classList.contains('is-interactive')).toBe(
    false,
  );
});

it('routes actual document reading zoom keys to canvas inline and consumes them after expansion', async () => {
  await act(async () =>
    root.render(
      <WhiteboardCanvas
        board={board}
        actor={LOCAL_ACTOR}
        client={client}
        onChanged={changed}
        onAnnotate={() => {}}
        externalViewport={{ x: 0, y: 0, zoom: 0.5 }}
        externalSelectedIds={['doc']}
      />,
    ),
  );
  const pressZoom = async () => {
    const event = new KeyboardEvent('keydown', {
      key: '=',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => query('文档正文：文档控件').dispatchEvent(event));

    return event;
  };

  expect((await pressZoom()).defaultPrevented).toBe(true);
  expect(host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform).toContain(
    'scale(0.6)',
  );
  await clickControl('展开文档');
  const before = host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform;
  expect((await pressZoom()).defaultPrevented).toBe(true);
  expect(host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform).toBe(before);
});

it.each([{ ctrlKey: true }, { metaKey: true }])(
  'keeps expanded editor, title and find fields at the document scale without stealing their printable or edit keys: %j',
  async (command) => {
    await clickControl('编辑文档');
    await vi.waitFor(() => expect(query('控件回归富文本编辑器')).not.toBeNull());
    const before = host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform;
    const press = async (target: Element, key: string, extra: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      await act(async () => target.dispatchEvent(event));

      return event;
    };

    for (const target of [query('控件回归富文本编辑器'), query('文档标题'), query('文档内查找')]) {
      target.focus();
      for (const key of ['+', '=', '-', '0']) {
        expect((await press(target, key, command)).defaultPrevented).toBe(true);
      }

      expect((await press(target, '@', { shiftKey: true, code: 'Digit2' })).defaultPrevented).toBe(
        false,
      );
      expect((await press(target, 'b', command)).defaultPrevented).toBe(false);
      expect((await press(target, '=', { ...command, isComposing: true })).defaultPrevented).toBe(
        false,
      );
    }

    await clickControl('导出文档');
    expect(query('文档导出格式')).not.toBeNull();
    expect((await press(query('文档标题'), '=', command)).defaultPrevented).toBe(true);
    const otherField = document.createElement('input');
    query('白板画布').append(otherField);
    const externalField = document.createElement('input');
    document.body.append(externalField);
    expect((await press(otherField, '=', command)).defaultPrevented).toBe(false);
    expect((await press(externalField, '=', command)).defaultPrevented).toBe(false);
    externalField.remove();
    expect(host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform).toBe(before);
    expect(changed).not.toHaveBeenCalled();
  },
);
