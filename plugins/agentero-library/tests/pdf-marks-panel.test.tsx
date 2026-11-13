import type { ReactElement, ReactNode } from 'react';
import { useLayoutEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { MarkList, ReaderMark } from '../src/contracts/reader';

const harness = vi.hoisted(() => ({ states: [] as unknown[], index: 0, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = harness.index++; const setter = vi.fn(); harness.setters[index] = setter; return [index in harness.states ? harness.states[index] : typeof initial === 'function' ? (initial as () => unknown)() : initial, setter]; },
  useRef: (current: unknown) => ({ current }), useEffect: vi.fn(), useLayoutEffect: vi.fn(),
}));
vi.mock('../src/app/api', () => ({ callTool: vi.fn() }));
import { ColorPicker, MarkEditor, MarksPanel, SelectionToolbar, selectionMenuPlacement, type MarkEditorDraft } from '../src/app/pdf/ReaderPanels';
import { NotesSplitter, notesPaneLayout } from '../src/app/pdf/NotesSplitter';
import { createAnnotationWorkspaceState } from '../src/app/pdf/annotation-workspace';
import { savePendingAnnotationDrafts } from '../src/app/pdf/AnnotationsWorkspace';

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
  find(view, node => node.props.label === '选择物理第 7 页的筛选批注')!.props.onChange();
  view = panel(selected, { onCheckedChange });
  find(view, node => node.props.label === '选择物理第 12 页的筛选批注')!.props.onChange();
  view = panel(selected, { onCheckedChange });
  find(view, node => node.props['aria-label'] === '选择第 7 页批注 source b')!.props.onChange();
  expect([...selected]).toEqual(['a', 'd']);
  const reopened = renderToStaticMarkup(panel(selected, { onCheckedChange }));
  expect(reopened).toContain('已选 2 条 / 2 页'); expect(reopened).toContain('aria-checked="mixed"');
  expect(reopened).toContain('pdf-mark-page-select'); expect(reopened).toContain('pdf-mark-page-children');
  expect(reopened).not.toContain('pdf-mark-pages'); expect(reopened).toContain('对话来源');
});
test('search and type filters retain externally owned selection and expose hidden selected count', () => {
  const selected = new Set(['a', 'd']); const onCheckedChange = vi.fn();
  const onStateChange = vi.fn(); const state = { ...createAnnotationWorkspaceState(), filtersOpen: true, listScrollTop: 480, managerScrollTop: 900 };
  const view = panel(selected, { onCheckedChange, onStateChange, state });
  find(view, node => node.props['aria-label'] === '搜索批注')!.props.onChange({ target: { value: 'absent' } });
  find(view, node => node.props['aria-label'] === '批注类型')!.props.onChange({ target: { value: 'translate' } });
  expect(onCheckedChange).not.toHaveBeenCalled(); expect([...selected]).toEqual(['a', 'd']);
  expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'absent', kind: 'translate', listScrollTop: 0, managerScrollTop: 0 }));
  const hidden = renderToStaticMarkup(panel(selected, { state: { ...state, query: 'source b' } }));
  expect(hidden).toContain('已选 2 条 / 2 页'); expect(hidden).toContain('2 条已选被筛选隐藏');
});

test('view selected reveals hidden checked marks, pauses filters and restores retained filters on return', () => {
  const selected = new Set(['a', 'd']); const onStateChange = vi.fn();
  const state = { ...createAnnotationWorkspaceState(), query: 'absent', kind: 'translate', color: 'purple' as const, commentsOnly: true, pageRange: '999', currentPageOnly: true, filtersOpen: true };
  let view = panel(selected, { state, onStateChange });
  expect(find(view, node => node.props['aria-label'] === '编辑批注 a')).toBeUndefined();
  find(view, node => node.type === 'button' && node.props.children === '查看已选')!.props.onClick();
  const selectedState = onStateChange.mock.calls.at(-1)![0]; expect(selectedState).toMatchObject({ ...state, selectedOnly: true });
  view = panel(selected, { state: selectedState, onStateChange });
  expect(find(view, node => node.props['aria-label'] === '编辑批注 a')).toBeDefined(); expect(find(view, node => node.props['aria-label'] === '编辑批注 d')).toBeDefined(); expect(find(view, node => node.props['aria-label'] === '编辑批注 b')).toBeUndefined();
  expect(find(view, node => node.props['aria-label'] === '搜索批注')).toBeUndefined(); expect(find(view, node => node.props['aria-label'] === '筛选批注')).toBeUndefined(); expect(find(view, node => node.props.className === 'annotation-filter-options')).toBeUndefined(); expect(find(view, node => node.props.role === 'alert')).toBeUndefined();
  expect(find(view, node => node.props.role === 'status' && node.props.children === '暂停其他筛选')).toBeDefined();
  find(view, node => node.type === 'button' && node.props.children === '返回筛选结果')!.props.onClick();
  const returned = onStateChange.mock.calls.at(-1)![0]; expect(returned).toMatchObject(state); expect(returned.selectedOnly).toBe(false);
  view = panel(selected, { state: returned }); expect(find(view, node => node.props['aria-label'] === '搜索批注')!.props.value).toBe('absent'); expect(find(view, node => node.props.role === 'alert')).toBeDefined();
});

