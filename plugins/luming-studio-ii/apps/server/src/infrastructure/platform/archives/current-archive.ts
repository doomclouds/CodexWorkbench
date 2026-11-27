import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, readFileSync, readSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ArchiveReadError, archiveTooLarge, invalidArchive } from './archive-read-error.js';
import {
  MAX_ARCHIVE_STATE_BYTES,
  readCurrentArchiveState,
  type ArchiveRestoration,
} from './archive-state.js';
import { archiveRecord } from './archive-values.js';
import {
  extractZipAfterManifest,
  MAX_ARCHIVE_BYTES,
  ZipExtractionError,
  type ExtractedZipEntry,
} from './zip-reader.js';

const ARCHIVE_FORMAT = 'luming-studio-archive';
const ARCHIVE_VERSION = 4;
const MANIFEST = 'manifest.json';
const DELTA_STATE = 'artifact-deltas.ndjson';
const ASSET_PREFIX = 'assets/';
const MAX_MANIFEST_BYTES = 4 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const RETENTION_CHUNK_BYTES = 1024 * 1024;
const archiveId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const assetMediaType = /^[\w.+-]{1,64}\/[\w.+-]{1,64}$/u;

export interface StagedArchiveAsset extends ExtractedZipEntry {
  readonly mimeType: string;
}

export interface StagedCurrentArchive {
  readonly sourceBoardId: string;
  readonly title: string;
  readonly objects: readonly unknown[];
  readonly customColors?: readonly string[];
  readonly restoration?: ArchiveRestoration;
  readonly assets: ReadonlyMap<string, StagedArchiveAsset>;
  readonly archivePath: string;
  readonly signature: string;
  dispose(): Promise<void>;
}

function entryLimit(name: string): number | undefined {
  if (name === MANIFEST) {
    return MAX_MANIFEST_BYTES;
  }
  if (name === DELTA_STATE) {
    return MAX_ARCHIVE_STATE_BYTES;
  }
  if (name === ASSET_PREFIX) {
    return 0;
  }
  if (name.startsWith(ASSET_PREFIX) && archiveId.test(name.slice(ASSET_PREFIX.length))) {
    return MAX_ASSET_BYTES;
  }

  return undefined;
}

function parseManifest(bytes: Uint8Array): Record<string, unknown> {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return archiveRecord(JSON.parse(source) as unknown);
  } catch (error) {
    throw invalidArchive('Invalid archive manifest', { cause: error });
  }
}

async function readManifest(entry: ExtractedZipEntry): Promise<string> {
  const manifest = parseManifest(await readFile(entry.path));
  if (manifest.format !== ARCHIVE_FORMAT || manifest.version !== ARCHIVE_VERSION) {
    throw new ArchiveReadError('unsupportedVersion', 'Only Studio ZIP v4 is supported');
  }
  if (manifest.state !== DELTA_STATE || Object.hasOwn(manifest, 'database')) {
    throw invalidArchive('Archive manifest must identify the delta state');
  }

  const { artifactId } = manifest;
  if (typeof artifactId !== 'string' || !archiveId.test(artifactId)) {
    throw invalidArchive('Archive manifest has an invalid board identifier');
  }

  return artifactId;
}

function selectedAsset(
  id: string,
  entry: ExtractedZipEntry,
  metadata: Record<string, unknown>,
): StagedArchiveAsset {
  const row = archiveRecord(Object.hasOwn(metadata, id) ? metadata[id] : undefined);
  if (row.id !== id || row.size !== entry.size) {
    throw invalidArchive('Archive asset does not match its declared size or identifier');
  }

  const { mimeType } = row;
  if (typeof mimeType !== 'string' || !assetMediaType.test(mimeType)) {
    throw invalidArchive('Archive asset has an invalid media type');
  }

  return { ...entry, mimeType };
}

function archiveAssets(
  files: ReadonlyMap<string, ExtractedZipEntry>,
  metadata: Record<string, unknown>,
): ReadonlyMap<string, StagedArchiveAsset> {
  const assets = new Map<string, StagedArchiveAsset>();
  for (const [name, entry] of files) {
    if (!name.startsWith(ASSET_PREFIX) || name === ASSET_PREFIX) {
      continue;
    }

    const id = name.slice(ASSET_PREFIX.length);
    assets.set(id, selectedAsset(id, entry, metadata));
  }
  if (assets.size !== Object.keys(metadata).length) {
    throw invalidArchive('Archive is missing a declared asset');
  }

  return assets;
}

async function writePackedArchive(
  archivePath: string,
  body: AsyncIterable<Uint8Array>,
): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  async function* boundedChunks() {
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        throw invalidArchive('Archive upload must contain binary chunks');
      }

      bytes += chunk.byteLength;
      if (bytes > MAX_ARCHIVE_BYTES) {
        throw archiveTooLarge();
      }

      hash.update(chunk);
      yield chunk;
    }
  }

  await writeFile(archivePath, boundedChunks(), { flag: 'wx', mode: 0o600 });

  return hash.digest('hex');
}

async function discardStage(dispose: () => Promise<void>, error: unknown): Promise<never> {
  try {
    await dispose();
  } catch (cleanup) {
    throw new AggregateError([error, cleanup], 'Failed to discard the archive stage', {
      cause: cleanup,
    });
  }

  throw error;
}

function readFailure(error: unknown, signature?: string): unknown {
  if (error instanceof ArchiveReadError || error instanceof ZipExtractionError) {
    return new ArchiveReadError(error.code, error.message, { cause: error }, signature);
  }

  return error;
}

export async function stageCurrentArchive(
  chunks: AsyncIterable<Uint8Array>,
): Promise<StagedCurrentArchive> {
  const temporaryRoot = await realpath(tmpdir());
  const stage = await mkdtemp(join(temporaryRoot, 'luming-ii-archive-'));
  const archivePath = join(stage, 'source.zip');
  function dispose() {
    if (dirname(stage) !== temporaryRoot) {
      throw new Error('Archive stage is outside its temporary directory');
    }

    return rm(stage, { force: true, recursive: true });
  }

  let signature: string | undefined;
  try {
    signature = await writePackedArchive(archivePath, chunks);
    const { metadata: sourceBoardId, files } = await extractZipAfterManifest(
      archivePath,
      stage,
      entryLimit,
      { name: MANIFEST, read: readManifest },
    );
    const stateFile = files.get(DELTA_STATE);
    if (!stateFile) {
      throw invalidArchive('Archive is missing its delta state');
    }

    const state = await readCurrentArchiveState(createReadStream(stateFile.path), sourceBoardId);
    const assets = archiveAssets(files, state.assets);

    return {
      sourceBoardId,
      title: state.title,
      objects: state.objects,
      customColors: state.customColors,
      restoration: state.restoration,
      assets,
      archivePath,
      signature,
      dispose,
    };
  } catch (error) {
    return discardStage(dispose, readFailure(error, signature));
  }
}

export function readStagedArchiveEntry(entry: ExtractedZipEntry): Uint8Array {
  const bytes = readFileSync(entry.path);
  if (bytes.length !== entry.size) {
    throw new Error('Staged archive entry changed before publication');
  }

  return bytes;
}

export function* readStagedArchiveChunks(archive: StagedCurrentArchive): Iterable<Uint8Array> {
  const descriptor = openSync(archive.archivePath, 'r');
  try {
    while (true) {
      const buffer = Buffer.allocUnsafe(RETENTION_CHUNK_BYTES);
      const size = readSync(descriptor, buffer);
      if (!size) {
        return;
      }

      yield buffer.subarray(0, size);
    }
  } finally {
    closeSync(descriptor);
  }
}
