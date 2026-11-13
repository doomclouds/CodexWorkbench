import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteDocument } from '../src/contracts/types';

const harness = vi.hoisted(() => ({ slots: [] as any[], index: 0, pending: [] as (() => void)[], call: vi.fn(), poll: vi.fn(), stop: vi.fn(), teardown: vi.fn(), dirty: vi.fn() }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (compute: () => unknown, dependencies?: unknown[]) => {
    const index = harness.index++; const old = harness.slots[index];
    if (!old || !same(old.dependencies, dependencies)) harness.slots[index] = { value: compute(), dependencies };
    return harness.slots[index].value;
  };
  return { ...actual,
    useRef: (value: unknown) => { const index = harness.index++; if (!(index in harness.slots)) harness.slots[index] = { current: value }; return harness.slots[index]; },
    useState: (initial: unknown) => { const index = harness.index++; if (!(index in harness.slots)) harness.slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [harness.slots[index].value, (next: unknown) => { harness.slots[index].value = typeof next === 'function' ? next(harness.slots[index].value) : next; }]; },
    useMemo: memo,
    useCallback: (callback: unknown, dependencies?: unknown[]) => memo(() => callback, dependencies),
    useEffect: (effect: () => (() => void) | void, dependencies?: unknown[]) => {
      const index = harness.index++; const old = harness.slots[index];
      if (!old || !same(old.dependencies, dependencies)) { harness.slots[index] = { dependencies, cleanup: old?.cleanup }; harness.pending.push(() => { old?.cleanup?.(); harness.slots[index].cleanup = effect(); }); }
    },
  };
});
vi.mock('../src/app/api', () => ({ callTool: harness.call }));
vi.mock('../src/app/bridge', () => ({ openLink: vi.fn(), registerBeforeTeardown: (callback: unknown) => { harness.teardown(callback); return vi.fn(); } }));
vi.mock('../src/app/activity', () => ({ startSequentialPoll: (callback: () => Promise<void>) => { harness.poll(callback); return { stop: harness.stop, trigger: callback }; } }));
vi.mock('../src/app/notes/MarkdownEditor', () => ({ MarkdownEditor: () => null }));
import { NotesView, type NotesController } from '../src/app/NotesView';
import { MarkdownEditor } from '../src/app/notes/MarkdownEditor';
import { NewNoteDialog, NoteActionDialog } from '../src/app/notes/NoteDialogs';
import { NoteTree } from '../src/app/notes/NoteTree';
import { AnchoredMenu } from '../src/app/ui/AnchoredMenu';

function all(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(all);
  return [node, ...all(node.props?.children)];
}
function find(tree: ReactElement, predicate: (node: any) => boolean): any { const result = all(tree).find(predicate); if (!result) throw new Error('Expected UI element not found'); return result; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
const first: NoteDocument = { vaultId: 'owned', path: 'notes/论文/paper--id/first.md', content: '# First\n', revision: 'r1', exists: true, paperId: 'id', paperPath: 'papers/one', paperTitle: 'Paper One' };
const second: NoteDocument = { ...first, path: 'notes/论文/paper--id/second.md', content: '# Second\n', revision: 'r2' };

beforeEach(() => {
  harness.slots = []; harness.index = 0; harness.pending = [];
  vi.stubGlobal('window', Object.assign(new EventTarget(), { document: { visibilityState: 'visible' } })); vi.useFakeTimers();
});
afterEach(() => { for (const slot of harness.slots) slot?.cleanup?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function setup() {
  const documents = new Map([first, second].map(document => [document.path, { ...document }]));
  harness.call.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'note_tree') return { vaultId: 'owned', items: [...documents.values()].map(document => ({ ...document, name: document.path.split('/').at(-1), parentPath: document.path.split('/').slice(0, -1).join('/'), kind: 'file' })), truncated: false };
    if (tool === 'note_read') return documents.get(String(args.path));
    if (tool === 'note_write') { const next = { ...documents.get(String(args.path))!, content: String(args.content), revision: 'saved-revision' }; documents.set(next.path, next); return next; }
    throw new Error(`Unexpected tool ${tool}`);
  });
  let controller: NotesController | null = null;
  const props: Parameters<typeof NotesView>[0] = { active: true, vaultId: 'owned', preview: false, compact: true, paperPath: 'papers/one', requestedTarget: null, onDirtyChange: harness.dirty, onControllerReady: (value: NotesController | null) => { controller = value; } };
  let tree!: ReactElement<{ className: string }>;
  const render = () => { harness.index = 0; tree = NotesView(props); const effects = harness.pending.splice(0); effects.forEach(effect => effect()); return tree; };
  render(); await settle(); render(); await settle(); render();
  return { props, documents, render, get tree() { return tree; }, get controller() { return controller!; } };
}

