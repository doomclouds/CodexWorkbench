import { Buffer } from 'node:buffer';
import { packBackupState, type BackupState } from './backup-state.js';
import { MAX_ARCHIVE_ENTRIES } from './zip-reader.js';
import { writeZip } from './zip-writer.js';

interface BackupArchive extends BackupState {
  readonly boardId: string;
  readonly assets: ReadonlyMap<string, { readonly base64: string }>;
}

export async function writeBoardArchive(snapshot: BackupArchive, maximumBytes: number) {
  if (snapshot.assets.size + 2 > MAX_ARCHIVE_ENTRIES) {
    return undefined;
  }

  const state = packBackupState(snapshot);
  if (!state) {
    return undefined;
  }

  const stateName = 'artifact-deltas.ndjson';
  const manifest = {
    format: 'luming-studio-archive',
    version: 4,
    artifactId: snapshot.boardId,
    state: stateName,
  };
  const assets = [...snapshot.assets].map(([id, asset]) => ({
    name: 'assets/' + id,
    body: Buffer.from(asset.base64, 'base64'),
  }));

  return writeZip(
    [
      { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) },
      { name: stateName, body: state, compressed: true },
      ...assets,
    ],
    maximumBytes,
  );
}
