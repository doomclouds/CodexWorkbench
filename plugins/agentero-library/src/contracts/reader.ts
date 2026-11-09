import type { NoteDocument, PaperInput, VaultInput } from './types.js';

/** Unrotated PDF crop-box coordinates: top-left origin, points, one-based page. */
export interface MarkRect { x: number; y: number; w: number; h: number }
export type MarkColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
export type MarkKind = 'highlight' | 'underline' | 'ask' | 'translate' | 'visual';
export interface MarkMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
export interface ReaderMark {
  id: string; kind: MarkKind; page: number; space: 'pt' | 'norm'; rects: MarkRect[];
  quote: string; note: string; comment?: string; question?: string; result?: string;
  color?: MarkColor; asset?: string; messages?: MarkMessage[]; createdAt?: string; updatedAt?: string;
}
export interface MarkListInput extends PaperInput { query?: string; kind?: MarkKind; page?: number }
export interface MarkList { vaultId: string; paperPath: string; revision: string; items: ReaderMark[] }
export interface AddMarkInput extends PaperInput {
  revision: string; kind: MarkKind; page: number; rects: MarkRect[];
  pageSize: { width: number; height: number }; quote: string; color?: MarkColor;
  comment?: string; question?: string; result?: string; asset?: { mediaType: 'image/png'; data: string };
}
export interface UpdateMarkInput extends PaperInput {
  revision: string; id: string; comment?: string; color?: MarkColor; result?: string;
  reply?: { role: 'user' | 'assistant'; content: string };
}
export interface DeleteMarkInput extends PaperInput { revision: string; id: string }
export interface TranslateInput extends VaultInput { text: string; to?: string; from?: string; provider?: string }
export interface TranslateResult { text: string; sourceLang: string; targetLang: string }
export interface BookmarkNode { title: string; origin: string | null; originalTitle?: string; pageIndex?: number; children: BookmarkNode[] }
export interface WriteBookmarksInput extends PaperInput { revision: string; nodes: BookmarkNode[] }
export interface WriteBookmarksResult { revision: string; saved: true; totalBytes: number }
export interface ExportPaperInput extends PaperInput {
  format: 'pdf' | 'markdown' | 'json'; includeMarks?: boolean; filePath?: string; revision?: string;
}
/** Binary bytes stay in MCP result _meta; never expose base64 in model content. */
export interface ExportResult { fileName: string; mediaType: string; totalBytes: number; base64?: string; content?: string; savedPath?: string }
export interface NoteAssetReadInput extends VaultInput { notePath: string; assetPath: string }
export interface NoteAssetImportInput extends VaultInput {
  notePath: string; filePath?: string; base64?: string; fileName: string; mimeType: string;
}
export interface NoteAsset { path: string; markdownPath: string; mimeType: string; totalBytes: number; base64?: string }
export interface RenameNoteInput extends VaultInput { path: string; newPath: string; revision: string }
export interface NoteLinksInput extends VaultInput { path?: string; paperPath?: string }
export interface NoteLinks { outgoing: { path: string; title: string }[]; backlinks: { path: string; title: string }[]; truncated: boolean }
export interface BibliographyInput extends VaultInput { text?: string; filePath?: string }
export interface ExportBibliographyInput extends VaultInput { filePath?: string }
export interface ChangeTagInput extends PaperInput { op: 'add' | 'rm'; tag: string }
export interface NoteRenameResult extends NoteDocument { renamedFrom: string }
