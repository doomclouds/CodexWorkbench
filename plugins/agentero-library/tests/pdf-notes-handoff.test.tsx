import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Paper } from '../src/contracts/types';

const harness = vi.hoisted(() => ({ states: [] as any[], index: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = harness.index++; if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial; return [harness.states[index], (next: unknown) => { harness.states[index] = typeof next === 'function' ? next(harness.states[index]) : next; }]; },
  useRef: (current: unknown) => ({ current }), useEffect: vi.fn(), useMemo: (compute: () => unknown) => compute(), useCallback: (callback: unknown) => callback,
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

function find(node: any, type: unknown): any {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  return node.type === type ? node : find(node.props?.children, type);
}
afterEach(() => { harness.states = []; harness.index = 0; });
it('forwards the selected compact note path and supports a paper-only workspace request', () => {
  const paper: Paper = { id: 'one', path: 'papers/one', title: 'One', authors: [], tags: [], isRead: false };
  const onNotes = vi.fn();
  const render = () => { harness.index = 0; return PdfReader({ active: true, vaultId: 'owned', paper, preview: false, canSend: false, canParse: false, onNotes, onOperation: vi.fn(), onBack: vi.fn(), readerToolsHost: {} as HTMLElement }); };
  let tree = render(); find(tree, ReaderTools).props.actions.toggleNotes(); tree = render();
  const compact = find(tree, NotesView); expect(compact.props.compact).toBe(true);
  compact.props.onOpenWorkspace({ path: 'notes/论文/one/nested/selected-A.md', title: 'Selected A', paperPath: paper.path });
  expect(onNotes).toHaveBeenLastCalledWith(paper, 'notes/论文/one/nested/selected-A.md');
  compact.props.onOpenWorkspace(); expect(onNotes).toHaveBeenLastCalledWith(paper, undefined);
});
