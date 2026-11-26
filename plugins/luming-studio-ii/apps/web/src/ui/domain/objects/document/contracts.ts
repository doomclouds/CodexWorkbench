export type DocumentBlockType =
  | 'paragraph'
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'checkListItem'
  | 'quote'
  | 'codeBlock'
  | 'table'
  | 'image'
  | 'divider';

export type DocumentJson =
  | null
  | boolean
  | number
  | string
  | readonly DocumentJson[]
  | { readonly [key: string]: DocumentJson };

export interface DocumentBlock {
  readonly id: string;
  readonly type: DocumentBlockType;
  readonly props: Readonly<Record<string, DocumentJson>>;
  readonly content?: DocumentJson;
  readonly children?: readonly DocumentBlock[];
}

export interface DocumentContent {
  readonly schemaVersion: 1;
  readonly blocks: readonly DocumentBlock[];
}

export interface DocumentDraft {
  readonly title: string;
  readonly document: DocumentContent;
}

export interface DocumentValue extends DocumentDraft {
  readonly version: number;
}

export interface DocumentCommit extends DocumentDraft {
  readonly expectedVersion: number;
  readonly overwrite: boolean;
}

export type DocumentCommitResult =
  | { readonly ok: true; readonly value: DocumentValue }
  | { readonly ok: false; readonly message: string; readonly current?: DocumentValue };

export interface DocumentActivity {
  readonly mode: 'inline' | 'read' | 'edit';
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly composing: boolean;
}

export interface DocumentPaper {
  readonly fill?: string;
  readonly ink?: string;
  readonly backdrop?: string;
  readonly scheme?: 'light' | 'dark';
}

export interface DocumentNoteSource {
  readonly blockIds: readonly string[];
  readonly quote: string;
  readonly version: number;
}

export interface DocumentObjectProps {
  readonly value: DocumentValue;
  readonly interactive?: boolean;
  readonly readOnly?: boolean;
  readonly theme?: 'light' | 'dark';
  readonly paper?: DocumentPaper;
  readonly canvas?: { readonly width: number; readonly height: number; readonly zoom: number };
  readonly focusedReading?: boolean;
  readonly onOpenPresentation?: () => void;
  readonly onClosePresentation?: () => void;
  readonly editRequest?: number;
  readonly onChange?: (draft: DocumentDraft) => void;
  readonly onCommit?: (commit: DocumentCommit) => Promise<DocumentCommitResult>;
  readonly onActivity?: (activity: DocumentActivity) => void;
  readonly onExport?: (format: 'html' | 'json', value: DocumentDraft) => void;
  readonly onAnnotate?: (source: DocumentNoteSource) => void;
  readonly resolveImage?: (source: string, signal: AbortSignal) => Promise<string | undefined>;
  readonly uploadImage?: (file: File) => Promise<string>;
}
