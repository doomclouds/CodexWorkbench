import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactState } from '../../src/core/shared/model.js';
import { ArtifactStore } from '../../src/core/shared/store.js';

export async function archiveState(entries: Record<string, Uint8Array>, root: string): Promise<ArtifactState<unknown>> {
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString()) as { artifactId: string };
  const temporary = await mkdtemp(join(root, 'archive-read-test-'));
  try {
    const store = new ArtifactStore<unknown>(temporary);
    await mkdir(store.folder(manifest.artifactId), { recursive: true });
    await writeFile(store.file(manifest.artifactId), entries['artifact.sqlite']!);
    return await store.read(manifest.artifactId);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function replaceArchiveState(entries: Record<string, Uint8Array>, state: ArtifactState<unknown>, root: string): Promise<void> {
  const temporary = await mkdtemp(join(root, 'archive-write-test-'));
  try {
    const store = new ArtifactStore<unknown>(temporary);
    await store.write(state);
    entries['artifact.sqlite'] = await readFile(store.file(state.artifact.id));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
