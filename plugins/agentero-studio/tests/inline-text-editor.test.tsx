// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InlineTextEditor, { type InlineTextEditorHandle, type InlineTextEditorProps } from '../src/app/canvas/InlineTextEditor.js';

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(initial: string, props: Partial<InlineTextEditorProps> = {}) {
  const ref = createRef<InlineTextEditorHandle>(), changed = vi.fn(), committed = vi.fn();
  let saved = initial;
  function Harness() { const [value, setValue] = useState(initial); return <InlineTextEditor ref={ref} value={value} onChange={next => { saved = next; changed(next); setValue(next); }} onCommit={committed} {...props} />; }
  await act(async () => root.render(<Harness />));
  return { ref, changed, committed, value: () => saved };
}
const editor = () => host.querySelector<HTMLElement>('[role="textbox"]')!;
function texts() { const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT); const nodes: Text[] = []; for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text); return nodes; }
async function select(start: Text, from: number, end = start, to = end.length) {
  await act(async () => { const range = document.createRange(); range.setStart(start, from); range.setEnd(end, to); const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
}
async function key(value: string, options: KeyboardEventInit = {}) { await act(async () => { editor().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...options })); }); }
async function format(ref: React.RefObject<InlineTextEditorHandle | null>, kind: Parameters<InlineTextEditorHandle['format']>[0], value?: string) { await act(async () => { ref.current!.format(kind, value); }); }

