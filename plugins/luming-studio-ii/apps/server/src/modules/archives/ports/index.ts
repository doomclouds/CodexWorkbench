import type { ArchiveImportReceipt, ImportedArchiveAsset } from '../domain/index.js';

export type {
  ArchiveImportOutcome,
  ArchiveImportReceipt,
  ArchiveImportRejectionReason,
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
}
