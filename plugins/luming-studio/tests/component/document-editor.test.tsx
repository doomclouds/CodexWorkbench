import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentBlock, DocumentContent } from '../../src/contracts/document.js';

const state = vi.hoisted(() => ({
  viewChange: undefined as (() => void) | undefined,
  editor: {
    document: [] as DocumentBlock[],
    replaceBlocks: vi.fn(),
    focus: vi.fn(),
    getBlock: vi.fn(),
    insertBlocks: vi.fn(),
    setTextCursorPosition: vi.fn(),
    getSelectedText: () => '',
    getSelection: () => null,
    getTextCursorPosition: () => ({ block: { id: 'p' } }),
  },
}));
vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: {
    create: () => ({ blockSchema: {}, inlineContentSchema: {}, styleSchema: {} }),
  },
  createHeadingBlockSpec: () => ({}),
  defaultBlockSpecs: {},
}));
vi.mock('@blocknote/core/locales', () => ({ zh: {} }));
vi.mock('@blocknote/react', () => ({ useCreateBlockNote: () => state.editor }));
vi.mock('@blocknote/ariakit', () => ({
  BlockNoteView: ({ onChange }: { onChange: () => void }) => {
    state.viewChange = onChange;

    return <div contentEditable suppressContentEditableWarning aria-label="组合输入目标" />;
  },
}));
import DocumentEditor from '../../src/app/features/whiteboard/canvas/objects/document/DocumentEditor.js';

const documentValue = (text: string): DocumentContent => ({
  schemaVersion: 1,
  blocks: [{ id: 'p', type: 'paragraph', props: {}, content: text, children: [] }],
});
let host: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof DocumentEditor>;
let frame: FrameRequestCallback | null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frame = null;
  state.viewChange = undefined;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;

      return 1;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn(() => {
      frame = null;
    }),
  );
  state.editor.document = documentValue('原文').blocks;
  state.editor.focus.mockReset();
  state.editor.replaceBlocks.mockReset().mockImplementation((_before, after) => {
    state.editor.document = after;
  });
  state.editor.getBlock
    .mockReset()
    .mockImplementation((id) => state.editor.document.find((block) => block.id === id));
  state.editor.setTextCursorPosition.mockReset();
  state.editor.insertBlocks
    .mockReset()
    .mockReturnValue([
      { id: 'new-paragraph', type: 'paragraph', props: {}, content: [], children: [] },
    ]);
  props = {
    value: documentValue('原文'),
    editable: true,
    theme: 'light',
    onChange: vi.fn(),
    onSelection: vi.fn(),
    onCompositionChange: vi.fn(),
    uploadFile: vi.fn(),
    resolveFileUrl: vi.fn(),
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<DocumentEditor {...props} />));
const composition = (type: string) =>
  act(async () =>
    host
      .querySelector('[contenteditable]')!
      .dispatchEvent(new CompositionEvent(type, { bubbles: true })),
  );

function preparePaper() {
  host.className = 'studio-document-scroll';
  Object.defineProperties(host, {
    offsetWidth: { configurable: true, value: 400 },
    offsetHeight: { configurable: true, value: 400 },
    clientWidth: { configurable: true, value: 380 },
    clientHeight: { configurable: true, value: 380 },
  });
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 50,
    right: 900,
    bottom: 850,
    width: 800,
    height: 800,
  } as DOMRect);
}

