import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibrarySettings, LibraryStatus, Paper } from '../src/contracts/types';

const harness = vi.hoisted(() => ({ slots: [] as any[], index: 0, pending: [] as (() => void)[], call: vi.fn(), hostUpdate: null as null | ((value: any) => void) }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (compute: () => unknown, dependencies?: unknown[]) => { const index = harness.index++; const old = harness.slots[index]; if (!old || !same(old.dependencies, dependencies)) harness.slots[index] = { value: compute(), dependencies }; return harness.slots[index].value; };
  return { ...actual,
    useRef: (value: unknown) => { const index = harness.index++; if (!(index in harness.slots)) harness.slots[index] = { current: value }; return harness.slots[index]; },
    useState: (initial: unknown) => { const index = harness.index++; if (!(index in harness.slots)) harness.slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [harness.slots[index].value, (next: unknown) => { harness.slots[index].value = typeof next === 'function' ? next(harness.slots[index].value) : next; }]; },
    useMemo: memo, useCallback: (callback: unknown, dependencies?: unknown[]) => memo(() => callback, dependencies),
    useEffect: (effect: () => (() => void) | void, dependencies?: unknown[]) => { const index = harness.index++; const old = harness.slots[index]; if (!old || !same(old.dependencies, dependencies)) { harness.slots[index] = { dependencies, cleanup: old?.cleanup }; harness.pending.push(() => { old?.cleanup?.(); harness.slots[index].cleanup = effect(); }); } },
  };
});
vi.mock('../src/app/api', () => ({ callTool: harness.call, VAULT_CHANGED_EVENT: 'test:changed' }));
vi.mock('../src/app/bridge', () => ({ getHostState: () => ({ connected: true, preview: false, theme: 'light', canSendSelection: true }), subscribeHost: (callback: (value: any) => void) => { harness.hostUpdate = callback; return vi.fn(); } }));
vi.mock('../src/app/activity', async original => ({ ...await original<typeof import('../src/app/activity')>(), useAppActivity: () => true }));
vi.mock('../src/app/LibraryView', () => ({ LibraryView: () => null }));
vi.mock('../src/app/PdfReader', () => ({ PdfReader: () => null }));
vi.mock('../src/app/NotesView', () => ({ NotesView: () => null }));
vi.mock('../src/app/PaperMarkdownView', () => ({ PaperMarkdownView: () => null }));
vi.mock('../src/app/TrashView', () => ({ TrashView: () => null }));
vi.mock('../src/app/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('../src/app/AppSidebar', () => ({ AppSidebar: () => null }));
import { App } from '../src/app/App';
import { NotesView } from '../src/app/NotesView';
import { PaperMarkdownView } from '../src/app/PaperMarkdownView';
import { PdfReader } from '../src/app/PdfReader';
import { LibraryView } from '../src/app/LibraryView';
import { AppSidebar } from '../src/app/AppSidebar';
import { SettingsPanel } from '../src/app/SettingsPanel';
import { previewSettings, previewStatus } from '../src/app/preview';

const settings: LibrarySettings = { ...previewSettings, vaultId: 'owned', vaultPath: '/owned' };
const status: LibraryStatus = { ...previewStatus, ready: true, vault: { ...previewStatus.vault, valid: true, vaultId: 'owned' }, capabilities: { ...previewStatus.capabilities, metadata: true } };
const paper = (path: string): Paper => ({ id: path, path, title: path.split('/').at(-1)!, authors: [], tags: [], isRead: false });
function nodes(node: any): any[] { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
function component(tree: ReactElement, type: unknown): any { const found = nodes(tree).find(node => node.type === type); if (!found) throw new Error('Expected component missing'); return found; }
async function settle() { for (let index = 0; index < 25; index++) await Promise.resolve(); }
beforeEach(() => { harness.slots = []; harness.index = 0; harness.pending = []; vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', { documentElement: { dataset: {} } }); vi.useFakeTimers(); });
afterEach(() => { for (const slot of harness.slots) slot?.cleanup?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function setup() {
  harness.call.mockImplementation(async (tool: string, args: any) => {
    if (tool === 'settings_read') return settings;
    if (tool === 'library_status') return status;
    if (tool === 'paper_get') return { ...paper(args.paperPath), vaultId: args.vaultId };
    throw new Error(`Unexpected tool ${tool}`);
  });
  let tree!: ReactElement;
  const render = () => { harness.index = 0; tree = App(); harness.pending.splice(0).forEach(effect => effect()); return tree; };
  render(); await settle(); render(); await settle(); render();
  const flush = vi.fn(async () => true);
  component(tree, NotesView).props.onControllerReady({ flush, isDirty: () => false });
  return { render, flush, get tree() { return tree; } };
}

it('retains a dirty paper body across tabs and blocks replacement by another paper body', async () => {
  const ctx = await setup(); component(ctx.tree, NotesView).props.onActiveNoteChange({ path: 'notes/one.md', title: 'One', paperPath: 'papers/one' }); ctx.render();
  component(ctx.tree, NotesView).props.onOpenPaperMarkdown(); await settle(); ctx.render();
  let body = component(ctx.tree, PaperMarkdownView); expect(body.props.paperPath).toBe('papers/one'); expect(body.props.active).toBe(true); expect(ctx.flush).toHaveBeenCalled();
  body.props.onDirtyChange(true); ctx.render(); body = component(ctx.tree, PaperMarkdownView); body.props.onBack(); ctx.render();
  expect(component(ctx.tree, PaperMarkdownView).props.active).toBe(false); expect(component(ctx.tree, NotesView).props.active).toBe(true);
  component(ctx.tree, NotesView).props.onActiveNoteChange({ path: 'notes/two.md', title: 'Two', paperPath: 'papers/two' }); ctx.render();
  component(ctx.tree, NotesView).props.onOpenPaperMarkdown(); await settle(); ctx.render();
  body = component(ctx.tree, PaperMarkdownView); expect(body.props.paperPath).toBe('papers/one'); expect(body.props.active).toBe(true);
  component(ctx.tree, AppSidebar).props.onSelect('library'); ctx.render();
  component(ctx.tree, LibraryView).props.onOpen(paper('papers/two')); ctx.render();
  expect(component(ctx.tree, PaperMarkdownView).props.paperPath).toBe('papers/one'); expect(component(ctx.tree, PaperMarkdownView).key).toBe(body.key);
  component(ctx.tree, AppSidebar).props.onSettings(); ctx.render(); expect(component(ctx.tree, SettingsPanel).props.dirty).toBe(true);
});

it('passes citation page and mark requests to the retained PDF reader and resets them for ordinary opening', async () => {
  const ctx = await setup(); await component(ctx.tree, NotesView).props.onOpenPaper('papers/one', 7, 'highlight-123'); ctx.render();
  const first = component(ctx.tree, PdfReader); expect(first.props.paper.path).toBe('papers/one'); expect(first.props.requestedPage).toBe(7); expect(first.props.requestedMarkId).toBe('highlight-123'); expect(first.props.active).toBe(true);
  await component(ctx.tree, NotesView).props.onOpenPaper('papers/one', 7, 'highlight-123'); ctx.render();
  expect(component(ctx.tree, PdfReader).props.requestKey).not.toBe(first.props.requestKey);
  component(ctx.tree, LibraryView).props.onOpen(paper('papers/two')); ctx.render();
  expect(component(ctx.tree, PdfReader).props.requestedPage).toBeUndefined(); expect(component(ctx.tree, PdfReader).props.requestedMarkId).toBeUndefined();
});

it('keeps a dirty body bound when an external Vault switch is detected', async () => {
  const ctx = await setup(); component(ctx.tree, PdfReader).props.onPaperMarkdown(paper('papers/one')); await settle(); ctx.render();
  component(ctx.tree, PaperMarkdownView).props.onDirtyChange(true); ctx.render();
  const original = harness.call.getMockImplementation()!;
  harness.call.mockImplementation((tool: string, args: unknown) => tool === 'settings_read' ? Promise.resolve({ ...settings, vaultId: 'external', vaultPath: '/external' }) : original(tool, args));
  component(ctx.tree, AppSidebar).props.onRefresh(); await settle(); ctx.render();
  expect(component(ctx.tree, PaperMarkdownView).props.vaultId).toBe('owned'); expect(component(ctx.tree, PaperMarkdownView).props.paperPath).toBe('papers/one');
  const load = nodes(ctx.tree).find(node => node.type === 'button' && node.props.children === '载入新知识库'); expect(load?.props.disabled).toBe(true);
});

it('blocks paper body entry when the ordinary note controller cannot flush its conflict', async () => {
  const ctx = await setup(); ctx.flush.mockResolvedValue(false);
  component(ctx.tree, PdfReader).props.onPaperMarkdown(paper('papers/one')); await settle(); ctx.render();
  expect(nodes(ctx.tree).some(node => node.type === PaperMarkdownView)).toBe(false); expect(component(ctx.tree, NotesView).props.active).toBe(true);
});

it('opens the exact reader note in the workspace and keeps the paper-only fallback', async () => {
  const ctx = await setup(); const selectedPath = 'notes/论文/one/nested/selected-A.md';
  component(ctx.tree, PdfReader).props.onNotes(paper('papers/one'), selectedPath); ctx.render();
  expect(component(ctx.tree, NotesView).props.active).toBe(true);
  expect(component(ctx.tree, NotesView).props.requestedTarget).toEqual({ path: selectedPath });
  component(ctx.tree, PdfReader).props.onNotes(paper('papers/one')); ctx.render();
  expect(component(ctx.tree, NotesView).props.requestedTarget).toEqual({ paperPath: 'papers/one' });
});
