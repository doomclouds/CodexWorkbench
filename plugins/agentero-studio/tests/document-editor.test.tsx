// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentBlock, DocumentContent } from '../src/contracts/document.js';

const state = vi.hoisted(() => ({ editor: { document: [] as DocumentBlock[], replaceBlocks: vi.fn(), getSelectedText: () => '', getSelection: () => null, getTextCursorPosition: () => ({ block: { id: 'p' } }) } }));
vi.mock('@blocknote/core', () => ({ BlockNoteSchema: { create: () => ({ blockSchema: {}, inlineContentSchema: {}, styleSchema: {} }) }, createHeadingBlockSpec: () => ({}), defaultBlockSpecs: {} }));
vi.mock('@blocknote/core/locales', () => ({ zh: {} }));
vi.mock('@blocknote/react', () => ({ useCreateBlockNote: () => state.editor }));
vi.mock('@blocknote/ariakit', () => ({ BlockNoteView: () => <div contentEditable suppressContentEditableWarning aria-label="组合输入目标" /> }));
import DocumentEditor from '../src/app/canvas/DocumentEditor.js';

const documentValue = (text: string): DocumentContent => ({ schemaVersion: 1, blocks: [{ id: 'p', type: 'paragraph', props: {}, content: text, children: [] }] });
let host: HTMLDivElement, root: Root, props: ComponentProps<typeof DocumentEditor>, frame: FrameRequestCallback | null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); frame = null;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { frame = null; }));
  state.editor.document = documentValue('原文').blocks; state.editor.replaceBlocks.mockReset().mockImplementation((_before, after) => { state.editor.document = after; });
  props = { value: documentValue('原文'), editable: true, theme: 'light', onChange: vi.fn(), onSelection: vi.fn(), onCompositionChange: vi.fn(), uploadFile: vi.fn(), resolveFileUrl: vi.fn() };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<DocumentEditor {...props} />));
const composition = (type: string) => act(async () => host.querySelector('[contenteditable]')!.dispatchEvent(new CompositionEvent(type, { bubbles: true })));

it('keeps external replacement out of a composition and flushes the final transaction before releasing its parent', async () => {
  const events: string[] = []; props.onChange = vi.fn(value => events.push(String(value.blocks[0]!.content))); props.onCompositionChange = vi.fn(active => events.push(active ? 'start' : 'end'));
  await render(); await composition('compositionstart');
  props = { ...props, value: documentValue('外部新内容') }; await render();
  expect(state.editor.replaceBlocks).not.toHaveBeenCalled();
  state.editor.document = documentValue('组合中的临时内容').blocks; await composition('compositionend');
  expect(events).toEqual(['start']);
  state.editor.document = documentValue('最后一次 input 提交的文字').blocks;
  await act(async () => frame!(0));
  expect(events).toEqual(['start', '最后一次 input 提交的文字', 'end']);
});

it('does not create a document edit when the composition was cancelled without a text change', async () => {
  await render(); await composition('compositionstart'); await composition('compositionend'); await act(async () => frame!(0));
  expect(props.onChange).not.toHaveBeenCalled(); expect(props.onCompositionChange).toHaveBeenLastCalledWith(false);
});