it('saves the current draft before opening another normal paper-linked note', async () => {
  const ctx = await setup(); harness.call.mockClear();
  find(ctx.tree, node => node.type === MarkdownEditor).props.onChange('# Local draft\n'); ctx.render();
  expect(ctx.controller.isDirty()).toBe(true);
  find(ctx.tree, node => node.props?.['aria-label'] === '当前论文的笔记').props.onChange({ target: { value: second.path } });
  await settle(); ctx.render();
  expect(harness.call.mock.calls[0]).toEqual(['note_write', expect.objectContaining({ path: first.path, revision: 'r1', content: '# Local draft\n' })]);
  expect(harness.call.mock.calls[1]).toEqual(['note_read', { vaultId: 'owned', path: second.path }]);
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(second.content);
  expect(ctx.controller.isDirty()).toBe(false);
  expect(harness.call.mock.calls.some(([, args]) => args.paperPath && !args.path)).toBe(false);
});

it('retains a conflicted draft and blocks switching, creating and teardown', async () => {
  const ctx = await setup();
  const base = harness.call.getMockImplementation()!;
  harness.call.mockImplementation((tool: string, args: unknown) => tool === 'note_write' ? Promise.reject({ code: 'NOTE_CONFLICT', message: 'Owned conflict' }) : base(tool, args));
  find(ctx.tree, node => node.type === MarkdownEditor).props.onChange('# Keep my draft\n');
  expect(await ctx.controller.flush()).toBe(false); ctx.render(); harness.call.mockClear();
  find(ctx.tree, node => node.props?.['aria-label'] === '当前论文的笔记').props.onChange({ target: { value: second.path } });
  await settle(); ctx.render();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe('# Keep my draft\n');
  expect(harness.call).not.toHaveBeenCalled();
  find(ctx.tree, node => node.props?.['aria-label'] === '新建当前论文笔记').props.onClick(); ctx.render();
  await expect(find(ctx.tree, node => node.type === NewNoteDialog).props.onCreate({ title: 'New', paperPath: 'papers/one' })).rejects.toThrow('草稿');
  await expect(harness.teardown.mock.calls[0][0]()).rejects.toThrow('草稿');
  expect(ctx.controller.isDirty()).toBe(true); expect(harness.call).not.toHaveBeenCalled();
});

it('creates in the selected folder and trashes only the normal note with its saved revision', async () => {
  const ctx = await setup(); const base = harness.call.getMockImplementation()!;
  const created = { ...first, path: 'notes/selected/New.md', content: '# New\n', revision: 'created-r' };
  harness.call.mockImplementation((tool: string, args: unknown) => tool === 'note_create' ? Promise.resolve(created) : tool === 'note_trash' ? Promise.resolve({ trashed: true }) : base(tool, args));
  find(ctx.tree, node => node.props?.['aria-label'] === '新建当前论文笔记').props.onClick(); ctx.render();
  await find(ctx.tree, node => node.type === NewNoteDialog).props.onCreate({ title: 'New', folderPath: 'notes/selected', paperPath: 'papers/one' }); ctx.render();
  expect(harness.call).toHaveBeenCalledWith('note_create', { vaultId: 'owned', title: 'New', folderPath: 'notes/selected', paperPath: 'papers/one' });
  find(ctx.tree, node => node.props?.['aria-label'] === '当前笔记的操作').props.onClick({ currentTarget: {} }); ctx.render();
  find(ctx.tree, node => node.props?.role === 'menuitem' && node.props?.className === 'danger-text').props.onClick();
  await settle(); ctx.render();
  await find(ctx.tree, node => node.type === NoteActionDialog).props.onSubmit({ name: 'New', folderPath: 'notes/selected', paperPath: 'papers/one' }); ctx.render();
  expect(harness.call).toHaveBeenCalledWith('note_trash', { vaultId: 'owned', path: created.path, revision: 'created-r' });
  expect(harness.call.mock.calls.some(([tool]) => /paper_delete|restore/.test(tool))).toBe(false);
  expect(ctx.controller.isDirty()).toBe(false);
});

