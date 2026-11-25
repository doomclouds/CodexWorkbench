import { act, createRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InlineTextEditor,
  connectorExtension,
  noteExtension,
  sectionExtension,
  shapeExtension,
  textExtension,
  TextObject,
  richTextFirstLine,
  type InlineTextEditorHandle,
  type InlineTextEditorProps,
} from '../../../src/ui/domain/objects/text/index.js';

const CanvasText = textExtension.View!;

type TextViewProps = ComponentProps<typeof CanvasText>;

function textViewProps(): TextViewProps {
  const geometry = { x: 10, y: 15, width: 160, height: 80, rotation: 0 };

  return {
    id: 'texto',
    object: { kind: 'text', label: '旧标签', geometry },
    geometry,
    zoom: 1,
    selected: true,
    interactive: true,
    readOnly: false,
    editRequest: 1,
    payload: { version: 12, value: { text: '已保存内容' } },
    request: vi.fn<TextViewProps['request']>(),
  };
}

async function replaceText(value: string) {
  await act(async () => {
    editor().replaceChildren(document.createTextNode(value));
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('registered canvas text objects', () => {
  it('registers a common content view with the supported frame capabilities', () => {
    const labels = [
      textExtension,
      noteExtension,
      shapeExtension,
      sectionExtension,
      connectorExtension,
    ];
    expect(labels.map(({ kind }) => kind)).toEqual([
      'text',
      'note',
      'shape',
      'section',
      'connector',
    ]);
    expect(labels.every(({ View }) => View === CanvasText)).toBe(true);
    expect(sectionExtension.capabilities).toMatchObject({ rotate: false, connect: true });
    expect(connectorExtension.capabilities).toMatchObject({
      resize: false,
      rotate: false,
      connect: false,
    });
    expect(connectorExtension.placement).toBeUndefined();
  });

  it('shows the fallback label while the versioned payload is not available', async () => {
    const props = textViewProps();
    await act(async () => root.render(<CanvasText {...props} payload={undefined} />));
    expect(host.textContent).toContain('旧标签');
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(props.request).not.toHaveBeenCalled();
  });

  it('submits intentionally cleared text with the actual payload version and closes after receipt', async () => {
    const props = textViewProps();
    const retention = vi.fn<(retain: boolean) => void>();
    const request = vi.fn<TextViewProps['request']>().mockResolvedValue({
      ok: true,
      payload: { version: 13, value: { text: '' } },
    });
    await act(async () =>
      root.render(<CanvasText {...props} request={request} onRetentionChange={retention} />),
    );
    expect(retention).not.toHaveBeenCalled();
    await replaceText('');
    expect(retention.mock.calls).toEqual([[true]]);
    await key('Escape');

    expect(request).toHaveBeenCalledExactlyOnceWith({
      expectedVersion: 12,
      name: 'text.commit',
      value: { text: '', adjacent: false },
    });
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(host.textContent).toBe('');
    expect(retention.mock.calls).toEqual([[true], [false]]);
  });

  it('retains a rejected draft and its version, then shows the current text when discarded', async () => {
    const props = textViewProps();
    const retention = vi.fn<(retain: boolean) => void>();
    const request = vi.fn<TextViewProps['request']>().mockResolvedValue({
      ok: false,
      message: '文字已更新',
      current: { version: 13, value: { text: '远端新内容' } },
    });
    await act(async () =>
      root.render(<CanvasText {...props} request={request} onRetentionChange={retention} />),
    );
    await replaceText('我的新内容');
    await key('Enter', { ctrlKey: true });
    expect(editor().textContent).toBe('我的新内容');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('文字已更新');
    expect(retention.mock.calls).toEqual([[true]]);
    await act(async () => clickButton('重试保存文字'));
    expect(request).toHaveBeenNthCalledWith(2, {
      expectedVersion: 12,
      name: 'text.commit',
      value: { text: '我的新内容', adjacent: true },
    });

    await act(async () => clickButton('放弃文字修改'));
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(host.textContent).toContain('远端新内容');
    expect(request).toHaveBeenCalledTimes(2);
    expect(retention.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps a pending adjacent-text command mounted and releases it on unmount', async () => {
    const props = textViewProps();
    const retention = vi.fn<(retain: boolean) => void>();
    type Receipt = Awaited<ReturnType<TextViewProps['request']>>;
    let acknowledge!: (receipt: Receipt) => void;
    const pending = new Promise<Receipt>((resolve) => {
      acknowledge = resolve;
    });
    const request = vi.fn<TextViewProps['request']>().mockReturnValue(pending);
    await act(async () =>
      root.render(<CanvasText {...props} request={request} onRetentionChange={retention} />),
    );
    await key('Enter', { ctrlKey: true });

    expect(request).toHaveBeenCalledWith({
      expectedVersion: 12,
      name: 'text.commit',
      value: { text: '已保存内容', adjacent: true },
    });
    expect(retention.mock.calls).toEqual([[true]]);

    await act(async () => root.render(null));
    expect(retention.mock.calls).toEqual([[true], [false]]);
    await act(async () =>
      acknowledge({ ok: true, payload: { version: 13, value: { text: '已保存内容' } } }),
    );
    expect(retention.mock.calls).toEqual([[true], [false]]);
  });

  it('updates a clean open editor on a remote payload and saves against that revision', async () => {
    const props = textViewProps();
    const request = vi.fn<TextViewProps['request']>().mockResolvedValue({
      ok: true,
      payload: { version: 14, value: { text: '确认内容' } },
    });
    await act(async () => root.render(<CanvasText {...props} request={request} />));
    const payload = { version: 13, value: { text: '远端新内容' } };
    await act(async () =>
      root.render(<CanvasText {...props} request={request} payload={payload} />),
    );
    expect(editor().textContent).toBe('远端新内容');
    await replaceText('确认内容');
    await key('Escape');
    expect(request).toHaveBeenCalledExactlyOnceWith({
      expectedVersion: 13,
      name: 'text.commit',
      value: { text: '确认内容', adjacent: false },
    });
    expect(host.textContent).toBe('确认内容');
  });
});

function clickButton(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  button?.click();
}

describe('canvas text object', () => {
  it('renders native text with real format markers, indentation, and only safe links', async () => {
    const source =
      '**粗体** _斜体_ [安全](https://example.com) [危险](javascript:alert)\n  - 列表项';
    await act(async () => root.render(<TextObject text={source} />));

    expect(host.querySelector('strong')?.textContent).toBe('粗体');
    expect(host.querySelector('em')?.textContent).toBe('斜体');
    expect(host.querySelector('a')?.href).toBe('https://example.com/');
    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.textContent).toContain('[危险](javascript:alert)');
    expect(host.querySelector('.studio-ui-rich-text-line.is-list')?.textContent).toBe('•列表项');
    expect(richTextFirstLine(source)).toBe('粗体 斜体 安全 [危险](javascript:alert)');
  });

  it('opens by double click and applies a toolbar mark to the selected range only', async () => {
    const changed = vi.fn();
    const committed = vi.fn();

    function Harness() {
      const [editing, setEditing] = useState(false);
      const [value, setValue] = useState('便签 待整理');

      return (
        <TextObject
          text={value}
          editing={editing}
          label="编辑便签"
          onRequestEdit={() => setEditing(true)}
          onTextChange={(next) => {
            changed(next);
            setValue(next);
          }}
          onCommit={() => {
            committed();
            setEditing(false);
          }}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      host
        .querySelector('.studio-ui-text-object')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(editor().getAttribute('aria-label')).toBe('编辑便签');
    expect(editor().closest('[data-canvas-native]')).not.toBeNull();
    await select(texts()[0]!, 0, texts()[0]!, 2);
    await act(async () => clickButton('粗体'));

    expect(changed).toHaveBeenLastCalledWith('**便签** 待整理');
    expect(editor().querySelector('strong')?.textContent).toBe('便签');
    expect(committed).not.toHaveBeenCalled();
    await key('Enter', { ctrlKey: true });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(host.querySelector('strong')?.textContent).toBe('便签');
  });

  it('opens the URL field from Ctrl K, rejects unsafe URLs and restores selection after a safe link', async () => {
    const changed = vi.fn();
    const committed = vi.fn();
    await act(async () =>
      root.render(
        <TextObject text="打开 文档" editing onTextChange={changed} onCommit={committed} />,
      ),
    );
    await select(texts()[0]!, 3);
    await key('k', { ctrlKey: true });
    const field = host.querySelector('input');
    expect(document.activeElement).toBe(field);
    expect(field).toBeDefined();

    async function fill(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          field,
          value,
        );
        field?.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    await fill('javascript:alert(1)');
    await act(async () => clickButton('应用链接'));
    expect(field?.getAttribute('aria-invalid')).toBe('true');
    expect(changed).not.toHaveBeenCalled();

    await fill('https://example.com/todo');
    await act(async () => clickButton('应用链接'));
    expect(changed).toHaveBeenCalledWith('打开 [文档](https://example.com/todo)');
    expect(host.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(editor());
    expect(document.getSelection()?.toString()).toBe('文档');
    expect(committed).not.toHaveBeenCalled();
  });

  it('keeps read-only labels out of the editing interaction', async () => {
    const requested = vi.fn();
    const changed = vi.fn();
    await act(async () =>
      root.render(
        <TextObject
          text="**已发布**"
          editing
          readOnly
          onRequestEdit={requested}
          onTextChange={changed}
        />,
      ),
    );
    await act(async () => {
      host
        .querySelector('.studio-ui-text-object')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(host.querySelector('strong')?.textContent).toBe('已发布');
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(requested).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(initial: string, props: Partial<InlineTextEditorProps> = {}) {
  const ref = createRef<InlineTextEditorHandle>();
  const changed = vi.fn();
  const committed = vi.fn();
  let saved = initial;
  function Harness() {
    const [value, setValue] = useState(initial);

    return (
      <InlineTextEditor
        ref={ref}
        value={value}
        onChange={(next) => {
          saved = next;
          changed(next);
          setValue(next);
        }}
        onCommit={committed}
        {...props}
      />
    );
  }

  await act(async () => root.render(<Harness />));

  return { ref, changed, committed, value: () => saved };
}

const editor = () => host.querySelector<HTMLElement>('[role="textbox"]')!;

function texts() {
  const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }

  return nodes;
}

async function select(start: Text, from: number, end = start, to = end.length) {
  await act(async () => {
    const range = document.createRange();
    range.setStart(start, from);
    range.setEnd(end, to);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

async function key(value: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    editor().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...options }),
    );
  });
}

async function format(
  ref: React.RefObject<InlineTextEditorHandle | null>,
  kind: Parameters<InlineTextEditorHandle['format']>[0],
  value?: string,
) {
  await act(async () => {
    ref.current!.format(kind, value);
  });
}

describe('inline rich text editing', () => {
  it('renders existing supported markup as editable text and keeps HTML-like text inert', async () => {
    await mount(
      'A **bold** and *italic* `code` [link](https://example.com) <img src=x onerror=alert(1)>',
    );
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
    await format(state.ref, 'bold');
    expect(state.value()).toBe('Hello world');
  });
  it('splits existing marks at selection boundaries and merges adjacent runs with the same marks', async () => {
    const state = await mount('one **two** three');
    const nodes = texts();
    await select(nodes[0]!, 2, nodes[2]!, 3);
    await format(state.ref, 'bold');
    expect(state.value()).toBe('on**e two th**ree');
    expect(document.getSelection()!.toString()).toBe('e two th');
  });
  it('keeps both marks when italic is applied to an already bold selection', async () => {
    const state = await mount('Hello **world**');
    await select(texts()[1]!, 0);
    await format(state.ref, 'italic');
    expect(state.value()).toBe('Hello **_world_**');
    expect(editor().querySelector('strong em')!.textContent).toBe('world');
    await act(async () => root.render(null));
    await mount(state.value());
    expect(editor().querySelector('strong em')!.textContent).toBe('world');
  });
  it('serializes partial bold within a fully italic line as a nested mark without adjacent delimiter collisions', async () => {
    const state = await mount('*Italic bold tail*');
    await select(texts()[0]!, 7, texts()[0]!, 11);
    await format(state.ref, 'bold');
    expect(state.value()).toBe('_Italic **bold** tail_');
    expect(editor().querySelector('strong em')!.textContent).toBe('bold');
    await act(async () => root.render(null));
    await mount(state.value());
    expect(editor().querySelector('strong em')!.textContent).toBe('bold');
  });
  it('round-trips overlapping partial marks with the same visible text and character formats', async () => {
    const state = await mount('alpha beta gamma');
    await select(texts()[0]!, 0, texts()[0]!, 10);
    await format(state.ref, 'italic');
    await select(texts()[0]!, 6, texts()[1]!, 4);
    await format(state.ref, 'bold');
    const characters = () =>
      texts().flatMap((node) =>
        Array.from(node.textContent!).map((char) => ({
          char,
          bold: !!node.parentElement?.closest('strong'),
          italic: !!node.parentElement?.closest('em'),
        })),
      );
    const expected = characters();
    const saved = state.value();
    await act(async () => root.render(null));
    await mount(saved);
    expect(characters(), saved).toEqual(expected);
  });
  it('round-trips an italic span inside a word without exposing delimiter characters', async () => {
    const state = await mount('alphabet');
    await select(texts()[0]!, 2, texts()[0]!, 6);
    await format(state.ref, 'italic');
    expect(state.value()).toBe('al_phab_et');
    await act(async () => root.render(null));
    await mount(state.value());
    expect(editor().textContent).toBe('alphabet');
    expect(editor().querySelector('em')!.textContent).toBe('phab');
  });
  it('preserves a saved selection across a toolbar input and adds, changes or removes a safe link', async () => {
    const request = vi.fn();
    const state = await mount('Hello world', { onRequestLink: request });
    await select(texts()[0]!, 6);
    await key('k', { ctrlKey: true });
    expect(request).toHaveBeenCalledWith('');
    const bar = document.createElement('div');
    bar.className = 'studio-selection-toolbar';
    const input = document.createElement('input');
    bar.append(input);
    host.append(bar);
    await act(async () => input.focus());
    await format(state.ref, 'link', 'https://example.com/first');
    expect(state.value()).toBe('Hello [world](https://example.com/first)');
    expect(state.committed).not.toHaveBeenCalled();
    await format(state.ref, 'link', 'javascript:alert(1)');
    expect(state.value()).toContain('https://example.com/first');
    await format(state.ref, 'link', 'https://example.com/second');
    expect(state.value()).toBe('Hello [world](https://example.com/second)');
    await format(state.ref, 'link', '');
    expect(state.value()).toBe('Hello world');
  });
  it('creates unordered and ordered lists for selected lines with Tab indentation and real digit-code shortcuts', async () => {
    const state = await mount('First\nSecond');
    const nodes = texts();
    await select(nodes[0]!, 0, nodes[1]!, nodes[1]!.length);
    await format(state.ref, 'bullets');
    expect(state.value()).toBe('- First\n- Second');
    expect(editor().querySelectorAll('li')).toHaveLength(2);
    await key('Tab');
    expect(state.value()).toBe('  - First\n  - Second');
    await key('Tab', { shiftKey: true });
    expect(state.value()).toBe('- First\n- Second');
    await key('&', { ctrlKey: true, shiftKey: true, code: 'Digit7' });
    expect(state.value()).toBe('1. First\n2. Second');
    await key('*', { ctrlKey: true, shiftKey: true, code: 'Digit8' });
    expect(state.value()).toBe('- First\n- Second');
  });
  it('exits an empty list on Enter and removes its marker at the line start with Backspace', async () => {
    const state = await mount('- ');
    await key('Enter');
    expect(state.value()).toBe('');
    await act(async () => root.render(null));
    const second = await mount('- First');
    await select(texts()[0]!, 0, texts()[0]!, 0);
    await key('Backspace');
    expect(second.value()).toBe('First');
  });
  it('publishes browser DOM input including nonbreaking spaces, and retains that DOM during value echoes', async () => {
    const state = await mount('Old');
    await act(async () => {
      editor().innerHTML = '<div>Hello&nbsp;<strong>new</strong></div><div>Second</div>';
      editor().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    expect(state.value()).toBe('Hello **new**\nSecond');
    expect(editor().querySelector('strong')!.textContent).toBe('new');
  });
  it('renumbers following ordered items after the browser inserts a list item', async () => {
    const state = await mount('1. First\n2. Last');
    await act(async () => {
      editor().innerHTML = '<ol><li>First</li><li>Middle</li></ol><ol start="2"><li>Last</li></ol>';
      editor().dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }),
      );
    });
    expect(state.value()).toBe('1. First\n2. Middle\n3. Last');
  });
  it('toggles the caret mark without changing existing text or a neighboring plain run', async () => {
    const state = await mount('Plain **bold**');
    await select(texts()[1]!, 0, texts()[1]!, 0);
    await format(state.ref, 'bold');
    expect(state.value()).toBe('Plain **bold**');
    const caret = document.getSelection()!.anchorNode!;
    expect(caret.parentElement?.tagName).not.toBe('STRONG');
    await act(async () => {
      caret.textContent = 'x';
      editor().dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x' }));
    });
    expect(state.value()).toBe('Plain x**bold**');
  });
  it('pastes plain text with line breaks and never inserts clipboard HTML', async () => {
    const state = await mount('');
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (kind: string) =>
            kind === 'text/plain' ? 'First\n<script>alert(1)</script>' : '<img src=x>',
        },
      });
      editor().dispatchEvent(event);
    });
    expect(state.value()).toBe('First\n<script>alert(1)</script>');
    expect(editor().querySelector('script')).toBeNull();
    expect(editor().querySelector('img')).toBeNull();
  });
  it('escapes literal Markdown punctuation from native input and keeps it literal after saving and loading', async () => {
    const state = await mount('');
    const literal = '_literal_ **stars** [label](https://example.com) `code` \\ path';
    await act(async () => {
      editor().textContent = literal;
      editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(state.value()).toContain('\\_literal\\_');
    await act(async () => root.render(null));
    await mount(state.value());
    expect(editor().textContent).toBe(literal);
    expect(editor().querySelector('em,strong,a,code')).toBeNull();
  });
  it('round-trips a safe link whose selected label has literal brackets and punctuation', async () => {
    const state = await mount('');
    const literal = '[label] **plain**';
    await act(async () => {
      editor().textContent = literal;
      editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await select(texts()[0]!, 0);
    await format(state.ref, 'link', 'https://example.com/page(one)');
    await act(async () => root.render(null));
    await mount(state.value());
    expect(editor().querySelector('a')!.textContent).toBe(literal);
    expect(editor().querySelector('a')!.getAttribute('href')).toBe(
      'https://example.com/page%28one%29',
    );
  });
  it('commits Escape and Ctrl Enter without treating IME confirmation as an edit commit', async () => {
    const state = await mount('Text');
    await key('Enter', { isComposing: true, ctrlKey: true });
    expect(state.committed).not.toHaveBeenCalled();
    await key('Enter', { ctrlKey: true });
    expect(state.committed).toHaveBeenLastCalledWith(true);
    await key('Escape');
    expect(state.committed).toHaveBeenLastCalledWith(false);
    await act(async () => root.render(null));
    const title = await mount('Title', { singleLine: true });
    await key('Enter');
    expect(title.committed).toHaveBeenLastCalledWith(false);
  });
  it('lets the host own Enter before single-line or command commit handling', async () => {
    const hostKeyDown = vi.fn((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
      }
    });
    const state = await mount('Table cell', { singleLine: true, onKeyDown: hostKeyDown });
    await key('Enter');
    await key('Enter', { ctrlKey: true });
    expect(hostKeyDown).toHaveBeenCalledTimes(2);
    expect(state.committed).not.toHaveBeenCalled();
    await key('Escape');
    expect(state.committed).toHaveBeenCalledWith(false);
  });
  it('lets the host retain an editor on internal blur while still committing an external blur', async () => {
    const inside = document.createElement('button');
    const outside = document.createElement('button');
    const state = await mount('Table cell', {
      onBlur: (event) => {
        if (event.relatedTarget === inside) {
          event.preventDefault();
        }
      },
    });
    host.append(inside, outside);
    await act(async () => {
      editor().dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, cancelable: true, relatedTarget: inside }),
      );
    });
    expect(state.committed).not.toHaveBeenCalled();
    await act(async () => {
      editor().dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, cancelable: true, relatedTarget: outside }),
      );
    });
    expect(state.committed).toHaveBeenCalledWith(false);
  });
  it('undoes and redoes DOM formatting and typed drafts inside the editor', async () => {
    const state = await mount('Hello world');
    await select(texts()[0]!, 6);
    await format(state.ref, 'bold');
    await key('z', { ctrlKey: true });
    expect(state.value()).toBe('Hello world');
    expect(editor().querySelector('strong')).toBeNull();
    await key('z', { ctrlKey: true, shiftKey: true });
    expect(state.value()).toBe('Hello **world**');
    await act(async () => {
      editor().textContent = 'Typed locally';
      editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await key('z', { ctrlKey: true });
    expect(state.value()).toBe('Hello **world**');
    await key('y', { ctrlKey: true });
    expect(state.value()).toBe('Typed locally');
  });
});