test('clear exits selected view and empty selection still offers return to retained filters', () => {
  const state = { ...createAnnotationWorkspaceState(), selectedOnly: true, query: 'source b' }; const onStateChange = vi.fn(); const onCheckedChange = vi.fn();
  let view = panel(new Set(['a']), { state, onStateChange, onCheckedChange }); find(view, node => node.type === 'button' && node.props.children === '清空')!.props.onClick();
  expect(onCheckedChange).toHaveBeenCalledWith(new Set()); expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ selectedOnly: false, query: 'source b' }));
  view = panel(new Set(), { state, onStateChange }); expect(find(view, node => node.props.className === 'pdf-mark-batch-bar')).toBeUndefined();
  find(view, node => node.type === 'button' && node.props.children === '返回筛选结果')!.props.onClick(); expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedOnly: false, query: 'source b' }));
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
  harness.states[2] = 'attach'; const onAttach = vi.fn();
  const view = panel(new Set(['a']), { onAttach });
  find(view, node => node.props.role === 'menuitem' && node.props.children === '整理并更新已有笔记…')!.props.onClick();
  expect(harness.setters[3]).toHaveBeenCalledWith({ action: 'update-note', ids: ['a'] }); expect(onAttach).not.toHaveBeenCalled();
});

test('list and editor are exclusive, return and Escape preserve drafts, close has its own callback', () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { reply: 'pending reply', color: 'pink' }]]); const onEndEdit = vi.fn(); const onClose = vi.fn();
  const view = panel(new Set(['a']), { selectedId: 'a', drafts, onEndEdit, onClose });
  expect(find(view, node => node.props.className === 'pdf-marks-list annotation-main-list')).toBeUndefined();
  expect(find(view, node => node.type === MarkEditor)).toBeDefined();
  find(view, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('返回批注'))!.props.onClick();
  expect(onEndEdit).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled(); expect(drafts.get('a')?.reply).toBe('pending reply');
  const preventDefault = vi.fn(); const stopPropagation = vi.fn();
  find(view, node => node.props['aria-label'] === '论文批注')!.props.onKeyDown({ key: 'Escape', preventDefault, stopPropagation });
  expect(onEndEdit).toHaveBeenCalledTimes(2); expect(stopPropagation).toHaveBeenCalledOnce(); expect(preventDefault).toHaveBeenCalledOnce();
  find(view, node => node.props['aria-label'] === '关闭批注侧栏')!.props.onClick(); expect(onClose).toHaveBeenCalledOnce();
  const reopened = renderToStaticMarkup(panel(new Set(['a']), { drafts })); expect(reopened).toContain('草稿'); expect(reopened).not.toContain('编辑批注</');
});

test('zero selection has a minimal footer and exports only appear in more menu', () => {
  const html = renderToStaticMarkup(panel()); expect(html).toContain('勾选批注后可带到对话'); expect(html).not.toContain('pdf-mark-batch-bar'); expect(html).not.toContain('导出 Markdown');
  harness.states[2] = 'more'; const onExport = vi.fn(); const view = panel(new Set(), { onExport });
  find(view, node => node.props.role === 'menuitem' && Array.isArray(node.props.children) && node.props.children.includes(' Markdown'))!.props.onClick();
  expect(onExport).toHaveBeenCalledWith('markdown');
});