it('stops hidden polling and remounts the same saved document when the compact pane returns', async () => {
  const ctx = await setup(); harness.call.mockClear();
  const inspect = harness.poll.mock.calls.at(-1)![0];
  (window.document as unknown as { visibilityState: string }).visibilityState = 'hidden'; await inspect(); expect(harness.call).not.toHaveBeenCalled();
  ctx.props.active = false; ctx.render(); expect(harness.stop).toHaveBeenCalled(); expect(all(ctx.tree).some(node => node.type === MarkdownEditor)).toBe(false);
  (window.document as unknown as { visibilityState: string }).visibilityState = 'visible'; ctx.props.active = true; ctx.render(); await settle(); ctx.render();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(first.content);
});

it.each([false, true])('disposes the portal menu when notes become inactive and does not reopen it (compact=%s)', async compact => {
  const ctx = await setup(); ctx.props.compact = compact; ctx.render(); await settle(); ctx.render();
  find(ctx.tree, node => node.props?.['aria-label'] === '当前笔记的操作').props.onClick({ currentTarget: {} }); ctx.render();
  expect(all(ctx.tree).some(node => node.type === AnchoredMenu)).toBe(true);
  ctx.props.active = false; ctx.render();
  expect(all(ctx.tree).some(node => node.type === AnchoredMenu)).toBe(false);
  ctx.props.active = true; ctx.render(); await settle(); ctx.render();
  expect(all(ctx.tree).some(node => node.type === AnchoredMenu)).toBe(false);
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(first.content);
});

it('clears the previous paper note when the next paper has no associated notes', async () => {
  const ctx = await setup(); const base = harness.call.getMockImplementation()!;
  harness.call.mockImplementation((tool: string, args: Record<string, unknown>) => tool === 'note_tree' && args.paperPath === 'papers/empty' ? Promise.resolve({ vaultId: 'owned', items: [], truncated: false }) : base(tool, args));
  ctx.props.paperPath = 'papers/empty'; ctx.render(); await settle(); ctx.render();
  expect(all(ctx.tree).some(node => node.type === MarkdownEditor)).toBe(false);
  expect(ctx.controller.isDirty()).toBe(false);
});

it('opens an explicit paper request in the full workspace without overriding later tree choices', async () => {
  const ctx = await setup(); const other = { ...second, path: 'notes/other.md', paperPath: 'papers/two', content: '# Other\n' }; ctx.documents.set(other.path, other);
  ctx.props.compact = false; ctx.props.paperPath = undefined; ctx.props.requestedTarget = { paperPath: 'papers/two' };
  ctx.render(); await settle(); ctx.render(); expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(other.content);
  find(ctx.tree, node => node.type === NoteTree).props.onOpen(first.path); await settle(); ctx.render();
  find(ctx.tree, node => node.props?.['aria-label'] === '刷新笔记列表').props.onClick(); ctx.render(); await settle(); ctx.render();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(first.content);
  ctx.props.requestedTarget = { paperPath: 'papers/two' }; ctx.render(); await settle(); ctx.render();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(other.content);
});

it('keeps a manually selected note when returning from a hidden body editor', async () => {
  const ctx = await setup(); ctx.props.requestedTarget = { path: first.path }; ctx.render(); await settle(); ctx.render();
  find(ctx.tree, node => node.props?.['aria-label'] === '当前论文的笔记').props.onChange({ target: { value: second.path } }); await settle(); ctx.render();
  ctx.props.active = false; ctx.render(); ctx.props.active = true; ctx.render(); await settle(); ctx.render();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(second.content);
});

