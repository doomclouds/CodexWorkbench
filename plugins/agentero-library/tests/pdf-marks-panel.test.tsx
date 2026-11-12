import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { MarkList, ReaderMark } from '../src/contracts/reader';

const harness = vi.hoisted(() => ({ states: [] as unknown[], index: 0, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = harness.index++; const setter = vi.fn(); harness.setters[index] = setter; return [index in harness.states ? harness.states[index] : typeof initial === 'function' ? (initial as () => unknown)() : initial, setter]; },
  useRef: (current: unknown) => ({ current }), useEffect: vi.fn(),
}));
vi.mock('../src/app/api', () => ({ callTool: vi.fn() }));
import { MarksPanel, SelectionToolbar } from '../src/app/pdf/ReaderPanels';
import { NotesSplitter, notesPaneLayout } from '../src/app/pdf/NotesSplitter';

afterEach(() => { harness.states = []; harness.index = 0; harness.setters = []; });
function find(node: ReactNode, predicate: (node: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element) ? element : find(element.props.children, predicate);
}
const mark = (id: string, page: number): ReaderMark => ({ id, page, kind: 'highlight', space: 'pt', rects: [], quote: `source ${id}`, note: '', comment: `comment ${id}` });
const list: MarkList = { vaultId: 'test-vault', paperPath: 'papers/synthetic', revision: 'rev-1', items: [mark('a', 7), mark('b', 7), mark('c', 8), mark('d', 12)] };
function panel(checkedIds = new Set<string>(), overrides: Record<string, unknown> = {}) {
  harness.index = 0;
  return MarksPanel({ list, selectedId: null, busy: false, error: '', onSelect: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onReply: vi.fn(), onRefresh: vi.fn(), onExport: vi.fn(), onClose: vi.fn(), checkedIds, onCheckedChange: vi.fn(), canAttach: true, onAttach: vi.fn(), ...overrides });
}
test('page and individual handlers support noncontiguous selection, partial groups and reopening', () => {
  let selected = new Set<string>(); const onCheckedChange = vi.fn((next: Set<string>) => { selected = next; });
  let view = panel(selected, { onCheckedChange });
  find(view, node => node.props['aria-label'] === '选择物理第 7 页的筛选批注')!.props.onClick();
  view = panel(selected, { onCheckedChange });
  find(view, node => node.props['aria-label'] === '选择物理第 12 页的筛选批注')!.props.onClick();
  view = panel(selected, { onCheckedChange });
  find(view, node => node.props['aria-label'] === '选择第 7 页批注 source b')!.props.onChange();
  expect([...selected]).toEqual(['a', 'd']);
  const reopened = renderToStaticMarkup(panel(selected, { onCheckedChange }));
  expect(reopened).toContain('已选 2 条 / 2 页'); expect(reopened).toContain('aria-checked="mixed"');
  expect(reopened).toContain('aria-pressed="mixed"');
});
test('search, type and paging retain externally owned selection', () => {
  const selected = new Set(['a', 'd']); const onCheckedChange = vi.fn();
  const view = panel(selected, { onCheckedChange });
  find(view, node => node.props['aria-label'] === '搜索批注')!.props.onChange({ target: { value: 'absent' } });
  find(view, node => node.props['aria-label'] === '批注类型')!.props.onChange({ target: { value: 'translate' } });
  expect(onCheckedChange).not.toHaveBeenCalled(); expect([...selected]).toEqual(['a', 'd']);
  harness.states = ['', 'all', false, false, 1];
  expect(renderToStaticMarkup(panel(selected, { onCheckedChange }))).toContain('已选 2 条 / 2 页');
});
test('native context attachment uses selected IDs, no extra task field, and rejects repeated clicks while pending', async () => {
  let finish!: () => void; const onAttach = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = panel(new Set(['a', 'd']), { onAttach });
  const button = find(view, node => node.type === 'button' && node.props.className === 'primary')!;
  button.props.onClick(); button.props.onClick();
  expect(onAttach).toHaveBeenCalledTimes(1); expect(onAttach).toHaveBeenCalledWith('summarize', ['a', 'd'], undefined);
  expect(find(view, node => node.type === 'textarea')).toBeUndefined(); finish(); await Promise.resolve();
});
test('write actions collect an explicit target before attaching', () => {
  harness.states = ['', 'all', false, false, 0, true]; const onAttach = vi.fn();
  const view = panel(new Set(['a']), { onAttach });
  find(view, node => node.props.role === 'menuitem' && node.props.children === '整理并更新已有笔记…')!.props.onClick();
  expect(harness.setters[6]).toHaveBeenCalledWith({ action: 'update-note', ids: ['a'] }); expect(onAttach).not.toHaveBeenCalled();
});
test('splitter supports keyboard resizing and narrow containers use an overlay', () => {
  const onChange = vi.fn(); const view = NotesSplitter({ width: 360, min: 300, max: 600, onChange });
  const preventDefault = vi.fn(); view.props.onKeyDown({ key: 'ArrowLeft', shiftKey: false, preventDefault });
  view.props.onKeyDown({ key: 'End', shiftKey: false, preventDefault }); view.props.onDoubleClick();
  expect(onChange.mock.calls.map(([width]) => width)).toEqual([380, 600, 360]);
  expect(notesPaneLayout(600, 500)).toMatchObject({ overlay: true, width: 480 });
  expect(notesPaneLayout(900, 700)).toMatchObject({ overlay: false, width: 532 });
  expect(notesPaneLayout(250, 360)).toMatchObject({ overlay: true, width: 234 });
});
test('splitter drag respects the PDF minimum and releases pointer capture', () => {
  const onChange = vi.fn(); const view = NotesSplitter({ width: 360, min: 300, max: 532, onChange });
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  view.props.onPointerDown({ button: 0, pointerId: 2, clientX: 500, currentTarget: target, preventDefault: vi.fn() });
  view.props.onPointerMove({ clientX: 200 }); view.props.onPointerMove({ clientX: 900 });
  expect(onChange.mock.calls.map(([width]) => width)).toEqual([532, 300]);
  view.props.onPointerUp({ pointerId: 2, currentTarget: target }); expect(target.releasePointerCapture).toHaveBeenCalledWith(2);
  view.props.onPointerMove({ clientX: 400 }); expect(onChange).toHaveBeenCalledTimes(2);
});
test('selection action attaches directly and keeps only the annotation comment input', () => {
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
  const onAsk = vi.fn(); const view = SelectionToolbar({ selection: { text: 'selected text', parts: [{ page: 7, rects: [], pageSize: { width: 600, height: 800 }, quote: 'selected text' }], x: 20, y: 30 }, busy: false, canSend: true, onCopy: vi.fn(), onMark: vi.fn(), onTranslate: vi.fn(), onAsk, onClose: vi.fn() });
  find(view, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('带到对话'))!.props.onClick();
  expect(onAsk).toHaveBeenCalledOnce(); expect(find(view, node => node.type === 'textarea')).toBeUndefined(); vi.unstubAllGlobals();
});
