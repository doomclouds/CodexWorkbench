// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import NativeTable from '../src/app/canvas/NativeTable.js';
import type { Board, BoardElement } from '../src/contracts/studio.js';
import { LOCAL_ACTOR } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';

let host: HTMLDivElement, root: Root;
const table = (changes: Partial<BoardElement> = {}): BoardElement => ({ id: 'table', type: 'table', x: 20, y: 30, w: 400, h: 180, version: 1, data: { rows: [['A', 'B'], ['C', 'D']], source: 'preserve' }, ...changes });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false; HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function event(node: Element, name: string, options: MouseEventInit = {}) { await act(async () => { node.dispatchEvent(new MouseEvent(name, { bubbles: true, button: 0, ...options })); }); }
async function key(node: Element, value: string, options: KeyboardEventInit = {}) { await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options })); }); }
const cell = (row: number, col: number) => host.querySelector(`[data-cell="${row}:${col}"]`)!;
const editor = () => host.querySelector<HTMLElement>('[role="textbox"]')!;
const button = (label: string) => host.querySelector(`[aria-label="${label}"]`)!;
async function type(value: string) {
  await act(async () => {
    const node = editor(); node.replaceChildren();
    for (const line of value.split('\n')) { const paragraph = document.createElement('div'); if (line) paragraph.textContent = line; else paragraph.append(document.createElement('br')); node.append(paragraph); }
    const range = document.createRange(); range.selectNodeContents(node); range.collapse(false); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  });
}
async function selectText(text: string, start = 0, end = text.length) {
  await act(async () => {
    const walker = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT); let node: Text | null = null;
    for (let current = walker.nextNode(); current; current = walker.nextNode()) if (current.textContent?.includes(text)) { node = current as Text; break; }
    if (!node) throw new Error(`Missing text: ${text}`);
    const at = node.data.indexOf(text), range = document.createRange(); range.setStart(node, at + start); range.setEnd(node, at + end); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}
async function formatCell(format: 'bold' | 'italic' | 'link' | 'bullets' | 'numbered', url?: string) {
  const event = new CustomEvent('studio-table-format', { bubbles: true, cancelable: true, detail: { format, url } });
  await act(async () => { host.querySelector('.studio-native-table')!.dispatchEvent(event); });
  return event.defaultPrevented;
}
async function waitUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (check()) return;
  }
  throw new Error('Table did not finish the requested save.');
}
async function mount(value = table(), overrides: Partial<React.ComponentProps<typeof NativeTable>> = {}) {
  const onSave = vi.fn().mockResolvedValue(false), activity = vi.fn();
  await act(async () => root.render(<NativeTable element={value} selected canEdit onSave={onSave} onEditingChange={activity} {...overrides} />));
  return { onSave, activity };
}

it('renders and edits the original TSV table without substituting sample cells', async () => {
  const text = '名称\t说明\t状态\n项目 A\t双击单元格编辑\t进行中\n项目 B\t后续安排\t待处理';
  const legacy = table({ text, data: undefined, w: 900, h: 300 });
  const onSave = vi.fn(async (changes: Partial<BoardElement>, base: BoardElement) => ({ ...base, ...changes, version: base.version + 1 }));
  await mount(legacy, { onSave });
  expect(host.querySelectorAll('tr')).toHaveLength(3);
  expect(host.querySelectorAll('[data-cell]')).toHaveLength(9);
  expect(cell(1, 1).textContent).toBe('双击单元格编辑');
  expect(cell(2, 2).textContent).toBe('待处理');
  await event(cell(2, 1), 'dblclick'); await type('已安排'); await key(editor(), 'Escape');
  expect(onSave.mock.calls[0]![0].data?.rows).toEqual([['名称', '说明', '状态'], ['项目 A', '双击单元格编辑', '进行中'], ['项目 B', '已安排', '待处理']]);
  expect(legacy.text).toBe(text);
});