it('hands the selected compact note to the full workspace after saving, even when another note sorts first', async () => {
  const ctx = await setup(); const onOpenWorkspace = vi.fn(); ctx.props.onOpenWorkspace = onOpenWorkspace; ctx.render();
  find(ctx.tree, node => node.props?.['aria-label'] === '当前论文的笔记').props.onChange({ target: { value: second.path } }); await settle(); ctx.render();
  find(ctx.tree, node => node.type === MarkdownEditor).props.onChange('# Selected draft\n'); ctx.render();
  find(ctx.tree, node => node.props?.['aria-label'] === '当前笔记的操作').props.onClick({ currentTarget: {} }); ctx.render();
  find(ctx.tree, node => node.props?.title === '打开完整笔记工作区').props.onClick(); await settle(); ctx.render();
  expect(ctx.documents.get(second.path)?.content).toBe('# Selected draft\n');
  expect(onOpenWorkspace).toHaveBeenCalledWith({ path: second.path, title: 'second', paperPath: 'papers/one' });
  ctx.props.compact = false; ctx.props.paperPath = undefined; ctx.props.requestedTarget = { path: onOpenWorkspace.mock.calls[0][0].path };
  ctx.render(); await settle(); ctx.render();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe('# Selected draft\n');
  expect(find(ctx.tree, node => node.type === NoteTree).props.selectedPath).toBe(second.path);
});

it('does not hand a compact conflicted note to the full workspace', async () => {
  const ctx = await setup(); const onOpenWorkspace = vi.fn(); ctx.props.onOpenWorkspace = onOpenWorkspace; ctx.render();
  const base = harness.call.getMockImplementation()!;
  harness.call.mockImplementation((tool: string, args: unknown) => tool === 'note_write' ? Promise.reject({ code: 'NOTE_CONFLICT', message: 'Owned handoff conflict' }) : base(tool, args));
  find(ctx.tree, node => node.type === MarkdownEditor).props.onChange('# Keep compact draft\n'); ctx.render();
  find(ctx.tree, node => node.props?.['aria-label'] === '当前笔记的操作').props.onClick({ currentTarget: {} }); ctx.render();
  find(ctx.tree, node => node.props?.title === '打开完整笔记工作区').props.onClick(); await settle(); ctx.render();
  expect(onOpenWorkspace).not.toHaveBeenCalled();
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe('# Keep compact draft\n');
});

it('shows association actions instead of filesystem mutation actions for a logical paper group', async () => {
  const ctx = await setup(); ctx.props.compact = false; ctx.render(); await settle(); ctx.render();
  find(ctx.tree, node => node.type === NoteTree).props.onMenu({ kind: 'group', paperPath: 'papers/one', name: 'Paper One' }, { point: { x: 40, y: 80 } }); ctx.render();
  const labels = all(ctx.tree).filter(node => node.props?.role === 'menuitem').map(node => all(node).filter(child => typeof child.type === 'string').map(child => child.props?.children).flat());
  expect(JSON.stringify(labels)).not.toMatch(/重命名|移动到|移入回收站/);
  find(ctx.tree, node => node.props?.role === 'menuitem').props.onClick(); ctx.render();
  const dialog = find(ctx.tree, node => node.type === NewNoteDialog);
  expect(dialog.props.paperPath).toBe('papers/one'); expect(dialog.props.folderPath).toBe('notes');
});

it('closes a narrow tree only after a note opens successfully and offers a backdrop', async () => {
  const ctx = await setup(); ctx.props.compact = false; ctx.render(); await settle(); ctx.render();
  const frame = { getBoundingClientRect: () => ({ width: 480 }), querySelector: () => null };
  (ctx.tree.props as any).ref.current = frame;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  expect(all(ctx.tree).some(node => node.props?.['aria-label'] === '关闭笔记目录')).toBe(true);
  find(ctx.tree, node => node.type === NoteTree).props.onOpen(second.path); await settle(); ctx.render();
  expect(ctx.tree.props.className).toContain('note-list-collapsed');
  expect(all(ctx.tree).some(node => node.type === NoteTree)).toBe(false);
  find(ctx.tree, node => node.props?.['aria-label'] === '展开笔记列表').props.onClick(); ctx.render();
  const base = harness.call.getMockImplementation()!;
  harness.call.mockImplementation((tool: string, args: unknown) => tool === 'note_read' ? Promise.reject(new Error('Unavailable')) : base(tool, args));
  find(ctx.tree, node => node.type === NoteTree).props.onOpen(first.path); await settle(); ctx.render();
  expect(ctx.tree.props.className).not.toContain('note-list-collapsed');
  expect(find(ctx.tree, node => node.type === MarkdownEditor).props.value).toBe(second.content);
});
