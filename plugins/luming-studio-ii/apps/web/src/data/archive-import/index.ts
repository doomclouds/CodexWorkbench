export { createArchiveImportService } from './protocol.js';

export interface ArchiveImportCommand {
  readonly file: File;
  readonly commandId: string;
}

export interface ArchiveImportReceipt {
  readonly boardId: string;
  readonly title: string;
}

export interface ArchiveImportService {
  readonly importArchive: (
    command: ArchiveImportCommand,
    signal?: AbortSignal,
  ) => Promise<ArchiveImportReceipt>;
}