test('select all covers filtered records beyond the rendered batch and manager page states use the same set', () => {
  const largeList = { ...list, items: Array.from({ length: 254 }, (_, index) => mark(String(index), index < 220 ? 7 : 8)) };
  const onCheckedChange = vi.fn(); let view = panel(new Set(), { list: largeList, onCheckedChange });
  expect(find(view, node => node.props['aria-label'] === '编辑批注 150')).toBeUndefined();
  find(view, node => node.props.label === '全选筛选结果')!.props.onChange(); expect(onCheckedChange.mock.calls[0][0].size).toBe(254);
  view = panel(new Set(['0']), { list: largeList, mode: 'manager' });
  expect(find(view, node => node.props.label === '页导航选择第 7 页筛选批注')!.props.state).toBe('some');
  expect(find(view, node => node.props.label === '选择物理第 7 页的筛选批注')!.props.state).toBe('some');
});

test('selection, preview and edit actions remain separate', () => {
  const onSelect = vi.fn(); const onPreviewMark = vi.fn(); const onLocate = vi.fn(); const onCheckedChange = vi.fn();
  const view = panel(new Set(), { mode: 'manager', onSelect, onPreviewMark, onLocate, onCheckedChange });
  find(view, node => node.props['aria-label'] === '选择第 7 页批注 source a')!.props.onChange(); expect(onSelect).not.toHaveBeenCalled(); expect(onPreviewMark).not.toHaveBeenCalled();
  find(view, node => node.props['aria-label'] === '预览批注 a 原文')!.props.onClick(); expect(onPreviewMark).toHaveBeenCalledWith(list.items[0]); expect(onLocate).not.toHaveBeenCalled();
  find(view, node => node.props['aria-label'] === '编辑批注 a')!.props.onClick(); expect(onSelect).toHaveBeenCalledWith(list.items[0]);
});

test('manager navigation renders the requested page using sorted expanded groups rather than storage order', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  const unsorted = { ...list, items: [mark('last-page-first', 20), ...Array.from({ length: 150 }, (_, index) => mark(`first-${index}`, 1))] }; const onStateChange = vi.fn();
  const view = panel(new Set(), { list: unsorted, mode: 'manager', onStateChange });
  find(view, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[1] === 20)!.props.onClick();
  expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ renderedLimit: 151 })); vi.unstubAllGlobals();
});

test('inactive workspaces pause source preview and keep draft confirmation closed until active again', () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { reply: 'retained reply' }]]); const pending = { action: 'summarize', ids: ['a'] }; harness.states[4] = pending;
  let view = panel(new Set(['a']), { mode: 'manager', active: false, drafts }); expect(view.props.preview.props.active).toBe(false);
  const nativeDialog = { showModal: vi.fn(), close: vi.fn() }; find(view, node => node.type === 'dialog')!.props.ref.current = nativeDialog;
  const inactiveEffect = vi.mocked(useLayoutEffect).mock.calls.findLast(([, deps]) => deps?.length === 2 && deps[0] === true && deps[1] === false)![0]; inactiveEffect(); expect(nativeDialog.showModal).not.toHaveBeenCalled();
  view = panel(new Set(['a']), { mode: 'manager', active: true, drafts }); expect(view.props.preview.props.active).toBe(true); find(view, node => node.type === 'dialog')!.props.ref.current = nativeDialog;
  const activeEffect = vi.mocked(useLayoutEffect).mock.calls.findLast(([, deps]) => deps?.length === 2 && deps[0] === true && deps[1] === true)![0]; const cleanup = activeEffect(); expect(nativeDialog.showModal).toHaveBeenCalledOnce(); if (typeof cleanup === 'function') cleanup(); expect(nativeDialog.close).toHaveBeenCalledOnce(); expect(drafts.get('a')?.reply).toBe('retained reply');
});

test('selected drafts require a choice, saved versions attach without clearing pending edits', async () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { reply: 'pending reply' }]]); const onAttach = vi.fn().mockResolvedValue(undefined); const onSave = vi.fn();
  let view = panel(new Set(['a']), { drafts, onAttach, onSave });
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick();
  expect(onAttach).not.toHaveBeenCalled(); harness.states[4] = harness.setters[4].mock.calls.at(-1)![0];
  view = panel(new Set(['a']), { drafts, onAttach, onSave });
  find(view, node => node.type === 'button' && node.props.children === '使用已保存版本')!.props.onClick();
  await Promise.resolve(); expect(onAttach).toHaveBeenCalledWith('summarize', ['a'], undefined); expect(onSave).not.toHaveBeenCalled(); expect(drafts.get('a')?.reply).toBe('pending reply');
});

