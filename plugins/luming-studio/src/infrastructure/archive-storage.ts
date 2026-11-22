import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MAX_ARCHIVE_ASSET_BYTES, MAX_ARCHIVE_BYTES } from '../contracts/archive.js';
import type {
  ArchiveAsset,
  ArchiveInput,
  ArchiveSnapshot,
  ArchiveStorage,
} from '../core/ports/archive-storage.js';
import type { AssetFileStore } from '../core/ports/asset-file-store.js';
import type { StagedArchiveFile } from '../core/ports/export-copy-store.js';
import type { ArtifactState, StudioRepository } from '../core/ports/studio-repository.js';
import { isRecord as object } from '../shared/is-record.js';
import { invalidArchive as invalid, safeId, StudioError, text } from '../shared/studio-error.js';
import {
  decodeArchiveState,
  decodeDeltaArchiveState,
  encodeDeltaArchiveState,
  MAX_ARCHIVE_STATE_BYTES,
} from './archive-state-codec.js';
import {
  archiveTooLarge,
  extractZip,
  MAX_ARCHIVE_ENTRIES,
  MAX_EXPANDED_BYTES,
  writeZip,
  type ZipEntrySource,
} from './archive-zip.js';
import { renameWithRetry } from './filesystem/atomic-write.js';
import { SqliteArtifactRepository } from './sqlite-artifact.js';

const MAX_LEGACY_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4096;
const ARCHIVE_FORMAT = 'luming-studio-archive';
const MANIFEST = 'manifest.json';
const LEGACY_DATABASE = 'artifact.sqlite';
const COMPACT_STATE = 'artifact-state.json';
const DELTA_STATE = 'artifact-deltas.ndjson';
const ASSET_PREFIX = 'assets/';

interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: 2 | 3 | 4;
  artifactId: string;
  payload: typeof LEGACY_DATABASE | typeof COMPACT_STATE | typeof DELTA_STATE;
}

function unsupported(): StudioError {
  return new StudioError(
    'UNSUPPORTED_STORAGE',
    '此备份使用不受支持的旧版存储格式，请由 AI 按迁移说明重建作品。',
  );
}

function entryLimit(name: string): number {
  if (name === 'artifact.json') {
    throw unsupported();
  }
  if (name === MANIFEST) {
    return MAX_MANIFEST_BYTES;
  }
  if (name === LEGACY_DATABASE) {
    return MAX_LEGACY_SNAPSHOT_BYTES;
  }
  if (name === COMPACT_STATE || name === DELTA_STATE) {
    return MAX_ARCHIVE_STATE_BYTES;
  }
  if (name === ASSET_PREFIX) {
    return 0;
  }

  const allowedAsset = /^assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(name);
  if (allowedAsset && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.slice(7))) {
    return MAX_ARCHIVE_ASSET_BYTES;
  }

  throw invalid('备份包含不允许的文件路径。');
}

function manifestValue(bytes: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw invalid('备份格式说明无效。', { cause: error });
  }

  if (!object(value) || value.format !== ARCHIVE_FORMAT) {
    throw unsupported();
  }

  return value;
}

function manifest(bytes: Uint8Array): ArchiveManifest {
  const value = manifestValue(bytes);
  const version = value.version;
  if (version === 2 && value.database === LEGACY_DATABASE) {
    if (Object.hasOwn(value, 'state')) {
      throw invalid('备份格式说明包含多个作品数据入口。');
    }

    return {
      format: ARCHIVE_FORMAT,
      version,
      artifactId: safeId(value.artifactId),
      payload: LEGACY_DATABASE,
    };
  }
  if (version === 3 || version === 4) {
    const payload = version === 3 ? COMPACT_STATE : DELTA_STATE;
    if (value.state !== payload || Object.hasOwn(value, 'database')) {
      throw invalid('备份格式说明中的作品数据入口无效。');
    }

    return { format: ARCHIVE_FORMAT, version, artifactId: safeId(value.artifactId), payload };
  }

  throw unsupported();
}

function writeDatabase(file: string, state: ArtifactState<unknown>): void {
  const database = new SqliteArtifactRepository(file, true);
  try {
    database.database.exec('BEGIN IMMEDIATE');
    database.writeImportedState(state);
    database.database.exec('COMMIT');
  } finally {
    database.close();
  }
}

async function assertSqliteHeader(file: string): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    if (!header.equals(Buffer.from('SQLite format 3\0'))) {
      throw invalid('备份数据库无效。');
    }
  } finally {
    await handle.close();
  }
}

