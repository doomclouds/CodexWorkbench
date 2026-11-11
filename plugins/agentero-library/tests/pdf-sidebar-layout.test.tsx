import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { INITIAL_READER_VIEW, openReaderPanel, readingPreferences, restoreReadingPreferences, toggleReaderPanel } from '../src/app/pdf/reader-layout';
import { ReaderHud, ReaderLanguageSetting, ReaderTools, type ReaderToolActions, type ReaderToolState } from '../src/app/pdf/ReaderTools';

const state: ReaderToolState = { ready: true, hasPaper: true, page: 8, total: 400, pageInput: '8', scale: 1, fit: true, tone: 'white', outlineOpen: false, searchOpen: false, marksOpen: false, notesOpen: false, notesDirty: false, translationOpen: false, translating: false, cards: false, targetLanguage: '' };
const noop = () => {};
const actions: ReaderToolActions = { toggleOutline: noop, toggleSearch: noop, toggleMarks: noop, toggleNotes: noop, toggleTranslation: noop, toggleCards: noop, pageInput: noop, goToPage: noop, previous: noop, next: noop, zoom: noop, fit: noop, rotate: noop, tone: noop, targetLanguage: noop };

test('restoring resource reading preferences does not open panels from a different thread', () => {
  const restored = restoreReadingPreferences({ pageNumber: 99, zoom: 1.5, fit: false, rotation: 90, tone: 'dark', outlineOpen: true, marksOpen: true, notesOpen: true }, INITIAL_READER_VIEW, 400);
  expect(restored).toMatchObject({ pageNumber: 99, zoom: 1.5, fit: false, rotation: 90, tone: 'dark', outlineOpen: false, marksOpen: false, notesOpen: false });
});
test('current App panel choices stay local while changing resource preferences', () => {
  const current = { ...INITIAL_READER_VIEW, notesOpen: true, marksOpen: true };
  expect(restoreReadingPreferences({ pageNumber: 9, notesOpen: false, marksOpen: false }, current, 24)).toMatchObject({ pageNumber: 9, notesOpen: true, marksOpen: true });
});
test('panel-only changes do not alter serialized reading preferences', () => {
  expect(readingPreferences({ ...INITIAL_READER_VIEW, notesOpen: true, marksOpen: true, outlineOpen: true })).toEqual(readingPreferences(INITIAL_READER_VIEW));
  expect(Object.keys(readingPreferences(INITIAL_READER_VIEW))).toEqual(['pageNumber', 'zoom', 'fit', 'rotation', 'tone']);
});
test('expanded reading tools include navigation without duplicating canvas controls', () => {
  const html = renderToStaticMarkup(<ReaderTools state={state} actions={actions} />);
  for (const label of ['目录', '查找', '批注', '论文笔记', '翻译']) expect(html).toContain(`aria-label="${label}"`);
  expect(html.match(/aria-label="PDF 物理页码"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="页边备注" aria-checked="false"');
});
test('collapsed rail keeps tool access and dirty badge while pagination moves to the HUD', () => {
  const rail = renderToStaticMarkup(<ReaderTools state={{ ...state, notesDirty: true }} actions={actions} collapsed />);
  expect(rail).toContain('aria-label="有未保存笔记"');
  expect(rail).not.toContain('aria-label="PDF 物理页码"');
  const hud = renderToStaticMarkup(<ReaderHud state={state} actions={actions} />);
  expect(hud.match(/aria-label="PDF 物理页码"/g)).toHaveLength(1);
  expect(hud).toContain('aria-label="旋转 PDF"'); expect(hud).toContain('aria-label="切换黑白纸色"');
});
test('dirty notes can still be collapsed and notes remain accessible when the PDF worker is unavailable', () => {
  const html = renderToStaticMarkup(<ReaderTools state={{ ...state, ready: false, notesOpen: true, notesDirty: true }} actions={actions} />);
  const notesButton = html.match(/<button[^>]*aria-label="论文笔记"[^>]*>/)?.[0];
  expect(notesButton).toBeDefined(); expect(notesButton).not.toContain('disabled'); expect(notesButton).toContain('aria-pressed="true"');
});
test('opening successive reading inspectors never accumulates side panels that squeeze the canvas', () => {
  let view = { ...INITIAL_READER_VIEW };
  for (const panel of ['outlineOpen', 'marksOpen', 'notesOpen', 'marksOpen', 'outlineOpen'] as const) {
    view = openReaderPanel(view, panel);
    expect([view.outlineOpen, view.marksOpen, view.notesOpen].filter(Boolean)).toHaveLength(1);
    expect(view[panel]).toBe(true);
  }
});
test('switching away from notes closes only layout state and preserves reading preferences', () => {
  const notes = { ...INITIAL_READER_VIEW, notesOpen: true, pageNumber: 8, zoom: 1.5 };
  const marks = toggleReaderPanel(notes, 'marksOpen');
  expect(marks.notesOpen).toBe(false); expect(marks.marksOpen).toBe(true);
  expect(readingPreferences(marks)).toEqual(readingPreferences(notes));
  expect(toggleReaderPanel(marks, 'marksOpen').marksOpen).toBe(false);
});
test('the standalone language preference is available without a translation action or running task', () => {
  const html = renderToStaticMarkup(<ReaderLanguageSetting value="ja" onChange={() => { throw new Error('Rendering a language preference must not start processing'); }} />);
  expect(html).toContain('aria-label="翻译目标语言"'); expect(html).toContain('value="ja" selected=""');
  expect(html).not.toContain('<button');
});