async function paperPointer(target: Element = host, init: MouseEventInit = {}) {
  const event = new MouseEvent('pointerdown', {
    button: 0,
    clientX: 500,
    clientY: 650,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => target.dispatchEvent(event));

  return event;
}

it('focuses the ready editor on entry without stealing focus again for normal value updates', async () => {
  await render();
  expect(state.editor.focus).toHaveBeenCalledTimes(1);
  props = { ...props, value: documentValue('远程已保存值') };
  await render();
  expect(state.editor.focus).toHaveBeenCalledTimes(1);
  props = { ...props, editable: false };
  await render();
  expect(state.editor.focus).toHaveBeenCalledTimes(1);
  props = { ...props, editable: true };
  await render();
  expect(state.editor.focus).toHaveBeenCalledTimes(2);
});

it('places a double-click entry at the requested block end before focusing and consumes the target once', async () => {
  props = { ...props, initialFocusBlockId: 'p' };
  await render();
  expect(state.editor.setTextCursorPosition).toHaveBeenCalledExactlyOnceWith('p', 'end');
  expect(state.editor.setTextCursorPosition.mock.invocationCallOrder[0]).toBeLessThan(
    state.editor.focus.mock.invocationCallOrder[0]!,
  );
  props = { ...props, value: documentValue('用户继续输入') };
  await render();
  props = { ...props, editable: false };
  await render();
  props = { ...props, editable: true };
  await render();
  expect(state.editor.setTextCursorPosition).toHaveBeenCalledTimes(1);
  expect(state.editor.focus).toHaveBeenCalledTimes(2);
});

it('does not ask BlockNote to position a cursor in a block that disappeared before the editor mounted', async () => {
  props = { ...props, initialFocusBlockId: 'removed-block' };
  await render();
  expect(state.editor.setTextCursorPosition).not.toHaveBeenCalled();
  expect(state.editor.focus).toHaveBeenCalledTimes(1);
});

it('focuses editable paper whitespace at the last text block without owning read-only paper', async () => {
  preparePaper();
  props = {
    ...props,
    value: {
      schemaVersion: 1,
      blocks: [
        {
          ...documentValue('上文').blocks[0]!,
          children: [
            { id: 'nested-tail', type: 'paragraph', props: {}, content: '文末', children: [] },
          ],
        },
      ],
    },
  };
  state.editor.document = props.value.blocks;
  await render();
  state.editor.focus.mockClear();
  state.editor.setTextCursorPosition.mockClear();
  expect((await paperPointer()).defaultPrevented).toBe(true);
  expect(state.editor.setTextCursorPosition).toHaveBeenCalledExactlyOnceWith('nested-tail', 'end');
  expect(state.editor.focus).toHaveBeenCalledTimes(1);
  state.editor.document = [
    {
      id: 'last-image',
      type: 'image',
      props: { url: 'https://example.com/image.png' },
      children: [],
    },
  ];
  await paperPointer();
  expect(state.editor.insertBlocks).toHaveBeenCalledWith(
    [{ type: 'paragraph' }],
    'last-image',
    'after',
  );
  expect(state.editor.setTextCursorPosition).toHaveBeenLastCalledWith('new-paragraph', 'end');
  props = { ...props, editable: false };
  await render();
  state.editor.focus.mockClear();
  state.editor.setTextCursorPosition.mockClear();
  expect((await paperPointer()).defaultPrevented).toBe(false);
  expect(state.editor.focus).not.toHaveBeenCalled();
  expect(state.editor.setTextCursorPosition).not.toHaveBeenCalled();
});

it('leaves scrollbar gutters, native controls, mouse navigation and active composition out of blank-paper focus', async () => {
  preparePaper();
  await render();
  state.editor.focus.mockClear();
  state.editor.setTextCursorPosition.mockClear();
  for (const init of [
    { clientX: 890 },
    { clientY: 840 },
    { button: 1 },
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ]) {
    expect((await paperPointer(host, init)).defaultPrevented).toBe(false);
  }

  const controls = window.document.createElement('div');
  controls.innerHTML =
    '<button>工具</button><a href="https://example.com">链接</a><input><textarea></textarea><select><option>选择</option></select><div role="menu"><span>菜单</span></div><div contenteditable="true"><span contenteditable="false">原生编辑器区域</span></div>';
  host.append(controls);
  for (const target of controls.querySelectorAll(
    'button,a,input,textarea,select,[role=menu] span,[contenteditable=false]',
  )) {
    expect((await paperPointer(target)).defaultPrevented).toBe(false);
  }

  const touch = new MouseEvent('pointerdown', {
    button: 0,
    clientX: 500,
    clientY: 650,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  await act(async () => host.dispatchEvent(touch));
  expect(touch.defaultPrevented).toBe(false);
  const cancelled = new MouseEvent('pointerdown', {
    button: 0,
    clientX: 500,
    clientY: 650,
    bubbles: true,
    cancelable: true,
  });
  cancelled.preventDefault();
  await act(async () => host.dispatchEvent(cancelled));
  await composition('compositionstart');
  expect((await paperPointer()).defaultPrevented).toBe(false);
  expect(state.editor.focus).not.toHaveBeenCalled();
  expect(state.editor.setTextCursorPosition).not.toHaveBeenCalled();
  await composition('compositionend');
  await act(async () => frame!(0));
  expect((await paperPointer()).defaultPrevented).toBe(true);
  expect(state.editor.focus).toHaveBeenCalledTimes(1);
});

it('preserves the entry block when real BlockNote normalizes raw initial content and only replaces genuine external updates', async () => {
  const { BlockNoteEditor } =
    await vi.importActual<typeof import('@blocknote/core')>('@blocknote/core');
  const blocks = [
    { id: 'wide-p1', type: 'paragraph' as const, props: {}, content: '稳定段落一', children: [] },
    { id: 'wide-tail', type: 'paragraph' as const, props: {}, content: '最后一段', children: [] },
  ];
  const actual = BlockNoteEditor.create({ initialContent: blocks });
  const mount = document.createElement('div');
  document.body.append(mount);
  actual.mount(mount);
  try {
    const sync = () => {
      state.editor.document = actual.document as unknown as DocumentBlock[];
    };

    sync();
    expect(state.editor.document).not.toEqual(blocks);
    state.editor.getBlock.mockImplementation((id) => actual.getBlock(id));
    state.editor.setTextCursorPosition.mockImplementation((id, placement) =>
      actual.setTextCursorPosition(id, placement),
    );
    state.editor.focus.mockImplementation(() => actual.focus());
    state.editor.replaceBlocks.mockImplementation((_before, after) => {
      actual.replaceBlocks(actual.document, after);
      sync();
    });
    props = { ...props, value: { schemaVersion: 1, blocks }, initialFocusBlockId: 'wide-p1' };
    await render();
    expect(actual.getTextCursorPosition().block.id).toBe('wide-p1');
    expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
    props = { ...props, value: structuredClone(props.value) };
    await render();
    expect(actual.getTextCursorPosition().block.id).toBe('wide-p1');
    expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
    props = { ...props, value: { schemaVersion: 1, blocks: state.editor.document } };
    await render();
    expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
    props = {
      ...props,
      value: { schemaVersion: 1, blocks: [{ ...blocks[0]!, content: '外部实际修改' }, blocks[1]!] },
    };
    await render();
    expect(state.editor.replaceBlocks).toHaveBeenCalledTimes(1);
    expect(actual.getBlock('wide-p1')!.content).toEqual([
      { type: 'text', text: '外部实际修改', styles: {} },
    ]);
  } finally {
    actual.unmount();
    mount.remove();
  }
});

it('does not replace newer real BlockNote input with an older value emitted by that same editor', async () => {
  const { BlockNoteEditor } =
    await vi.importActual<typeof import('@blocknote/core')>('@blocknote/core');
  const actual = BlockNoteEditor.create({
    initialContent: [{ id: 'p', type: 'paragraph', content: '三级' }],
  });
  const mount = document.createElement('div');
  document.body.append(mount);
  actual.mount(mount);
  const sync = () => {
    state.editor.document = actual.document as unknown as DocumentBlock[];
  };

  let unsubscribe: (() => void) | undefined;
  try {
    sync();
    props = { ...props, value: { schemaVersion: 1, blocks: state.editor.document } };
    state.editor.focus.mockImplementation(() => actual.focus());
    state.editor.replaceBlocks.mockImplementation((_before, after) => {
      actual.replaceBlocks(actual.document, after);
      sync();
    });
    await render();
    unsubscribe = actual.onChange(() => {
      sync();
      state.viewChange!();
    });
    await act(async () => actual.updateBlock('p', { content: '三级标题' }));
    const firstEcho = vi.mocked(props.onChange).mock.calls[0]![0];
    await act(async () => actual.updateBlock('p', { content: '三级标题验收 · 暗色' }));
    const latestEcho = vi.mocked(props.onChange).mock.calls[1]![0];
    props = { ...props, value: firstEcho };
    await render();
    expect(actual.getBlock('p')!.content).toEqual([
      { type: 'text', text: '三级标题验收 · 暗色', styles: {} },
    ]);
    expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
    props = { ...props, value: latestEcho };
    await render();
    expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
    props = { ...props, value: documentValue('真正的外部更新') };
    await render();
    expect(state.editor.replaceBlocks).toHaveBeenCalledTimes(1);
    expect(actual.getBlock('p')!.content).toEqual([
      { type: 'text', text: '真正的外部更新', styles: {} },
    ]);
    props = { ...props, value: structuredClone(firstEcho) };
    await render();
    expect(state.editor.replaceBlocks).toHaveBeenCalledTimes(2);
    expect(actual.getBlock('p')!.content).toEqual([{ type: 'text', text: '三级标题', styles: {} }]);
  } finally {
    unsubscribe?.();
    actual.unmount();
    mount.remove();
  }
});

it('keeps external replacement out of a composition and flushes the final transaction before releasing its parent', async () => {
  const events: string[] = [];
  props.onChange = vi.fn((value) => events.push(String(value.blocks[0]!.content)));
  props.onCompositionChange = vi.fn((active) => events.push(active ? 'start' : 'end'));
  await render();
  await composition('compositionstart');
  props = { ...props, value: documentValue('外部新内容') };
  await render();
  expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
  state.editor.document = documentValue('组合中的临时内容').blocks;
  await composition('compositionend');
  expect(events).toEqual(['start']);
  state.editor.document = documentValue('最后一次 input 提交的文字').blocks;
  await act(async () => frame!(0));
  expect(events).toEqual(['start', '最后一次 input 提交的文字', 'end']);
  expect(props.onChange).toHaveBeenCalledTimes(1);
  const compositionEcho = vi.mocked(props.onChange).mock.calls[0]![0];
  state.editor.document = documentValue('组合完成后继续输入').blocks;
  await act(async () => state.viewChange!());
  props = { ...props, value: compositionEcho };
  await render();
  expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
  expect(state.editor.document[0]!.content).toBe('组合完成后继续输入');
});

it('does not create a document edit when the composition was cancelled without a text change', async () => {
  await render();
  await composition('compositionstart');
  await composition('compositionend');
  await act(async () => frame!(0));
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onCompositionChange).toHaveBeenLastCalledWith(false);
});
