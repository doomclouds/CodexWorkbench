import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Unzip, UnzipInflate, unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';
import { MAX_ARCHIVE_ASSET_BYTES, MAX_ARCHIVE_BYTES } from '../contracts/archive.js';
import type { ArchiveSnapshot, ArchiveStorage } from '../core/ports/archive-storage.js';
import type { AssetFileStore } from '../core/ports/asset-file-store.js';
import type { ExportBytes } from '../core/ports/export-copy-store.js';
import type { ArtifactState, StudioRepository } from '../core/ports/studio-repository.js';
import { isRecord as object } from '../shared/is-record.js';
import { invalidArchive as invalid, safeId, StudioError, text } from '../shared/studio-error.js';
import {
  decodeArchiveState,
  encodeArchiveState,
  MAX_ARCHIVE_STATE_BYTES,
} from './archive-state-codec.js';
import { renameWithRetry } from './filesystem/atomic-write.js';
import { SqliteArtifactRepository } from './sqlite-artifact.js';

const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_LEGACY_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4096;
const MAX_ENTRIES = 5000;
const ARCHIVE_FORMAT = 'luming-studio-archive';
const LEGACY_DATABASE = 'artifact.sqlite';
const COMPACT_STATE = 'artifact-state.json';

const tooLarge = () =>
  new StudioError('TOO_LARGE', '备份超过容量限制：ZIP 128 MB，展开后 256 MB，单个资源 20 MB。');

interface ManifestFields {
  format: typeof ARCHIVE_FORMAT;
  artifactId: string;
}

interface LegacyArchiveManifest extends ManifestFields {
  version: 2;
  database: typeof LEGACY_DATABASE;
}

interface CompactArchiveManifest extends ManifestFields {
  version: 3;
  state: typeof COMPACT_STATE;
}

type ArchiveManifest = LegacyArchiveManifest | CompactArchiveManifest;

const unsupported = () =>
  new StudioError(
    'UNSUPPORTED_STORAGE',
    '此备份使用不受支持的旧版存储格式，请由 AI 按迁移说明重建作品。',
  );

function entryLimit(name: string): number {
  if (name === 'artifact.json') {
    throw unsupported();
  }
  if (name === 'manifest.json') {
    return MAX_MANIFEST_BYTES;
  }
  if (name === LEGACY_DATABASE) {
    return MAX_LEGACY_SNAPSHOT_BYTES;
  }
  if (name === COMPACT_STATE) {
    return MAX_ARCHIVE_STATE_BYTES;
  }
  if (name === 'assets/') {
    return 0;
  }
  if (
    /^assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.slice(7))
  ) {
    return MAX_ARCHIVE_ASSET_BYTES;
  }

  throw invalid('备份包含不允许的文件路径。');
}

function extract(data: Uint8Array): Map<string, Uint8Array> {
  if (!data.length) {
    throw invalid();
  }
  if (data.length > MAX_ARCHIVE_BYTES) {
    throw tooLarge();
  }

  const declared = new Map<string, UnzipFileInfo>();
  const names = new Set<string>();
  const files = new Map<string, Uint8Array>();
  let declaredSize = 0;
  let actualSize = 0;
  try {
    unzipSync(data, {
      filter(info) {
        const limit = entryLimit(info.name);
        if (names.has(info.name.toLowerCase())) {
          throw invalid('备份包含重复文件。');
        }

        const exceedsEntryLimit = declared.size >= MAX_ENTRIES || info.originalSize > limit;
        const unsupportedCompression = ![0, 8].includes(info.compression);
        if (exceedsEntryLimit || info.size > MAX_ARCHIVE_BYTES || unsupportedCompression) {
          throw tooLarge();
        }

        declaredSize += info.originalSize;
        if (declaredSize > MAX_EXPANDED_BYTES) {
          throw tooLarge();
        }

        declared.set(info.name, info);
        names.add(info.name.toLowerCase());

        return false;
      },
    });

    const hasLegacyDatabase = declared.has(LEGACY_DATABASE);
    const hasCompactState = declared.has(COMPACT_STATE);
    if (!declared.has('manifest.json') || hasLegacyDatabase === hasCompactState) {
      throw invalid('备份必须包含一份作品数据和格式说明。');
    }

    const seen = new Set<string>();
    const completed = new Set<string>();
    const unzipper = new Unzip((file) => {
      const limit = entryLimit(file.name);
      const info = declared.get(file.name);
      if (!info || seen.has(file.name)) {
        throw invalid('备份文件目录不一致或存在重复文件。');
      }

      const originalSizeMismatch =
        file.originalSize !== undefined && file.originalSize !== info.originalSize;
      const compressedSizeMismatch = file.size !== undefined && file.size !== info.size;
      if (file.compression !== info.compression || originalSizeMismatch || compressedSizeMismatch) {
        throw invalid();
      }

      seen.add(file.name);
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (error, chunk, final) => {
        if (error) {
          throw error;
        }

        size += chunk.length;
        actualSize += chunk.length;
        if (size > limit || size > info.originalSize || actualSize > MAX_EXPANDED_BYTES) {
          file.terminate();
          throw tooLarge();
        }

        chunks.push(chunk);
        if (final) {
          if (size !== info.originalSize) {
            throw invalid();
          }

          files.set(file.name, Buffer.concat(chunks, size));
          completed.add(file.name);
        }
      };

      file.start();
    });
    unzipper.register(UnzipInflate);

    for (let offset = 0; offset < data.length; offset += 1024) {
      unzipper.push(data.subarray(offset, offset + 1024), offset + 1024 >= data.length);
    }

    if (completed.size !== declared.size) {
      throw invalid();
    }

    return files;
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw invalid(undefined, { cause: error });
  }
}

