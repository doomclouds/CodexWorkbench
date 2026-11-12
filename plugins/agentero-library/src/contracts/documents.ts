import type { PaperInput } from './types.js';

export interface PaperMarkdownDocument extends PaperInput {
  path: string; exists: boolean; revision: string | null; content: string;
  offset: number; nextOffset: number | null; totalChars: number; truncated: boolean;
}
export interface ReadPaperMarkdownInput extends PaperInput { offset?: number; maxChars?: number }
export interface MarkdownEdit { oldText: string; newText: string }
export interface WritePaperMarkdownInput extends PaperInput {
  revision: string; content?: string; edits?: MarkdownEdit[]; dryRun?: boolean; allowImageReferenceChanges?: boolean;
}
export interface MarkdownChange { kind: 'equal' | 'removed' | 'added'; text: string }
export interface PaperMarkdownWriteResult extends PaperMarkdownDocument {
  saved: boolean; dryRun: boolean; previousRevision: string; recoveryId: string | null;
  changes: MarkdownChange[]; changesTruncated: boolean;
}
export interface PaperMarkdownHistoryEntry {
  historyId: string; createdAt: string; previousRevision: string; revision: string; status: 'prepared' | 'saved' | 'unconfirmed';
}
export interface PaperMarkdownHistoryInput extends PaperInput { historyId?: string; offset?: number; maxChars?: number }
export interface PaperMarkdownHistory {
  items: PaperMarkdownHistoryEntry[]; truncated: boolean;
  entry?: PaperMarkdownHistoryEntry & { before: string; proposed: string; offset: number; nextOffset: number | null; totalChars: number };
}