it('gives explicit structured rows precedence over legacy TSV content', async () => {
  await mount(table({ text: '旧\t表\n应\t忽略' }));
  expect(host.querySelectorAll('[data-cell]')).toHaveLength(4);
  expect(cell(0, 0).textContent).toBe('A');
  expect(host.textContent).not.toContain('忽略');
});
async function editable(value = table(), version = (base: BoardElement) => base.version + 1) {
  let latest = value;
  const save = vi.fn(async (changes: Partial<BoardElement>, base: BoardElement): Promise<BoardElement | false> => {
    if (base.version !== latest.version) return false;
    latest = { ...latest, ...changes, version: version(base) }; return latest;
  });
  const activity = vi.fn();
  function Harness() { const [element, setElement] = useState(value); return <NativeTable element={element} selected canEdit onEditingChange={activity} onSave={async (changes, base) => { const saved = await save(changes, base); if (saved) setElement(saved); return saved; }} />; }
  await act(async () => root.render(<Harness />));
  return { save, activity, current: () => latest };
}

describe('native table editing', () => {
  it('formats only the active rich-text cell selection and preserves its actual CAS source', async () => {
    const { save, current } = await editable(table({ fill: '#f9e56f', data: { rows: [['Alpha beta gamma', 'Untouched'], ['C', 'D']] } }));
    expect((cell(0, 0) as HTMLElement).style.background).toBe('rgb(249, 229, 111)');
    await event(cell(0, 0), 'dblclick'); await selectText('beta');
    expect(await formatCell('bold')).toBe(true); expect(editor().querySelector('strong')!.textContent).toBe('beta');
    expect(editor().textContent).toBe('Alpha beta gamma');
    expect(await formatCell('italic')).toBe(true); expect(editor().querySelector('strong em, em strong')!.textContent).toBe('beta');
    expect(await formatCell('bold')).toBe(true); expect(editor().querySelector('strong')).toBeNull(); expect(editor().querySelector('em')!.textContent).toBe('beta');
    await key(editor(), 'Escape');
    expect(current().data?.rows).toEqual([['Alpha _beta_ gamma', 'Untouched'], ['C', 'D']]);
    expect(save.mock.calls[0]![1].version).toBe(1); expect(cell(0, 0).querySelector('em')!.textContent).toBe('beta');
  });

  it('formats selected lines as real lists and rejects unsafe links without altering other cells', async () => {
    const { current } = await editable(table({ data: { rows: [['one\ntwo', 'Other']] } }));
    await event(cell(0, 0), 'dblclick'); await selectText('one');
    expect(await formatCell('bullets')).toBe(true); expect(editor().querySelector('ul li')!.textContent).toBe('one');
    await selectText('two'); expect(await formatCell('numbered')).toBe(true); expect(editor().querySelector('ol li')!.textContent).toBe('two');
    await selectText('one'); expect(await formatCell('link', 'javascript:alert(1)')).toBe(false);
    expect(await formatCell('link', 'https://example.test')).toBe(true); expect(editor().querySelector('a')!.textContent).toBe('one'); expect(editor().querySelector('a')!.getAttribute('href')).toBe('https://example.test/');
    await key(editor(), 'Escape'); expect((current().data?.rows as string[][])[0]![1]).toBe('Other');
  });

  it('keeps a rich cell selection while a format popover receives focus and handles native formatting chords', async () => {
    const { save } = await editable(table({ data: { rows: [['Alpha beta', 'Other']] } }));
    await event(cell(0, 0), 'dblclick'); await selectText('beta'); await key(editor(), 'b', { ctrlKey: true });
    expect(editor().querySelector('strong')!.textContent).toBe('beta');
    const toolbar = document.createElement('div'); toolbar.className = 'studio-selection-toolbar'; const link = document.createElement('input'); toolbar.append(link); document.body.append(toolbar);
    try {
      await act(async () => link.focus());
      expect(save).not.toHaveBeenCalled(); expect(editor()).not.toBeNull();
      expect(await formatCell('italic')).toBe(true); expect(editor().querySelector('strong em, em strong')!.textContent).toBe('beta');
      await key(editor(), 'Escape'); expect(save.mock.calls[0]![0].data?.rows).toEqual([['Alpha **_beta_**', 'Other']]);
    } finally { toolbar.remove(); }
  });
  it('requests the shared link popover with Ctrl K and restores the real DOM selection after focus changes', async () => {
    const onRequestLink = vi.fn(), onSave = vi.fn(async (changes: Partial<BoardElement>, base: BoardElement) => ({ ...base, ...changes, version: base.version + 1 }));
    await mount(table({ data: { rows: [['Before chosen after', 'Other']] } }), { onRequestLink, onSave });
    await event(cell(0, 0), 'dblclick'); await selectText('chosen'); await key(editor(), 'k', { ctrlKey: true });
    expect(onRequestLink).toHaveBeenCalledWith('');
    const toolbar = document.createElement('div'); toolbar.className = 'studio-selection-toolbar'; const url = document.createElement('input'); toolbar.append(url); document.body.append(toolbar);
    try {
      await act(async () => { url.focus(); url.value = 'https://example.test/reference'; url.select(); });
      expect(onSave).not.toHaveBeenCalled();
      expect(await formatCell('link', url.value)).toBe(true);
      expect(editor().textContent).toBe('Before chosen after'); expect(editor().querySelector('a')!.textContent).toBe('chosen');
      await key(editor(), 'Escape'); expect(onSave.mock.calls[0]![0].data?.rows).toEqual([['Before [chosen](https://example.test/reference) after', 'Other']]);
    } finally { toolbar.remove(); }
  });
  it('leaves read-only tables selectable without exposing editing or geometry controls', async () => {
    const { onSave, activity } = await mount(table(), { canEdit: false });
    await event(cell(0, 0), 'dblclick'); await event(cell(0, 0), 'contextmenu', { button: 2 });
    expect(host.querySelector('[role="textbox"]')).toBeNull(); expect(host.querySelector('.studio-table-controls')).toBeNull(); expect(host.querySelector('[role="separator"]')).toBeNull(); expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(onSave).not.toHaveBeenCalled(); expect(activity.mock.lastCall?.[0]).toBe(false);
  });
  it('saves Tab and Enter navigation against the actual response version and appends the last Tab row', async () => {
    const { save, current } = await editable(table(), base => base.version === 1 ? 7 : base.version + 1);
    await event(cell(0, 0), 'dblclick'); await type('First edit'); await key(editor(), 'Tab');
    expect(editor().getAttribute('aria-label')).toBe('表格第1行第2列');
    expect(save.mock.calls[0]![1].version).toBe(1);
    await type('Second edit'); await key(editor(), 'Enter');
    expect(save.mock.calls[1]![1].version).toBe(7);
    expect(editor().getAttribute('aria-label')).toBe('表格第2行第2列');
    await key(editor(), 'Tab', { shiftKey: true }); expect(editor().getAttribute('aria-label')).toBe('表格第2行第1列');
    await event(cell(1, 1), 'pointerdown'); await key(editor(), 'Tab');
    expect(editor().getAttribute('aria-label')).toBe('表格第3行第1列');
    expect(current().data?.rows).toEqual([['First edit', 'Second edit'], ['C', 'D'], ['', '']]);
    expect(current().data?.source).toBe('preserve');
    await key(editor(), 'Escape'); expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('preserves a changed cell when adding rows or toggling the header without an intervening blur', async () => {
    const { save, current } = await editable();
    await event(cell(0, 0), 'dblclick'); await type('Draft before add'); await event(button('添加表格行'), 'click');
    expect(save).toHaveBeenCalledTimes(1); expect(current().data?.rows).toEqual([['Draft before add', 'B'], ['C', 'D'], ['', '']]);
    expect(editor().getAttribute('aria-label')).toBe('表格第3行第1列');
    await event(button('切换表头'), 'click'); expect(host.querySelectorAll('th')).toHaveLength(0);
    expect(current().data?.head).toBe(false); expect(save.mock.calls[1]![1].version).toBe(2);
  });

  it('retains failed drafts and their original CAS base when remote content arrives', async () => {
    const save = vi.fn().mockResolvedValue(false), activity = vi.fn();
    await mount(table(), { onSave: save, onEditingChange: activity });
    await event(cell(0, 0), 'dblclick'); await type('Local draft'); await key(editor(), 'Escape');
    await mount(table({ version: 2, data: { rows: [['Remote edit', 'B'], ['C', 'D']] } }), { onSave: save, onEditingChange: activity });
    expect(editor().textContent).toBe('Local draft'); expect(activity.mock.lastCall?.[0]).toBe(true);
    await event(button('重试保存表格'), 'click'); expect(save.mock.calls[1]![1].version).toBe(1);
    expect(editor().textContent).toBe('Local draft');
    await event(button('放弃表格草稿'), 'click'); expect(cell(0, 0).textContent).toBe('Remote edit'); expect(host.querySelector('[role="textbox"]')).toBeNull();
  });

  it('disables overlapping saves and retains the reason from a rejected save', async () => {
    let reject!: (failure: Error) => void;
    const save = vi.fn().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await mount(table(), { onSave: save }); await event(cell(0, 0), 'dblclick'); await type('Pending'); await key(editor(), 'Escape');
    expect(editor().getAttribute('aria-disabled')).toBe('true'); await key(editor(), 'Escape'); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Network unavailable')));
    expect(editor().textContent).toBe('Pending'); expect(editor().getAttribute('aria-disabled')).toBeNull(); expect(host.querySelector('[role="alert"]')!.textContent).toContain('Network unavailable');
  });

  it('offers row and column insertion/deletion in the actual cell menu and keeps one final cell', async () => {
    const { current } = await editable(); await event(cell(0, 1), 'contextmenu', { button: 2, clientX: 120, clientY: 40 });
    const menu = host.querySelector('[role="menu"]')!; expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
    await event([...menu.querySelectorAll('button')].find(node => node.textContent === '在左侧插入列')!, 'click');
    expect(current().data?.rows).toEqual([['A', '', 'B'], ['C', '', 'D']]);
    await event(button('删除当前列'), 'click'); expect(current().data?.rows).toEqual([['A', 'B'], ['C', 'D']]);
    await event(button('删除当前行'), 'click'); expect(current().data?.rows).toEqual([['C', 'D']]);
    expect((button('删除当前行') as HTMLButtonElement).disabled).toBe(true);
    await event(button('删除当前列'), 'click'); expect((button('删除当前列') as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps a dirty rich cell open while its cell menu takes focus and commits it with the structural edit', async () => {
    const { save, current } = await editable(); await event(cell(0, 0), 'dblclick'); await type('Draft before menu');
    await event(cell(0, 0), 'contextmenu', { button: 2 });
    expect(save).not.toHaveBeenCalled(); expect(editor().textContent).toBe('Draft before menu');
    const action = [...host.querySelectorAll('.studio-table-cell-menu button')].find(node => node.textContent === '在下方插入行')!;
    await event(action, 'click');
    expect(save).toHaveBeenCalledTimes(1); expect(current().data?.rows).toEqual([['Draft before menu', 'B'], ['', ''], ['C', 'D']]);
  });
});

describe('native table column geometry', () => {
  it('cancels an in-progress width gesture when another actor locks the table', async () => {
    const save = vi.fn().mockResolvedValue(false), activity = vi.fn();
    await mount(table(), { onSave: save, onEditingChange: activity });
    const handle = button('调整第1列宽度'); await event(handle, 'pointerdown', { clientX: 100 }); await event(handle, 'pointermove', { clientX: 180 });
    expect((host.querySelector('col') as HTMLElement).style.width).toBe('280px');
    await mount(table({ locked: true, version: 2 }), { onSave: save, onEditingChange: activity });
    expect((host.querySelector('col') as HTMLElement).style.width).toBe('200px'); expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(save).not.toHaveBeenCalled(); expect(activity.mock.lastCall?.[0]).toBe(false);
  });
  it('converts screen drag distance at the current zoom into persisted column widths and outer width', async () => {
    const { save, current } = await editable();
    const wrapper = host.querySelector('.studio-native-table')!;
    wrapper.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 90, width: 200, height: 90, toJSON() {} });
    const handle = button('调整第1列宽度'); await event(handle, 'pointerdown', { clientX: 100 }); await event(handle, 'pointermove', { clientX: 125 }); await event(handle, 'pointerup', { clientX: 125 });
    expect(save.mock.calls[0]![0]).toMatchObject({ w: 450, data: { columnWidths: [250, 200], rows: [['A', 'B'], ['C', 'D']] } });
    expect(current().w).toBe(450); expect((host.querySelector('col') as HTMLElement).style.width).toBe('250px');
  });

  it('cancels a column drag without saving and keeps locked tables editable without geometry handles', async () => {
    const { save } = await editable(); const handle = button('调整第1列宽度');
    await event(handle, 'pointerdown', { clientX: 100 }); await event(handle, 'pointermove', { clientX: 180 }); await event(handle, 'pointercancel');
    expect(save).not.toHaveBeenCalled(); expect((host.querySelector('col') as HTMLElement).style.width).toBe('200px');
    await act(async () => root.render(null));
    const { save: lockedSave, current } = await editable(table({ locked: true }));
    expect(host.querySelector('[role="separator"]')).toBeNull();
    await event(cell(0, 0), 'dblclick'); await type('Locked content'); await key(editor(), 'Escape');
    expect(current().data?.rows).toEqual([['Locked content', 'B'], ['C', 'D']]);
    expect(lockedSave.mock.calls[0]![0]).not.toHaveProperty('w');
    await event(button('添加表格列'), 'click'); expect(current().w).toBe(400); expect(current().data?.rows).toEqual([['Locked content', 'B', ''], ['C', 'D', '']]);
  });

  it('persists cell and column edits through the real CAS service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-native-table-')), service = new StudioService({ dataRoot: folder });
    try {
      const fixture = await service.execute('artifact_manage', { action: 'create', title: 'Table', elements: [table()] }, LOCAL_ACTOR) as { board: Board };
      function Harness() {
        const [element, setElement] = useState(fixture.board.elements[0]!);
        return <NativeTable element={element} selected canEdit onEditingChange={() => {}} onSave={async (changes, base) => {
          const result = await service.execute('artifact_apply', { artifactId: fixture.board.artifact.id, operationId: crypto.randomUUID(), expectedVersions: { [base.id]: base.version }, operations: [{ op: 'update', id: base.id, changes }] }, LOCAL_ACTOR) as { board: Board };
          const saved = result.board.elements[0]!; setElement(saved); return saved;
        }} />;
      }
      await act(async () => root.render(<Harness />)); await event(cell(0, 0), 'dblclick'); await type('Persisted cell'); await key(editor(), 'Escape');
      await waitUntil(() => host.querySelector('[role="textbox"]') === null);
      const handle = button('调整第1列宽度'); await event(handle, 'pointerdown', { clientX: 100 }); await event(handle, 'pointermove', { clientX: 120 }); await event(handle, 'pointerup', { clientX: 120 });
      await waitUntil(() => !(button('添加表格行') as HTMLButtonElement).disabled);
      const result = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id }, LOCAL_ACTOR) as Board;
      expect(result.elements[0]).toMatchObject({ version: 3, w: 420, data: { source: 'preserve', rows: [['Persisted cell', 'B'], ['C', 'D']], columnWidths: [220, 200] } });
    } finally { await act(async () => root.render(null)); await service.close(); await rm(folder, { recursive: true, force: true }); }
  });
});