function manifest(files: Map<string, Uint8Array>): ArchiveManifest {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(files.get('manifest.json')!),
    );
  } catch (error) {
    throw invalid('备份格式说明无效。', { cause: error });
  }

  if (!object(value) || value.format !== ARCHIVE_FORMAT) {
    throw unsupported();
  }

  if (value.version === 2 && value.database === LEGACY_DATABASE) {
    if (Object.hasOwn(value, 'state')) {
      throw invalid('备份格式说明包含多个作品数据入口。');
    }

    return {
      format: ARCHIVE_FORMAT,
      version: 2,
      database: LEGACY_DATABASE,
      artifactId: safeId(value.artifactId, '作品 ID'),
    };
  }
  if (value.version === 3) {
    if (value.state !== COMPACT_STATE || Object.hasOwn(value, 'database')) {
      throw invalid('备份格式说明中的作品数据入口无效。');
    }

    return {
      format: ARCHIVE_FORMAT,
      version: 3,
      state: COMPACT_STATE,
      artifactId: safeId(value.artifactId, '作品 ID'),
    };
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

async function readDatabase(
  root: string,
  bytes: Uint8Array,
  artifactId: string,
): Promise<ArtifactState<unknown>> {
  if (!Buffer.from(bytes.subarray(0, 16)).equals(Buffer.from('SQLite format 3\0'))) {
    throw invalid('备份数据库无效。');
  }

  await mkdir(join(root, 'staging'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'staging', 'read-'));
  let database: SqliteArtifactRepository | undefined;
  try {
    const file = join(temporary, LEGACY_DATABASE);
    await writeFile(file, bytes, { flag: 'wx' });
    try {
      database = new SqliteArtifactRepository(file);
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
      if (
        error instanceof StudioError &&
        ['UNSUPPORTED_STORAGE', 'TOO_LARGE'].includes(error.code)
      ) {
        throw error;
      }

      throw invalid('备份数据库无法读取或内容不完整。', { cause: error });
    }
  } finally {
    database?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

function readCompactState(bytes: Uint8Array, artifactId: string): ArtifactState<unknown> {
  const state = decodeArchiveState(bytes);
  if (!object(state) || !object(state.artifact) || state.artifact.id !== artifactId) {
    throw invalid('备份作品标识与作品数据不一致。');
  }

  return state as unknown as ArtifactState<unknown>;
}

export class FileArchiveStorage implements ArchiveStorage {
  constructor(
    private readonly repository: Pick<StudioRepository, 'root' | 'folder'>,
    private readonly assetFiles: Pick<AssetFileStore, 'read'>,
  ) {}

  async readInput(args: Record<string, unknown>): Promise<Uint8Array> {
    if ((args.archivePath !== undefined) === (args.archiveBase64 !== undefined)) {
      throw new StudioError('INVALID_ARGUMENT', '请提供一个备份文件路径或备份内容。');
    }

    if (args.archiveBase64 !== undefined) {
      const encoded = args.archiveBase64;
      if (
        typeof encoded !== 'string' ||
        !encoded.length ||
        encoded.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4
      ) {
        throw tooLarge();
      }

      let padding = 0;
      if (encoded.endsWith('=')) {
        padding = encoded.endsWith('==') ? 2 : 1;
      }
      if (encoded.length % 4 || /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) {
        throw invalid('备份内容不是有效的 Base64。');
      }

      const data = Buffer.from(encoded, 'base64');
      if (data.length > MAX_ARCHIVE_BYTES) {
        throw tooLarge();
      }

      return data;
    }

    const path = text(args.archivePath, '', 4096);
    if (!path.trim()) {
      throw new StudioError('INVALID_ARGUMENT', '备份文件路径不能为空。');
    }

    const file = await open(path, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile()) {
        throw invalid('备份路径必须指向文件。');
      }
      if (info.size > MAX_ARCHIVE_BYTES) {
        throw tooLarge();
      }

      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const chunk = Buffer.allocUnsafe(64 * 1024);
        const { bytesRead } = await file.read(chunk);
        if (!bytesRead) {
          break;
        }

        size += bytesRead;
        if (size > MAX_ARCHIVE_BYTES) {
          throw tooLarge();
        }

        chunks.push(chunk.subarray(0, bytesRead));
      }

      return Buffer.concat(chunks, size);
    } finally {
      await file.close();
    }
  }

  async readArchive(data: Uint8Array): Promise<ArchiveSnapshot> {
    const files = extract(data);
    const metadata = manifest(files);
    const payload = files.get(metadata.version === 2 ? metadata.database : metadata.state);
    if (!payload) {
      throw invalid('备份格式说明与作品数据不一致。');
    }

    const state =
      metadata.version === 2
        ? await readDatabase(this.repository.root, payload, metadata.artifactId)
        : readCompactState(payload, metadata.artifactId);
    const assets = new Map<string, Uint8Array>();

    for (const [name, bytes] of files) {
      if (name.startsWith('assets/') && name !== 'assets/') {
        assets.set(name.slice(7), bytes);
      }
    }

    return { state, assets };
  }

  async captureSnapshot(state: ArtifactState<unknown>): Promise<ArchiveSnapshot> {
    const entries = Object.entries(state.assets);
    if (entries.length + 2 > MAX_ENTRIES) {
      throw tooLarge();
    }

    const assets = new Map<string, Uint8Array>();
    let size = 0;
    for (const [id, asset] of entries) {
      const file = await this.assetFiles.read(state.artifact.id, id, MAX_ARCHIVE_ASSET_BYTES);
      if (file.kind === 'too-large') {
        throw tooLarge();
      }
      if (file.kind !== 'data' || file.data.length !== asset.size) {
        throw invalid('作品资源不完整，未生成备份。');
      }

      size += file.data.length;
      if (size > MAX_EXPANDED_BYTES) {
        throw tooLarge();
      }

      assets.set(id, file.data);
    }

    return { state, assets };
  }

  async writeSnapshot({ state: snapshot, assets }: ArchiveSnapshot): Promise<ExportBytes> {
    const state = encodeArchiveState(snapshot);
    const metadata: CompactArchiveManifest = {
      format: ARCHIVE_FORMAT,
      version: 3,
      state: COMPACT_STATE,
      artifactId: snapshot.artifact.id,
    };
    const description = Buffer.from(JSON.stringify(metadata));
    const entries: Zippable = { 'manifest.json': description, [COMPACT_STATE]: state };
    let size = state.length + description.length;
    for (const [id, bytes] of assets) {
      size += bytes.length;
      if (bytes.length > MAX_ARCHIVE_ASSET_BYTES || size > MAX_EXPANDED_BYTES) {
        throw tooLarge();
      }

      entries[`assets/${id}`] = [bytes, { level: 0 }];
    }

    const bytes = zipSync(entries, { level: 6 });
    if (bytes.length > MAX_ARCHIVE_BYTES) {
      throw tooLarge();
    }

    const filename =
      (basename(snapshot.artifact.title)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .trim() || '作品') + '.studio.zip';

    return {
      filename,
      mimeType: 'application/zip',
      data: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
    };
  }

  async publishImported(
    state: ArtifactState<unknown>,
    assets: ReadonlyMap<string, Uint8Array>,
  ): Promise<void> {
    await mkdir(join(this.repository.root, 'staging'), { recursive: true });
    const staging = await mkdtemp(join(this.repository.root, 'staging', 'import-'));
    try {
      await mkdir(join(staging, 'assets'));
      for (const assetId of Object.keys(state.assets)) {
        await writeFile(join(staging, 'assets', assetId), assets.get(assetId)!, {
          flag: 'wx',
        });
      }

      writeDatabase(join(staging, LEGACY_DATABASE), state);
      await mkdir(join(this.repository.root, 'artifacts'), { recursive: true });
      await renameWithRetry(staging, this.repository.folder(state.artifact.id));
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
}