test('save before attachment performs ordered writes and stops without attaching on failure', async () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { text: 'new note', reply: 'new reply' }], ['d', { color: 'pink' }]]); const comments = new Map([['a', 'new note']]); const events: string[] = [];
  const onSave = vi.fn(async (mark: ReaderMark) => { events.push(`save ${mark.id}`); }); const onReply = vi.fn(async () => { events.push('reply a'); throw new Error('reply failed'); }); const onAttach = vi.fn();
  let view = panel(new Set(['a', 'd']), { drafts, commentDrafts: comments, onSave, onReply, onAttach });
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick(); harness.states[4] = harness.setters[4].mock.calls.at(-1)![0];
  view = panel(new Set(['a', 'd']), { drafts, commentDrafts: comments, onSave, onReply, onAttach });
  find(view, node => node.type === 'button' && node.props.children === '保存后附加')!.props.onClick();
  for (let index = 0; index < 10; index++) await Promise.resolve();
  expect(events).toEqual(['save a', 'reply a']); expect(onAttach).not.toHaveBeenCalled(); expect(drafts.get('a')).toEqual({ reply: 'new reply' }); expect(drafts.get('d')).toEqual({ color: 'pink' }); expect(comments.has('a')).toBe(false); expect(harness.setters[5]).toHaveBeenCalledWith('reply failed');
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

test('color selection creates nothing; highlighter, underline and remark save are explicit actions', () => {
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
  const onMark = vi.fn(), onDraftChange = vi.fn();
  const props = { selection: { text: 'source', parts: [{ page: 7, rects: [], pageSize: { width: 600, height: 800 }, quote: 'source' }], x: 20, y: 300 }, busy: false, canSend: true, onCopy: vi.fn(), onMark, onTranslate: vi.fn(), onAsk: vi.fn(), onClose: vi.fn(), onDraftChange };
  const view = SelectionToolbar(props);
  find(view, node => node.type === ColorPicker)!.props.onChange('green');
  expect(onMark).not.toHaveBeenCalled(); expect(onDraftChange).toHaveBeenCalledWith({ mode: 'actions', text: '', color: 'green' });
  find(view, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('高亮'))!.props.onClick();
  find(view, node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('下划线'))!.props.onClick();
  expect(onMark.mock.calls).toEqual([['yellow', '', false], ['yellow', '', true]]);
  harness.index = 0;
  const remark = SelectionToolbar({ ...props, initialDraft: { mode: 'comment', text: 'retained remark', color: 'purple' }, docked: true });
  find(remark, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick();
  expect(onMark).toHaveBeenLastCalledWith('purple', 'retained remark', false);
  expect(renderToStaticMarkup(ColorPicker({ value: 'yellow', onChange: vi.fn() }))).not.toContain('lucide-check'); vi.unstubAllGlobals();
});

test('measured editor avoids source and stays inside the actual reading viewport', () => {
  const viewport = { left: 200, top: 100, right: 800, bottom: 700 };
  const source = { left: 250, top: 390, right: 700, bottom: 440 };
  expect(selectionMenuPlacement(source, viewport, 450, 200)).toEqual({ left: 250, top: 180 });
  expect(selectionMenuPlacement({ ...source, top: 120, bottom: 180 }, viewport, 450, 220)).toEqual({ left: 250, top: 190 });
  expect(selectionMenuPlacement({ left: 740, top: 200, right: 780, bottom: 600 }, viewport, 300, 200)).toEqual({ left: 430, top: 200 });
  expect(selectionMenuPlacement({ left: 220, top: 120, right: 780, bottom: 680 }, viewport, 450, 220)).toBeNull();
  expect(selectionMenuPlacement({ ...source, top: -80, bottom: -20 }, viewport, 450, 100)).toBeNull();
});

test('editing drafts survive switching marks and closing the panel, including failed saves', async () => {
  const drafts = new Map(), commentDrafts = new Map<string, string>(); const onSave = vi.fn().mockRejectedValue(new Error('save failed'));
  const props = { mark: list.items[0], vaultId: list.vaultId, paperPath: list.paperPath, busy: false, drafts, commentDrafts, onSave, onDelete: vi.fn(), onReply: vi.fn() };
  let view = MarkEditor(props);
  find(view, node => node.props['aria-label'] === '批注内容')!.props.onChange({ target: { value: 'unsaved A' } });
  harness.index = 0; MarkEditor({ ...props, mark: list.items[1] });
  harness.index = 0; view = MarkEditor(props);
  expect(find(view, node => node.props['aria-label'] === '批注内容')!.props.value).toBe('unsaved A');
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(onSave).toHaveBeenCalledWith(props.mark, 'unsaved A', 'yellow'); expect(commentDrafts.get('a')).toBe('unsaved A');
  expect(drafts.get('a').text).toBe('unsaved A');
});

test.each(['', 'pending reply'])('saved editor fields and replies clear before a later preview save; pending reply: %s', async reply => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { text: 'saved A', color: 'green', ...(reply ? { reply } : {}) }]]);
  const commentDrafts = new Map([['a', 'saved A']]); const onSave = vi.fn().mockResolvedValue(undefined); const onReply = vi.fn().mockResolvedValue(undefined);
  const props = { mark: list.items[0], vaultId: list.vaultId, paperPath: list.paperPath, busy: false, drafts, commentDrafts, onSave, onDelete: vi.fn(), onReply };
  const view = MarkEditor(props);
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(onSave).toHaveBeenCalledWith(props.mark, 'saved A', 'green');
  expect(drafts.get('a')).toBeUndefined(); expect(commentDrafts.has('a')).toBe(false);
  if (reply) expect(onReply).toHaveBeenCalledWith(props.mark, reply); else expect(onReply).not.toHaveBeenCalled();
  // Closing the sidebar and saving B through the preview must seed a reopened editor from B.
  const updated = { ...props.mark, comment: 'saved B', color: 'pink' as const }; commentDrafts.delete('a');
  harness.index = 0; const reopened = MarkEditor({ ...props, mark: updated });
  expect(find(reopened, node => node.props['aria-label'] === '批注内容')!.props.value).toBe('saved B');
  expect(find(reopened, node => node.type === ColorPicker)!.props.value).toBe('pink');
  expect(find(reopened, node => node.props['aria-label'] === '批注回复')).toBeUndefined();
  expect(find(reopened, node => node.type === 'button' && node.props.className === 'primary')!.props.disabled).toBe(true);
});

