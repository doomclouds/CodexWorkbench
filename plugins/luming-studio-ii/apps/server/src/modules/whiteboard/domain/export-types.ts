import type { BoardHeader, BoardObject, PayloadRecord } from './model.js';

export const maxExportFileBytes = 32 * 1024 * 1024;
export const maxBoardBackupBytes = 128 * 1024 * 1024;
export const maxBoardBackupAssetBytes = 20 * 1024 * 1024;

export type BoardExportScope =
  | { readonly kind: 'whole' }
  | { readonly kind: 'selection'; readonly objectIds: readonly string[] };

export interface ExportBoardCommand {
  readonly boardId: string;
  readonly expectedRevision: bigint;
  readonly scope: BoardExportScope;
  readonly format: 'json' | 'svg' | 'html';
}

export interface ExportRenderCommand extends Omit<ExportBoardCommand, 'format'> {
  readonly format: ExportBoardCommand['format'] | 'png';
}

export interface ExportBoardFileCommand extends Omit<ExportRenderCommand, 'format'> {
  readonly format: ExportRenderCommand['format'] | 'zip';
}

export type BoardExportRejectionReason =
  | 'invalidSelection'
  | 'unsupported'
  | 'assetUnavailable'
  | 'tooLarge';

export interface BoardExportRejection {
  readonly kind: 'rejected';
  readonly reason: BoardExportRejectionReason;
}

export interface BoardExportStale {
  readonly kind: 'stale';
  readonly revision: bigint;
}

export interface BoardExportFile {
  readonly kind: 'file';
  readonly filename: string;
  readonly mimeType: string;
  readonly revision: bigint;
  readonly content: Uint8Array;
}

export interface BoardExportPngRegion {
  readonly index: number;
  readonly html: string;
  readonly width: number;
  readonly height: number;
}

export interface BoardExportBrowserPng {
  readonly kind: 'browserPng';
  readonly filename: string;
  readonly revision: bigint;
  readonly width: number;
  readonly height: number;
  readonly svgTemplate: string;
  readonly regions: readonly BoardExportPngRegion[];
}

export type ExportBoardResult =
  | BoardExportFile
  | BoardExportStale
  | BoardExportRejection
  | BoardExportBrowserPng;

export interface BoardExportAsset {
  readonly mimeType: string;
  readonly byteLength: number;
  readonly base64: string;
}

export interface BoardExportSnapshot {
  readonly board: BoardHeader;
  readonly objects: readonly BoardObject[];
  readonly geometry: ReadonlyMap<string, BoardObject>;
  readonly payloads: readonly PayloadRecord[];
  readonly assets: ReadonlyMap<string, BoardExportAsset>;
}

export interface BoardBackupMetadata {
  readonly createdAtMillis?: number;
  readonly updatedAtMillis: number;
  readonly pinned: boolean;
}

export interface BoardBackupActor {
  readonly id: string;
  readonly name: string;
  readonly kind: 'human' | 'agent';
  readonly role: 'owner' | 'editor' | 'commenter' | 'viewer';
}

type BackupRow = Readonly<Record<string, string | number | null>>;

export interface BoardBackupDetails {
  readonly actors: ReadonlyMap<string, BoardBackupActor>;
  readonly feedback: {
    readonly threads: readonly BackupRow[];
    readonly messages: readonly BackupRow[];
    readonly contentAnchors: readonly BackupRow[];
  };
  readonly reviewSources: {
    readonly sources: readonly BackupRow[];
    readonly targetSnapshots: readonly BackupRow[];
  };
}

export interface BoardBackupHistory {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly artifact: Readonly<Record<string, unknown>>;
  readonly elements: readonly Readonly<Record<string, unknown>>[];
}

export interface BoardBackupAsset {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface BoardBackupArchive {
  readonly boardId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly contentFields: Readonly<Record<string, unknown>>;
  readonly elements: readonly Readonly<Record<string, unknown>>[];
  readonly history: readonly BoardBackupHistory[];
  readonly assets: ReadonlyMap<string, BoardBackupAsset>;
}
