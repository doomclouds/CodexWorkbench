import type { VaultInput } from './types.js';

export interface TrashListInput extends VaultInput { limit?: number; cursor?: string; refresh?: boolean }
export interface TrashEntry {
  id: string;
  batchId: string;
  storedId: string;
  title: string;
  kind: 'paper' | 'pdf' | 'note' | 'directory' | 'file';
  originalPath: string;
  deletedAt: string;
  /** Number of recorded top-level items in the same delete batch. */
  itemsCount: number;
  pdfAvailable: boolean;
  /** A stored directory or Markdown file that is safe to open explicitly. */
  sourceAvailable?: boolean;
  folderAvailable: boolean;
}
export interface TrashDiagnostics {
  skippedBatches: number;
  skippedItems: number;
  scannedBatches: number;
  warnings: string[];
}
export interface TrashList {
  vaultId: string;
  items: TrashEntry[];
  /** Count in the bounded snapshot; complete=false means the bin may contain more. */
  total: number;
  nextCursor: string | null;
  complete: boolean;
  truncated: boolean;
  diagnostics: TrashDiagnostics;
  restoreSupported: false;
  restoreReason: string;
}
export type TrashOpenTarget = 'pdf' | 'source' | 'folder';
export interface TrashOpenInput extends VaultInput { batchId: string; storedId: string; target: TrashOpenTarget }
export interface TrashOpenResult { requested: true; target: TrashOpenTarget }