test('reply-only drafts are dirty and save-and-return waits for the reply write', async () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { reply: 'reply only' }]]); const onReturn = vi.fn(); const onSave = vi.fn(); let finish!: () => void;
  const onReply = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = MarkEditor({ mark: list.items[0], vaultId: list.vaultId, paperPath: list.paperPath, busy: false, drafts, onSave, onReply, onDelete: vi.fn(), onReturn });
  expect(find(view, node => node.props.role === 'status')!.props.children).toContain('修改未保存');
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick();
  expect(onSave).not.toHaveBeenCalled(); expect(onReply).toHaveBeenCalledWith(list.items[0], 'reply only'); expect(onReturn).not.toHaveBeenCalled();
  finish(); for (let index = 0; index < 5; index++) await Promise.resolve(); expect(onReturn).toHaveBeenCalledOnce(); expect(drafts.size).toBe(0);
});

test('save-and-return clears cached fields already saved by an external refresh without another write', async () => {
  const currentMark = { ...list.items[0], comment: 'externally saved text', color: 'green' as const };
  const drafts = new Map<string, MarkEditorDraft>([['a', { text: currentMark.comment, color: 'green' }]]); const commentDrafts = new Map([['a', currentMark.comment]]);
  const onReturn = vi.fn(); const onSave = vi.fn(); const onReply = vi.fn();
  const view = MarkEditor({ mark: currentMark, vaultId: list.vaultId, paperPath: list.paperPath, busy: false, drafts, commentDrafts, onSave, onReply, onDelete: vi.fn(), onReturn });
  expect(find(view, node => node.props.role === 'status')!.props.children).toBe('已保存');
  expect(find(view, node => node.type === 'small' && node.props.children === '可返回批注列表')).toBeDefined(); expect(find(view, node => node.props.children === '草稿未保存到论文')).toBeUndefined();
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(onSave).not.toHaveBeenCalled(); expect(onReply).not.toHaveBeenCalled(); expect(drafts.size).toBe(0); expect(commentDrafts.size).toBe(0); expect(onReturn).toHaveBeenCalledOnce();
});

