import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Paper } from '../src/contracts/types';

const harness = vi.hoisted(() => ({ states: [] as any[], index: 0, refs: [] as any[], refIndex: 0, effects: [] as { effect: () => (() => void) | void; dependencies: unknown[] }[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = harness.index++; if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial; return [harness.states[index], (next: unknown) => { harness.states[index] = typeof next === 'function' ? next(harness.states[index]) : next; }]; },
  useRef: (current: unknown) => { const index = harness.refIndex++; return harness.refs[index] ??= { current }; }, useEffect: (effect: () => (() => void) | void, dependencies: unknown[] = []) => { harness.effects.push({ effect, dependencies }); }, useMemo: (compute: () => unknown) => compute(), useCallback: (callback: unknown) => callback,
}));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('../src/app/api', () => ({ callTool: vi.fn() }));
vi.mock('../src/app/bridge', () => ({ attachReadingContext: vi.fn(), openExternalLink: vi.fn(), registerBeforeTeardown: vi.fn() }));
vi.mock('../src/app/pdf-runtime', () => ({ createPdfWorker: vi.fn(), pdfjs: {} }));
vi.mock('../src/app/NotesView', () => ({ NotesView: () => null }));
vi.mock('../src/app/pdf/PageView', () => ({ PageView: () => null }));
vi.mock('../src/app/pdf/ReaderPanels', () => ({ MarksPanel: () => null, OutlinePanel: () => null, SelectionToolbar: () => null, TranslationCard: () => null }));
vi.mock('../src/app/pdf/ReaderTools', () => ({ ReaderTools: () => null, ReaderHud: () => null, ReaderLanguageSetting: () => null, TranslationLanguage: () => null }));
vi.mock('../src/app/pdf/NotesSplitter', () => ({ NotesSplitter: () => null, useNotesPaneLayout: () => ({ width: 360, min: 280, max: 700, overlay: false, setWidth: vi.fn() }) }));
vi.mock('../src/app/pdf/translation/useDocumentTranslation', () => ({ useDocumentTranslation: () => ({ pages: new Map(), running: false, progress: '', error: '', retry: vi.fn() }) }));
import { PdfReader } from '../src/app/pdf/Reader';
import { NotesView } from '../src/app/NotesView';
import { ReaderTools } from '../src/app/pdf/ReaderTools';
import { MarksPanel, SelectionToolbar } from '../src/app/pdf/ReaderPanels';
import { PageView } from '../src/app/pdf/PageView';
import { INITIAL_READER_VIEW } from '../src/app/pdf/reader-layout';

function find(node: any, type: unknown): any {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  return node.type === type ? node : find(node.props?.children, type);
}
function findProps(node: any, predicate: (props: any) => boolean): any {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => findProps(child, predicate)).find(Boolean);
  return predicate(node.props ?? {}) ? node : findProps(node.props?.children, predicate);
}
afterEach(() => { harness.states = []; harness.index = 0; harness.refs = []; harness.refIndex = 0; harness.effects = []; vi.unstubAllGlobals(); });
it('forwards the selected compact note path and supports a paper-only workspace request', () => {
  const paper: Paper = { id: 'one', path: 'papers/one', title: 'One', authors: [], tags: [], isRead: false };
  const onNotes = vi.fn();
  const render = () => { harness.index = 0; harness.refIndex = 0; return PdfReader({ active: true, vaultId: 'owned', paper, preview: false, canSend: false, canParse: false, onNotes, onOperation: vi.fn(), onBack: vi.fn(), readerToolsHost: {} as HTMLElement }); };
  let tree = render(); find(tree, ReaderTools).props.actions.toggleNotes(); tree = render();
  const compact = find(tree, NotesView); expect(compact.props.compact).toBe(true);
  compact.props.onOpenWorkspace({ path: 'notes/论文/one/nested/selected-A.md', title: 'Selected A', paperPath: paper.path });
  expect(onNotes).toHaveBeenLastCalledWith(paper, 'notes/论文/one/nested/selected-A.md');
  compact.props.onOpenWorkspace(); expect(onNotes).toHaveBeenLastCalledWith(paper, undefined);
  expect(findProps(tree, props => props.className === 'pdf-panel-heading')).toBeUndefined();
  compact.props.onCloseCompact(); tree = render(); expect(find(tree, NotesView).props.active).toBe(false);
});

