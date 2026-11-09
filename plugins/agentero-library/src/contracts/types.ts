export interface LibrarySettings {
  schemaVersion: 1;
  cliPath: string;
  vaultPath: string;
  pdfiumPath: string;
  allowAgentPdfText: boolean;
  vaultId: string | null;
}

export type SettingsPatch = Partial<Pick<LibrarySettings, 'cliPath' | 'vaultPath' | 'pdfiumPath' | 'allowAgentPdfText'>>;
export interface StatusOptions { diagnosePdf?: boolean }

export interface LibraryStatus {
  ready: boolean;
  instanceId: string;
  dataRoot: string;
  defaultVaultPath: string;
  cli: { available: boolean; supported: boolean; path: string; version: string | null; error?: string };
  vault: { configured: boolean; valid: boolean; vaultId: string | null; path: string; name: string; error?: string };
  capabilities: { metadata: boolean; notes: boolean; pdfRead: boolean; pdfText: boolean; pdfParse: boolean; layout: boolean };
  capabilityScope: 'service-support';
  pdfium: { configured: boolean; available: boolean | null; path: string; diagnostic: string; state?: 'unknown' | 'available' | 'unavailable'; checkedAt?: string };
  allowAgentPdfText: boolean;
  activeOperations: number;
  recoveryDrafts: number;
}

export interface VaultInput { vaultId: string }
export interface PaperInput extends VaultInput { paperPath: string }
export interface ListPapersInput extends VaultInput {
  query?: string;
  tag?: string[];
  unread?: boolean;
  sortBy?: 'title' | 'year' | 'date' | 'authors' | 'tags';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  refresh?: boolean;
}

export interface Paper {
  id: string;
  path: string;
  title: string;
  authors: string[];
  tags: string[];
  tagDetails?: { name: string; color?: string }[];
  isRead: boolean;
  year?: number;
  date?: string;
  doi?: string;
  arxivId?: string;
  publication?: string;
  status?: string;
  [key: string]: unknown;
}

export interface PaperPage {
  vaultId: string;
  snapshotId: string;
  items: Paper[];
  total: number;
  nextCursor: string | null;
  complete: true;
}

export interface SearchInput extends VaultInput {
  query: string;
  scope?: 'all' | 'metadata' | 'notes' | 'body';
  limit?: number;
  year?: number;
  publication?: string;
  doi?: string;
  isRead?: boolean;
}

export interface DiscoverInput extends VaultInput {
  keywords?: string[];
  categories?: string[];
  since?: string;
  until?: string;
  top?: number;
  maxCandidates?: number;
  dedup?: boolean;
}

export interface ImportPaperInput extends VaultInput {
  text?: string;
  filePath?: string;
  filePaths?: string[];
  parent?: string;
  noRecognize?: boolean;
}
export interface ParsePaperInput extends PaperInput { force?: boolean }
export interface UpdatePaperInput extends PaperInput {
  isRead?: boolean;
  tags?: string[];
  title?: string;
  authors?: string[];
  date?: string;
  doi?: string;
  arxivId?: string;
  publication?: string;
}

export interface ListNotesInput extends VaultInput { path?: string; limit?: number }
export interface NoteList {
  vaultId: string;
  path: string;
  items: { path: string; name: string; kind: 'file' | 'directory'; paperPath?: string }[];
  truncated: boolean;
}
export interface NoteInput extends VaultInput { path?: string; paperPath?: string }
export interface NoteDocument {
  vaultId: string;
  path: string;
  paperPath?: string;
  content: string;
  revision: string | null;
  exists: boolean;
}
export interface WriteNoteInput extends NoteInput {
  content: string;
  revision: string | null;
  mode?: 'replace' | 'append';
}

export type OperationStatus = 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled';
export interface OperationInput { operationId: string; instanceId?: string; vaultId?: string }
export interface LibraryOperation {
  operationId: string;
  instanceId: string;
  vaultId: string;
  type: 'import' | 'parse' | 'download' | 'bibliography';
  status: OperationStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  paperPath?: string;
  result?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export interface PdfChunkInput extends PaperInput {
  offset?: number;
  length?: number;
  revision?: string;
}
export interface PdfChunk {
  base64: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  eof: boolean;
  revision: string;
}

export interface ReadPaperInput extends PaperInput {
  source?: 'auto' | 'pdf' | 'layout' | 'markdown';
  pages?: number[];
  page?: number;
  startLine?: number;
  startOffset?: number;
  maxChars?: number;
}
export interface PaperRead {
  vaultId: string;
  paperPath: string;
  source: 'pdf' | 'layout' | 'markdown';
  content: string;
  pages?: Record<string, unknown>[];
  pageCount?: number;
  startLine?: number;
  nextLine?: number | null;
  nextOffset?: number | null;
  truncated: boolean;
}

export interface CliResult { code: number | null; stdout: string; stderr: string; timedOut?: boolean; cancelled?: boolean }
export interface CliRequest {
  cliPath: string;
  args: string[];
  dataRoot: string;
  pdfiumPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface CliRunner { run(request: CliRequest): Promise<CliResult>; close?(): Promise<void> }
export interface NativeBackend { call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>; close(): Promise<void> }
export interface NativeContext { settings: LibrarySettings; dataRoot: string; vaultPath: string; signal?: AbortSignal }
export interface LibraryServiceOptions {
  dataRoot?: string;
  cliRunner?: CliRunner;
  nativeFactory?: (context: NativeContext) => Promise<NativeBackend>;
  snapshotTtlMs?: number;
  externalPdfOpener?: (path: string) => Promise<void>;
}