test('failed save-and-return retains reply and color and does not return; discard explicitly removes them', async () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { color: 'green', reply: 'pending reply' }]]); const onReturn = vi.fn(); const onDraftsChange = vi.fn();
  const view = MarkEditor({ mark: list.items[0], vaultId: list.vaultId, paperPath: list.paperPath, busy: false, drafts, onSave: vi.fn().mockRejectedValue(new Error('save failed')), onReply: vi.fn(), onDelete: vi.fn(), onReturn, onDraftsChange });
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick(); for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(onReturn).not.toHaveBeenCalled(); expect(drafts.get('a')).toEqual({ color: 'green', reply: 'pending reply' }); expect(harness.setters[3]).toHaveBeenCalledWith('save failed');
  find(view, node => node.props.children === '放弃修改')!.props.onClick(); expect(drafts.size).toBe(0); expect(onReturn).toHaveBeenCalledOnce(); expect(onDraftsChange).toHaveBeenCalled();
});

test('draft cache retains multiple edits including reply and color across returning and reopening', () => {
  const drafts = new Map<string, MarkEditorDraft>(); const props = { mark: list.items[0], vaultId: list.vaultId, paperPath: list.paperPath, busy: false, drafts, onSave: vi.fn(), onDelete: vi.fn(), onReply: vi.fn(), onReturn: vi.fn() };
  const view = MarkEditor(props); find(view, node => node.props['aria-label'] === '批注内容')!.props.onChange({ target: { value: 'retained note' } }); find(view, node => node.type === ColorPicker)!.props.onChange('purple');
  // Opening the reply field does not itself create a draft.
  harness.index = 0; harness.states[6] = true; const withReply = MarkEditor(props); find(withReply, node => node.props['aria-label'] === '批注回复')!.props.onChange({ target: { value: 'retained reply' } });
  expect(drafts.get('a')).toEqual({ text: 'retained note', color: 'purple', reply: 'retained reply' });
  const stopPropagation = vi.fn(); withReply.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn(), stopPropagation }); expect(stopPropagation).toHaveBeenCalledOnce();
  harness.index = 0; harness.states = []; const reopened = MarkEditor(props); expect(find(reopened, node => node.props['aria-label'] === '批注内容')!.props.value).toBe('retained note'); expect(find(reopened, node => node.props['aria-label'] === '批注回复')!.props.value).toBe('retained reply'); expect(find(reopened, node => node.type === ColorPicker)!.props.value).toBe('purple');
});

test('attachment saves a selected draft set sequentially without revisiting successfully saved fields', async () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { text: 'A', color: 'green', reply: 'reply A' }], ['d', { text: 'D' }]]); const commentDrafts = new Map([['a', 'A'], ['d', 'D']]); const events: string[] = [];
  const onSave = vi.fn(async (mark: ReaderMark) => { events.push(`save ${mark.id}`); }); const onReply = vi.fn(async (mark: ReaderMark) => { events.push(`reply ${mark.id}`); });
  await savePendingAnnotationDrafts([list.items[0], list.items[3]], drafts, commentDrafts, onSave, onReply); expect(events).toEqual(['save a', 'reply a', 'save d']); expect(drafts.size).toBe(0); expect(commentDrafts.size).toBe(0);
});

test('draft changes while a write is pending are retained and block attachment completion', async () => {
  const drafts = new Map<string, MarkEditorDraft>([['a', { text: 'old submitted note', reply: 'submitted reply' }]]); const comments = new Map([['a', 'old submitted note']]); let finish!: () => void;
  const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })); const onReply = vi.fn(async () => { drafts.set('a', { ...drafts.get('a'), reply: 'new reply' }); });
  const saving = savePendingAnnotationDrafts([list.items[0]], drafts, comments, onSave, onReply);
  drafts.set('a', { text: 'newer note', color: 'purple', reply: 'submitted reply' }); comments.set('a', 'newer note'); finish();
  await expect(saving).rejects.toThrow('保存期间草稿已更新'); expect(drafts.get('a')).toEqual({ text: 'newer note', color: 'purple', reply: 'new reply' }); expect(comments.get('a')).toBe('newer note');
});