it('scroll suspends a floating remark and resumes the same draft outside the PDF viewport', () => {
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, document: { body: {} }, getSelection: () => ({ removeAllRanges: vi.fn() }) });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  const paper: Paper = { id: 'one', path: 'papers/one', title: 'One', authors: [], tags: [], isRead: false };
  harness.states[20] = { text: 'original source', parts: [{ page: 7, rects: [], pageSize: { width: 600, height: 800 }, quote: 'original source' }], x: 30, y: 400 };
  harness.states[22] = { mode: 'comment', text: 'retained comment', color: 'green' };
  const render = () => { harness.index = 0; harness.refIndex = 0; return PdfReader({ active: true, vaultId: 'owned', paper, preview: false, canSend: false, canParse: false, onNotes: vi.fn(), onOperation: vi.fn(), onBack: vi.fn() }); };
  let tree = render(); expect(find(tree, SelectionToolbar).props.docked).toBe(false);
  findProps(tree, props => props.className?.includes('pdf-viewport parity-viewport')).props.onScroll();
  tree = render(); expect(find(tree, SelectionToolbar)).toBeUndefined();
  const resume = findProps(tree, props => props.className === 'pdf-selection-resume'); expect(resume).toBeDefined();
  findProps(resume, props => props.children === '继续编辑').props.onClick();
  tree = render(); const editor = find(tree, SelectionToolbar);
  expect(editor.props.docked).toBe(true); expect(editor.props.initialDraft).toEqual({ mode: 'comment', text: 'retained comment', color: 'green' });
  expect(editor.props.selection.text).toBe('original source');
});

it('opening the explicit annotation editor preserves the reading page and transfers the preview draft', () => {
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const paper: Paper = { id: 'one', path: 'papers/one', title: 'One', authors: [], tags: [], isRead: false };
  harness.states[0] = { numPages: 20 }; harness.states[6] = { ...INITIAL_READER_VIEW, pageNumber: 7, notesOpen: true };
  const render = () => { harness.index = 0; harness.refIndex = 0; return PdfReader({ active: true, vaultId: 'owned', paper, preview: false, canSend: false, canParse: false, onNotes: vi.fn(), onOperation: vi.fn(), onBack: vi.fn() }); };
  let tree = render(); const page = find(tree, PageView);
  const mark = { id: 'remark', kind: 'highlight', page: 12, space: 'pt', rects: [], quote: 'text', note: '', color: 'yellow' };
  page.props.onMark(mark, 'preview draft');
  tree = render(); const panel = find(tree, MarksPanel);
  expect(harness.states[6].pageNumber).toBe(7); expect(panel.props.selectedId).toBe('remark'); expect(panel.props.commentDrafts.get('remark')).toBe('preview draft');
  expect(panel.props.onLocate).toBeTypeOf('function');
});

it('Escape closes a visible selection first, then exits active tools while retaining its suspended draft', () => {
  const addEventListener = vi.fn(); vi.stubGlobal('Element', class {});
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, document: { body: {} }, addEventListener, removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  const paper: Paper = { id: 'one', path: 'papers/one', title: 'One', authors: [], tags: [], isRead: false };
  harness.states[20] = { text: 'source', parts: [{ page: 7, rects: [], pageSize: { width: 600, height: 800 }, quote: 'source' }], x: 30, y: 400 };
  harness.states[22] = { mode: 'comment', text: 'retained draft', color: 'green' };
  const render = () => { harness.index = 0; harness.refIndex = 0; harness.effects = []; return PdfReader({ active: true, vaultId: 'owned', paper, preview: false, canSend: false, canParse: false, onNotes: vi.fn(), onOperation: vi.fn(), onBack: vi.fn(), readerToolsHost: {} as HTMLElement }); };
  let tree = render();
  const keyboard = harness.effects.find(({ dependencies }) => dependencies.length === 3 && dependencies[0] === true && typeof dependencies[1] === 'number' && typeof dependencies[2] === 'function')!;
  const cleanup = keyboard.effect(); const keydown = addEventListener.mock.calls.find(([name]) => name === 'keydown')![1];
  const event = { key: 'Escape', target: null, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  keydown(event); tree = render(); expect(find(tree, SelectionToolbar)).toBeUndefined(); expect(event.preventDefault).toHaveBeenCalledOnce();
  find(tree, ReaderTools).props.actions.toggleSearch(); find(tree, ReaderTools).props.actions.toggleTranslation();
  findProps(tree, props => props['aria-label'] === '更多阅读操作' && props['aria-haspopup'] === 'menu').props.onClick(); tree = render();
  findProps(tree, props => props.role === 'menuitemcheckbox').props.onClick(); tree = render();
  expect(find(tree, ReaderTools).props.state.searchOpen).toBe(true); expect(find(tree, ReaderTools).props.state.translationOpen).toBe(true);
  expect(findProps(tree, props => props.children === '拖动框选区域，Esc 退出')).toBeDefined();
  keydown(event); tree = render();
  expect(find(tree, ReaderTools).props.state.searchOpen).toBe(false); expect(find(tree, ReaderTools).props.state.translationOpen).toBe(false);
  expect(findProps(tree, props => props.className?.includes('reader-toast'))).toBeUndefined();
  expect(harness.states[22].text).toBe('retained draft'); expect(findProps(tree, props => props.className === 'pdf-selection-resume')).toBeDefined();
  cleanup?.();
});
