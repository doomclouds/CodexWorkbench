import type { ExportBytes } from './export-copy-store.js';
import type { ArtifactState } from './studio-repository.js';

export interface ArchiveSnapshot {
  state: ArtifactState<unknown>;
  assets: ReadonlyMap<string, Uint8Array>;
}

export interface ArchiveStorage {
  readInput(args: Record<string, unknown>): Promise<Uint8Array>;
  readArchive(data: Uint8Array): Promise<ArchiveSnapshot>;
  captureSnapshot(state: ArtifactState<unknown>): Promise<ArchiveSnapshot>;
  writeSnapshot(snapshot: ArchiveSnapshot): Promise<ExportBytes>;
  publishImported(
    state: ArtifactState<unknown>,
    assets: ReadonlyMap<string, Uint8Array>,
  ): Promise<void>;
}
