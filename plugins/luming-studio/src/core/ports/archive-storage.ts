import type { StagedArchiveFile } from './export-copy-store.js';
import type { ArtifactState } from './studio-repository.js';

export type ArchiveInput = Uint8Array | AsyncIterable<Uint8Array>;

export interface ArchiveAsset {
  size: number;
  chunks(): AsyncIterable<Uint8Array>;
}

export interface ArchiveSnapshot {
  state: ArtifactState<unknown>;
  assets: ReadonlyMap<string, ArchiveAsset>;
  dispose(): Promise<void>;
}

export interface ArchiveStorage {
  readInput(args: Record<string, unknown>): Promise<ArchiveInput>;
  readArchive(data: ArchiveInput): Promise<ArchiveSnapshot>;
  captureSnapshot(state: ArtifactState<unknown>): Promise<ArchiveSnapshot>;
  writeSnapshot(snapshot: ArchiveSnapshot): Promise<StagedArchiveFile>;
  publishImported(
    state: ArtifactState<unknown>,
    snapshot: Pick<ArchiveSnapshot, 'assets' | 'dispose'>,
  ): Promise<void>;
}