async function readLegacyDatabase(
  path: string,
  artifactId: string,
): Promise<ArtifactState<unknown>> {
  await assertSqliteHeader(path);
  let database: SqliteArtifactRepository | undefined;
  try {
    database = new SqliteArtifactRepository(path);
    const state = structuredClone(
      database.readState<unknown, unknown, unknown>({
        maxExpandedBytes: MAX_LEGACY_SNAPSHOT_BYTES,
      }),
    );

    if (state.artifact.id !== artifactId) {
      throw invalid('备份作品标识与数据库不一致。');
    }

    return state;
  } catch (error) {
    if (error instanceof StudioError && ['UNSUPPORTED_STORAGE', 'TOO_LARGE'].includes(error.code)) {
      throw error;
    }

    throw invalid('备份数据库无法读取或内容不完整。', { cause: error });
  } finally {
    database?.close();
  }
}

async function readStructuredState(
  path: string,
  metadata: ArchiveManifest,
): Promise<ArtifactState<unknown>> {
  const state =
    metadata.version === 3
      ? decodeArchiveState(await readFile(path))
      : await decodeDeltaArchiveState(createReadStream(path));

  if (!object(state) || !object(state.artifact) || state.artifact.id !== metadata.artifactId) {
    throw invalid('备份作品标识与作品数据不一致。');
  }

  return state as unknown as ArtifactState<unknown>;
}

function archiveFilename(title: string): string {
  const clean = basename(title)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim();

  return (clean || '作品') + '.studio.zip';
}

function fileAsset(path: string, size: number): ArchiveAsset {
  return { size, chunks: () => createReadStream(path) };
}

async function* archiveChunks(data: ArchiveInput): AsyncIterable<Uint8Array> {
  if (data instanceof Uint8Array) {
    yield data;
    return;
  }

  yield* data;
}

async function* bounded(
  chunks: AsyncIterable<Uint8Array>,
  maximum: number,
): AsyncIterable<Uint8Array> {
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.length;
    if (size > maximum) {
      throw archiveTooLarge();
    }

    yield chunk;
  }
}

function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4
  ) {
    throw archiveTooLarge();
  }

  let padding = 0;
  if (value.endsWith('=')) {
    padding = value.endsWith('==') ? 2 : 1;
  }
  if (value.length % 4 || /[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) {
    throw invalid('备份内容不是有效的 Base64。');
  }

  const data = Buffer.from(value, 'base64');
  if (data.length > MAX_ARCHIVE_BYTES) {
    throw archiveTooLarge();
  }

  return data;
}

async function* readArchivePath(path: string): AsyncIterable<Uint8Array> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) {
      throw invalid('备份路径必须指向文件。');
    }
    if (info.size > MAX_ARCHIVE_BYTES) {
      throw archiveTooLarge();
    }

    yield* file.createReadStream({ autoClose: false });
  } finally {
    await file.close();
  }
}

function captureAssetRows(
  files: ReadonlyMap<string, { path: string; size: number }>,
): Map<string, ArchiveAsset> {
  const assets = new Map<string, ArchiveAsset>();
  for (const [name, entry] of files) {
    if (name.startsWith(ASSET_PREFIX) && name !== ASSET_PREFIX) {
      assets.set(name.slice(ASSET_PREFIX.length), fileAsset(entry.path, entry.size));
    }
  }

  return assets;
}

export class FileArchiveStorage implements ArchiveStorage {
  constructor(
    private readonly repository: Pick<StudioRepository, 'root' | 'folder'>,
    private readonly assetFiles: Pick<AssetFileStore, 'read'>,
  ) {}

  private async stage(prefix: string): Promise<string> {
    const root = join(this.repository.root, 'staging');
    await mkdir(root, { recursive: true });

    return mkdtemp(join(root, prefix));
  }

  async readInput(args: Record<string, unknown>): Promise<ArchiveInput> {
    if ((args.archivePath !== undefined) === (args.archiveBase64 !== undefined)) {
      throw new StudioError('INVALID_ARGUMENT', '请提供一个备份文件路径或备份内容。');
    }
    if (args.archiveBase64 !== undefined) {
      return decodeBase64(args.archiveBase64);
    }

    const path = text(args.archivePath, '', 4096);
    if (!path.trim()) {
      throw new StudioError('INVALID_ARGUMENT', '备份文件路径不能为空。');
    }

    return readArchivePath(path);
  }

