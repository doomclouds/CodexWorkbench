import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactState } from '../../src/core/shared/model.js';
import {
  decodeArchiveState,
  encodeArchiveState,
} from '../../src/infrastructure/archive-state-codec.js';
import { ArtifactStore } from '../../src/infrastructure/artifact-store.js';

const compactState = 'artifact-state.json';

export async function archiveState(
  entries: Record<string, Uint8Array>,
  root: string,
): Promise<ArtifactState<unknown>> {
  if (entries[compactState]) {
    return decodeArchiveState(entries[compactState]) as ArtifactState<unknown>;
  }

  const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString()) as {
    artifactId: string;
  };
  const temporary = await mkdtemp(join(root, 'archive-read-test-'));
  try {
    const store = new ArtifactStore<unknown>(temporary);
    await mkdir(store.folder(manifest.artifactId), { recursive: true });
    await writeFile(store.file(manifest.artifactId), entries['artifact.sqlite']!);
    return await store.read(manifest.artifactId);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function replaceArchiveState(
  entries: Record<string, Uint8Array>,
  state: ArtifactState<unknown>,
  root: string,
): Promise<void> {
  if (entries[compactState]) {
    entries[compactState] = encodeArchiveState(state);
    return;
  }

  const temporary = await mkdtemp(join(root, 'archive-write-test-'));
  try {
    const store = new ArtifactStore<unknown>(temporary);
    await store.write(state);
    entries['artifact.sqlite'] = await readFile(store.file(state.artifact.id));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function legacyArchiveEntries(
  current: Record<string, Uint8Array>,
  state: ArtifactState<unknown>,
  root: string,
): Promise<Record<string, Uint8Array>> {
  const entries: Record<string, Uint8Array> = {
    ...current,
    'manifest.json': Buffer.from(
      JSON.stringify({
        format: 'luming-studio-archive',
        version: 2,
        database: 'artifact.sqlite',
        artifactId: state.artifact.id,
      }),
    ),
  };
  delete entries[compactState];
  await replaceArchiveState(entries, state, root);

  return entries;
}
