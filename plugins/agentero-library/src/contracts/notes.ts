import type { NoteDocument, VaultInput } from './types.js';

/** Main paper association; independent of the note's physical directory. */
export interface NoteAssociation { paperId: string; paperPath: string; paperTitle: string }
export interface NoteTreeInput extends VaultInput { paperPath?: string; limit?: number }
export interface NoteTreeEntry {
  path: string; parentPath: string; name: string; kind: 'file' | 'directory';
  paperId?: string; paperPath?: string; paperTitle?: string; revision?: string;
  noteCount?: number;
}
export interface NoteTree { vaultId: string; items: NoteTreeEntry[]; truncated: boolean; paperFolderPath?: string }
export interface CreateNoteInput extends VaultInput { title: string; folderPath?: string; paperPath?: string; content?: string }
export interface CreateNoteFolderInput extends VaultInput { parentPath: string; name: string }
export interface MoveNoteFolderInput extends VaultInput { path: string; newPath: string; revision: string }
export interface TrashNoteInput extends VaultInput { path: string; revision: string }
export interface AssociateNoteInput extends VaultInput { path: string; paperPath: string | null; revision: string }
export interface NoteFolderMoveResult { vaultId: string; path: string; renamedFrom: string; revision: string; updatedSources: unknown; skipped: unknown }
export interface NoteTrashResult { vaultId: string; path: string; trashed: true; result: Record<string, unknown> }
export type CreateNoteResult = NoteDocument & { saved: true; recoveryId: string };