describe('inline rich text editing', () => {
  it('renders existing supported markup as editable text and keeps HTML-like text inert', async () => {
    await mount('A **bold** and *italic* `code` [link](https://example.com) <img src=x onerror=alert(1)>');
    expect(editor().getAttribute('contenteditable')).toBe('true');
    expect(editor().querySelector('strong')!.textContent).toBe('bold');
    expect(editor().querySelector('em')!.textContent).toBe('italic');
    expect(editor().querySelector('code')!.textContent).toBe('code');
    expect(editor().querySelector('a')!.getAttribute('href')).toBe('https://example.com/');
    expect(editor().querySelector('img')).toBeNull();
    expect(editor().textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('formats only the selected text, preserves the selection, and can remove that mark again', async () => {
    const state = await mount('Hello world');
    await select(texts()[0]!, 6);
    await format(state.ref, 'bold');
    expect(state.value()).toBe('Hello **world**');
    expect(editor().querySelector('strong')!.textContent).toBe('world');
    expect(document.getSelection()!.toString()).toBe('world');
    await format(state.ref, 'bold'); expect(state.value()).toBe('Hello world');
  });
  it('splits existing marks at selection boundaries and merges adjacent runs with the same marks', async () => {
    const state = await mount('one **two** three');
    const nodes = texts(); await select(nodes[0]!, 2, nodes[2]!, 3);
    await format(state.ref, 'bold');
    expect(state.value()).toBe('on**e two th**ree');
    expect(document.getSelection()!.toString()).toBe('e two th');
  });
  it('keeps both marks when italic is applied to an already bold selection', async () => {
    const state = await mount('Hello **world**');
    await select(texts()[1]!, 0); await format(state.ref, 'italic');
    expect(state.value()).toBe('Hello **_world_**');
    expect(editor().querySelector('strong em')!.textContent).toBe('world');
    await act(async () => root.render(null)); await mount(state.value());
    expect(editor().querySelector('strong em')!.textContent).toBe('world');
  });
  it('serializes partial bold within a fully italic line as a nested mark without adjacent delimiter collisions', async () => {
    const state = await mount('*Italic bold tail*');
    await select(texts()[0]!, 7, texts()[0]!, 11); await format(state.ref, 'bold');
    expect(state.value()).toBe('_Italic **bold** tail_');
    expect(editor().querySelector('strong em')!.textContent).toBe('bold');
    await act(async () => root.render(null)); await mount(state.value());
    expect(editor().querySelector('strong em')!.textContent).toBe('bold');
  });
  it('round-trips overlapping partial marks with the same visible text and character formats', async () => {
    const state = await mount('alpha beta gamma');
    await select(texts()[0]!, 0, texts()[0]!, 10); await format(state.ref, 'italic');
    await select(texts()[0]!, 6, texts()[1]!, 4); await format(state.ref, 'bold');
    const characters = () => texts().flatMap(node => [...node.textContent!].map(char => ({ char, bold: !!node.parentElement?.closest('strong'), italic: !!node.parentElement?.closest('em') })));
    const expected = characters(), saved = state.value();
    await act(async () => root.render(null)); await mount(saved);
    expect(characters(), saved).toEqual(expected);
  });
  it('round-trips an italic span inside a word without exposing delimiter characters', async () => {
    const state = await mount('alphabet'); await select(texts()[0]!, 2, texts()[0]!, 6); await format(state.ref, 'italic');
    expect(state.value()).toBe('al_phab_et');
    await act(async () => root.render(null)); await mount(state.value());
    expect(editor().textContent).toBe('alphabet'); expect(editor().querySelector('em')!.textContent).toBe('phab');
  });
  it('preserves a saved selection across a toolbar input and adds, changes or removes a safe link', async () => {
    const request = vi.fn(), state = await mount('Hello world', { onRequestLink: request });
    await select(texts()[0]!, 6); await key('k', { ctrlKey: true }); expect(request).toHaveBeenCalledWith('');
    const bar = document.createElement('div'); bar.className = 'studio-selection-toolbar'; const input = document.createElement('input'); bar.append(input); host.append(bar);
    await act(async () => input.focus());
    await format(state.ref, 'link', 'https://example.com/first');
    expect(state.value()).toBe('Hello [world](https://example.com/first)');
    expect(state.committed).not.toHaveBeenCalled();
    await format(state.ref, 'link', 'javascript:alert(1)'); expect(state.value()).toContain('https://example.com/first');
    await format(state.ref, 'link', 'https://example.com/second'); expect(state.value()).toBe('Hello [world](https://example.com/second)');
    await format(state.ref, 'link', ''); expect(state.value()).toBe('Hello world');
  });
  it('creates unordered and ordered lists for selected lines with Tab indentation and real digit-code shortcuts', async () => {
    const state = await mount('First\nSecond'); const nodes = texts();
    await select(nodes[0]!, 0, nodes[1]!, nodes[1]!.length); await format(state.ref, 'bullets');
    expect(state.value()).toBe('- First\n- Second');
    expect(editor().querySelectorAll('li')).toHaveLength(2);
    await key('Tab'); expect(state.value()).toBe('  - First\n  - Second');
    await key('Tab', { shiftKey: true }); expect(state.value()).toBe('- First\n- Second');
    await key('&', { ctrlKey: true, shiftKey: true, code: 'Digit7' }); expect(state.value()).toBe('1. First\n2. Second');
    await key('*', { ctrlKey: true, shiftKey: true, code: 'Digit8' }); expect(state.value()).toBe('- First\n- Second');
  });
  it('exits an empty list on Enter and removes its marker at the line start with Backspace', async () => {
    const state = await mount('- '); await key('Enter'); expect(state.value()).toBe('');
    await act(async () => root.render(null));
    const second = await mount('- First'); await select(texts()[0]!, 0, texts()[0]!, 0); await key('Backspace');
    expect(second.value()).toBe('First');
  });
  it('publishes browser DOM input including nonbreaking spaces, and retains that DOM during value echoes', async () => {
    const state = await mount('Old');
    await act(async () => { editor().innerHTML = '<div>Hello&nbsp;<strong>new</strong></div><div>Second</div>'; editor().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); });
    expect(state.value()).toBe('Hello **new**\nSecond');
    expect(editor().querySelector('strong')!.textContent).toBe('new');
  });
  it('renumbers following ordered items after the browser inserts a list item', async () => {
    const state = await mount('1. First\n2. Last');
    await act(async () => { editor().innerHTML = '<ol><li>First</li><li>Middle</li></ol><ol start="2"><li>Last</li></ol>'; editor().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' })); });
    expect(state.value()).toBe('1. First\n2. Middle\n3. Last');
  });
  it('toggles the caret mark without changing existing text or a neighboring plain run', async () => {
    const state = await mount('Plain **bold**');
    await select(texts()[1]!, 0, texts()[1]!, 0); await format(state.ref, 'bold');
    expect(state.value()).toBe('Plain **bold**');
    const caret = document.getSelection()!.anchorNode!;
    expect(caret.parentElement?.tagName).not.toBe('STRONG');
    await act(async () => { caret.textContent = 'x'; editor().dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x' })); });
    expect(state.value()).toBe('Plain x**bold**');
  });
  it('pastes plain text with line breaks and never inserts clipboard HTML', async () => {
    const state = await mount('');
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/plain' ? 'First\n<script>alert(1)</script>' : '<img src=x>' } });
      editor().dispatchEvent(event);
    });
    expect(state.value()).toBe('First\n<script>alert(1)</script>'); expect(editor().querySelector('script')).toBeNull(); expect(editor().querySelector('img')).toBeNull();
  });
  it('escapes literal Markdown punctuation from native input and keeps it literal after saving and loading', async () => {
    const state = await mount(''); const literal = '_literal_ **stars** [label](https://example.com) `code` \\ path';
    await act(async () => { editor().textContent = literal; editor().dispatchEvent(new InputEvent('input', { bubbles: true })); });
    expect(state.value()).toContain('\\_literal\\_');
    await act(async () => root.render(null)); await mount(state.value());
    expect(editor().textContent).toBe(literal); expect(editor().querySelector('em,strong,a,code')).toBeNull();
  });
  it('round-trips a safe link whose selected label has literal brackets and punctuation', async () => {
    const state = await mount(''); const literal = '[label] **plain**';
    await act(async () => { editor().textContent = literal; editor().dispatchEvent(new InputEvent('input', { bubbles: true })); });
    await select(texts()[0]!, 0); await format(state.ref, 'link', 'https://example.com/page(one)');
    await act(async () => root.render(null)); await mount(state.value());
    expect(editor().querySelector('a')!.textContent).toBe(literal);
    expect(editor().querySelector('a')!.getAttribute('href')).toBe('https://example.com/page%28one%29');
  });
  it('commits Escape and Ctrl Enter without treating IME confirmation as an edit commit', async () => {
    const state = await mount('Text');
    await key('Enter', { isComposing: true, ctrlKey: true }); expect(state.committed).not.toHaveBeenCalled();
    await key('Enter', { ctrlKey: true }); expect(state.committed).toHaveBeenLastCalledWith(true);
    await key('Escape'); expect(state.committed).toHaveBeenLastCalledWith(false);
    await act(async () => root.render(null));
    const title = await mount('Title', { singleLine: true }); await key('Enter'); expect(title.committed).toHaveBeenLastCalledWith(false);
  });
  it('lets the host own Enter before single-line or command commit handling', async () => {
    const hostKeyDown = vi.fn((event: React.KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter') event.preventDefault(); });
    const state = await mount('Table cell', { singleLine: true, onKeyDown: hostKeyDown });
    await key('Enter'); await key('Enter', { ctrlKey: true });
    expect(hostKeyDown).toHaveBeenCalledTimes(2); expect(state.committed).not.toHaveBeenCalled();
    await key('Escape'); expect(state.committed).toHaveBeenCalledWith(false);
  });
  it('lets the host retain an editor on internal blur while still committing an external blur', async () => {
    const inside = document.createElement('button'), outside = document.createElement('button');
    const state = await mount('Table cell', { onBlur: event => { if (event.relatedTarget === inside) event.preventDefault(); } });
    host.append(inside, outside);
    await act(async () => { editor().dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true, relatedTarget: inside })); });
    expect(state.committed).not.toHaveBeenCalled();
    await act(async () => { editor().dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true, relatedTarget: outside })); });
    expect(state.committed).toHaveBeenCalledWith(false);
  });
  it('undoes and redoes DOM formatting and typed drafts inside the editor', async () => {
    const state = await mount('Hello world'); await select(texts()[0]!, 6); await format(state.ref, 'bold');
    await key('z', { ctrlKey: true }); expect(state.value()).toBe('Hello world'); expect(editor().querySelector('strong')).toBeNull();
    await key('z', { ctrlKey: true, shiftKey: true }); expect(state.value()).toBe('Hello **world**');
    await act(async () => { editor().textContent = 'Typed locally'; editor().dispatchEvent(new InputEvent('input', { bubbles: true })); });
    await key('z', { ctrlKey: true }); expect(state.value()).toBe('Hello **world**');
    await key('y', { ctrlKey: true }); expect(state.value()).toBe('Typed locally');
  });
});
