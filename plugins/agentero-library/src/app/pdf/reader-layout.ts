export interface ReaderViewState {
  pageNumber: number; zoom: number; fit: boolean; rotation: number; tone: 'white' | 'dark';
  outlineOpen: boolean; marksOpen: boolean; notesOpen: boolean;
}
export const INITIAL_READER_VIEW: ReaderViewState = { pageNumber: 1, zoom: 1, fit: true, rotation: 0, tone: 'white', outlineOpen: false, marksOpen: false, notesOpen: false };
export type ReaderPanel = 'outlineOpen' | 'marksOpen' | 'notesOpen';
/** Reading inspectors share one slot so they cannot squeeze the canvas to zero. */
export function openReaderPanel(view: ReaderViewState, panel: ReaderPanel, open = true): ReaderViewState {
  return { ...view, outlineOpen: false, marksOpen: false, notesOpen: false, [panel]: open };
}
export function toggleReaderPanel(view: ReaderViewState, panel: ReaderPanel): ReaderViewState { return openReaderPanel(view, panel, !view[panel]); }

/** Resource restoration never opens another thread's layout panels. */
export function restoreReadingPreferences(saved: Partial<ReaderViewState>, current: ReaderViewState, totalPages: number): ReaderViewState {
  return { ...current,
    pageNumber: Math.min(Math.max(1, totalPages), Math.max(1, Number(saved.pageNumber) || 1)),
    zoom: Math.max(.35, Math.min(3, Number(saved.zoom) || 1)),
    fit: typeof saved.fit === 'boolean' ? saved.fit : true,
    rotation: [0, 90, 180, 270].includes(Number(saved.rotation)) ? Number(saved.rotation) : 0,
    tone: saved.tone === 'dark' ? 'dark' : 'white',
  };
}
export function readingPreferences(view: ReaderViewState) {
  return { pageNumber: view.pageNumber, zoom: view.zoom, fit: view.fit, rotation: view.rotation, tone: view.tone };
}
