import type { MarkRect } from './reader.js';
import type { PaperInput, VaultInput } from './types.js';

export type ReadingAction = 'summarize' | 'create-note' | 'update-note' | 'revise-paper';
export interface ReadingSelectionPart { page: number; quote: string; rects?: MarkRect[]; pageSize?: { width: number; height: number } }
export interface ReadingSelection { text: string; parts: ReadingSelectionPart[]; asset?: { mediaType: 'image/png'; data: string } }
export interface CreateReadingContextInput extends PaperInput {
  pages?: number[]; markIds?: string[]; marksRevision?: string; selection?: ReadingSelection;
  action: ReadingAction; targetNotePath?: string; targetFolderPath?: string;
}
export interface AttachReadingContextInput extends CreateReadingContextInput { title: string; taskText?: string }
export interface ReadingContextReference extends VaultInput { contextId: string }
export interface ReadReadingContextInput extends ReadingContextReference { offset?: number; maxChars?: number }
export interface ReadingContextSummary extends ReadingContextReference {
  paperPath: string; paperId: string; title: string; pages: number[]; marksCount: number;
  action: ReadingAction; targetNotePath?: string; targetFolderPath?: string; createdAt: string; expiresAt: string;
  imageIds: string[];
}
export interface ReadingContextDocument extends ReadingContextSummary {
  content: string; offset: number; nextOffset: number | null; totalChars: number; truncated: boolean;
  sourceChanged: boolean;
}
