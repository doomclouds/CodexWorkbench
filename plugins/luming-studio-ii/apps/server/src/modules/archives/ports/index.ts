import type {
  ArchiveImportReceipt,
  BoardAssetImport,
  BoardAssetPage,
  BoardAssetRemoval,
  ImportedArchiveAsset,
} from '../domain/index.js';

export type {
  ArchiveImportOutcome,
  ArchiveImportReceipt,
  ArchiveImportRejectionReason,
  BoardAssetImport,
  BoardAssetPage,
  BoardAssetReference,
  BoardAssetRemoval,
  ImportedArchiveAsset,
} from '../domain/index.js';

export interface ArchiveImportCommand {
  readonly actorId: string;
  readonly commandId: string;
  readonly boardId: string;
  readonly updatedAtMillis: number;
  readonly chunks: AsyncIterable<Uint8Array>;
}

export interface ArchiveImportPort {
  importCurrent(command: ArchiveImportCommand): Promise<ArchiveImportReceipt>;
  getReceipt(actorId: string, commandId: string): ArchiveImportReceipt | undefined;
  getAsset(
    actorId: string,
    boardId: string,
    assetId: string,
    allowTrashedOwner: boolean,
  ): ImportedArchiveAsset | undefined;
  isActiveBoardOwner(actorId: string, boardId: string): boolean;
  listBoardAssets(
    actorId: string,
    boardId: string,
    cursor: string,
    limit: number,
  ): BoardAssetPage | undefined;
  importBoardAsset(
    actorId: string,
    boardId: string,
    assetId: string,
    signature: string,
    asset: ImportedArchiveAsset,
  ): BoardAssetImport | undefined;
  deleteBoardAsset(
    actorId: string,
    boardId: string,
    assetId: string,
  ): BoardAssetRemoval | undefined;
}