  async readArchive(data: ArchiveInput): Promise<ArchiveSnapshot> {
    const staging = await this.stage('archive-read-');
    const dispose = () => rm(staging, { recursive: true, force: true });
    try {
      const archive = join(staging, 'input.zip');
      await writeFile(archive, bounded(archiveChunks(data), MAX_ARCHIVE_BYTES), { flag: 'wx' });
      const files = await extractZip(archive, staging, entryLimit);
      const description = files.get(MANIFEST);
      const payloads = [LEGACY_DATABASE, COMPACT_STATE, DELTA_STATE].filter((name) =>
        files.has(name),
      );

      if (!description || payloads.length !== 1) {
        throw invalid('备份必须包含一份作品数据和格式说明。');
      }

      const metadata = manifest(await readFile(description.path));
      const entry = files.get(metadata.payload);
      if (!entry) {
        throw invalid('备份格式说明与作品数据不一致。');
      }

      const state =
        metadata.version === 2
          ? await readLegacyDatabase(entry.path, metadata.artifactId)
          : await readStructuredState(entry.path, metadata);
      await rm(archive);

      return { state, assets: captureAssetRows(files), dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  async captureSnapshot(state: ArtifactState<unknown>): Promise<ArchiveSnapshot> {
    const entries = Object.entries(state.assets);
    if (entries.length + 2 > MAX_ARCHIVE_ENTRIES) {
      throw archiveTooLarge();
    }

    const staging = await this.stage('archive-capture-');
    const dispose = () => rm(staging, { recursive: true, force: true });
    try {
      const assets = new Map<string, ArchiveAsset>();
      let size = 0;
      for (const [index, [id, asset]] of entries.entries()) {
        const file = await this.assetFiles.read(state.artifact.id, id, MAX_ARCHIVE_ASSET_BYTES);
        if (file.kind === 'too-large') {
          throw archiveTooLarge();
        }
        if (file.kind !== 'data' || file.data.length !== asset.size) {
          throw invalid('作品资源不完整，未生成备份。');
        }

        size += file.data.length;
        if (size > MAX_EXPANDED_BYTES) {
          throw archiveTooLarge();
        }

        const path = join(staging, 'asset-' + index);
        await writeFile(path, file.data, { flag: 'wx' });
        assets.set(id, fileAsset(path, file.data.length));
      }

      return { state, assets, dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  async writeSnapshot(snapshot: ArchiveSnapshot): Promise<StagedArchiveFile> {
    let staging: string | undefined;
    try {
      try {
        staging = await this.stage('archive-output-');
        const directory = staging;
        const path = join(directory, 'output.zip');
        const entries = this.snapshotEntries(snapshot);
        const size = await writeZip(path, entries);

        return {
          filename: archiveFilename(snapshot.state.artifact.title),
          mimeType: 'application/zip',
          ...fileAsset(path, size),
          dispose: () => rm(directory, { recursive: true, force: true }),
        };
      } finally {
        await snapshot.dispose();
      }
    } catch (error) {
      if (staging) {
        await rm(staging, { recursive: true, force: true });
      }

      throw error;
    }
  }

  private snapshotEntries(snapshot: ArchiveSnapshot): ZipEntrySource[] {
    const metadata = {
      format: ARCHIVE_FORMAT,
      version: 4,
      state: DELTA_STATE,
      artifactId: snapshot.state.artifact.id,
    };
    const description = Buffer.from(JSON.stringify(metadata));
    let available = MAX_EXPANDED_BYTES - description.length;
    const assets: ZipEntrySource[] = [];
    for (const [id, asset] of snapshot.assets) {
      const name = ASSET_PREFIX + id;
      if (asset.size > entryLimit(name)) {
        throw archiveTooLarge();
      }

      available -= asset.size;
      assets.push({ name, compress: false, chunks: asset.chunks });
    }
    if (available < 0) {
      throw archiveTooLarge();
    }

    return [
      { name: MANIFEST, compress: true, chunks: () => archiveChunks(description) },
      {
        name: DELTA_STATE,
        compress: true,
        chunks: () => bounded(encodeDeltaArchiveState(snapshot.state), available),
      },
      ...assets,
    ];
  }

  async publishImported(
    state: ArtifactState<unknown>,
    { assets, dispose }: Pick<ArchiveSnapshot, 'assets' | 'dispose'>,
  ): Promise<void> {
    const staging = await this.stage('import-');
    try {
      await mkdir(join(staging, 'assets'));
      for (const [assetId, asset] of assets) {
        await writeFile(join(staging, 'assets', assetId), asset.chunks(), { flag: 'wx' });
      }

      writeDatabase(join(staging, LEGACY_DATABASE), state);
      await dispose();
      await mkdir(join(this.repository.root, 'artifacts'), { recursive: true });
      await renameWithRetry(staging, this.repository.folder(state.artifact.id));
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
}
