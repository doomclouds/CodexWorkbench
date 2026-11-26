import type { BoardHeader, BoardObject, PayloadRecord } from './model.js';

export const maxExportFileBytes = 32 * 1024 * 1024;

export type BoardExportScope =
  | { readonly kind: 'whole' }
  | { readonly kind: 'selection'; readonly objectIds: readonly string[] };

export interface ExportBoardCommand {
  readonly boardId: string;
  readonly expectedRevision: bigint;
  readonly scope: BoardExportScope;
  readonly format: 'json' | 'svg';
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

export type ExportBoardResult = BoardExportFile | BoardExportStale | BoardExportRejection;

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
