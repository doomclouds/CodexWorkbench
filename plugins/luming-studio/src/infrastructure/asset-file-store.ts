import { cp, lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type {
  AssetFileRead,
  AssetFileStore,
  ImportedAssetFile,
  RecycledAssetFile,
} from '../core/ports/asset-file-store.js';
import type { StudioRepository } from '../core/ports/studio-repository.js';
import { safeId, StudioError } from '../shared/studio-error.js';
import { atomicWrite } from './filesystem/atomic-write.js';
import { regularFile, resourceScope, samePath } from './filesystem/owned-file.js';

interface ArtifactPaths extends Pick<StudioRepository, 'root' | 'folder'> {
  activeAssetFolder?(artifactId: string): Promise<string>;
}
type AssetDirectory = 'assets' | 'recycle-assets';

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function readBoundedFile(path: string, maxBytes: number): Promise<AssetFileRead> {
  const before = await regularFile(path);
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) {
      throw resourceScope();
    }
    if (info.size > maxBytes) {
      return { kind: 'too-large' };
    }

    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - size));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) {
        break;
      }

      size += bytesRead;
      if (size > maxBytes) {
        return { kind: 'too-large' };
      }

      chunks.push(chunk.subarray(0, bytesRead));
    }

    return size ? { kind: 'data', data: Buffer.concat(chunks, size) } : { kind: 'empty' };
  } finally {
    await file.close();
  }
}

async function assertRecyclingAvailable(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }

    throw error;
  }

  throw new StudioError('RESOURCE_STATE', '资源已有内部回收副本，请保留文件并检查作品数据。');
}

export class FileAssetStore implements AssetFileStore {
  constructor(private readonly paths: ArtifactPaths) {}

  private async artifactFolder(artifactId: string): Promise<string> {
    const id = safeId(artifactId);
    if (this.paths.activeAssetFolder) {
      return this.paths.activeAssetFolder(id);
    }
    if (!samePath(resolve(this.paths.folder(id)), resolve(this.paths.root, 'artifacts', id))) {
      throw resourceScope();
    }

    return join(await realpath(this.paths.root), 'artifacts', id);
  }

  private async assetDirectory(
    artifactId: string,
    directory: AssetDirectory,
    create = false,
  ): Promise<string> {
    const folder = await this.artifactFolder(artifactId);
    if (!samePath(await realpath(folder), folder)) {
      throw resourceScope();
    }

    const path = join(folder, directory);
    if (create) {
      await mkdir(path, { recursive: true });
    }
    if (!samePath(await realpath(path), path)) {
      throw resourceScope();
    }

    return path;
  }

  async readImport(path: string, maxBytes: number): Promise<ImportedAssetFile> {
    const canonical = await realpath(path);
    if (!samePath(canonical, resolve(path))) {
      throw new StudioError(
        'RESOURCE_SCOPE',
        '请提供资源文件的真实绝对路径，不能通过符号链接导入。',
      );
    }

    return { filename: basename(canonical), content: await readBoundedFile(canonical, maxBytes) };
  }

  async read(artifactId: string, assetId: string, maxBytes: number): Promise<AssetFileRead> {
    const id = safeId(assetId, '资源 ID');
    try {
      const directory = await this.assetDirectory(artifactId, 'assets');

      return await readBoundedFile(join(directory, id), maxBytes);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }

    const directory = await this.assetDirectory(artifactId, 'recycle-assets');

    return readBoundedFile(join(directory, id), maxBytes);
  }

  async write(artifactId: string, assetId: string, data: Uint8Array): Promise<void> {
    const id = safeId(assetId, '资源 ID');
    const directory = await this.assetDirectory(artifactId, 'assets', true);
    await atomicWrite(join(directory, id), data);
  }

  async recycle(artifactId: string, assetId: string): Promise<RecycledAssetFile | undefined> {
    const id = safeId(assetId, '资源 ID');
    const active = join(await this.assetDirectory(artifactId, 'assets'), id);
    const recycled = join(await this.assetDirectory(artifactId, 'recycle-assets', true), id);
    try {
      await regularFile(active);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }

      await regularFile(recycled);

      return;
    }

    await assertRecyclingAvailable(recycled);
    await rename(active, recycled);

    return { restore: () => this.restoreRecycledFile(artifactId, active, recycled) };
  }

  private async restoreRecycledFile(
    artifactId: string,
    active: string,
    recycled: string,
  ): Promise<void> {
    const activeFolder = await this.assetDirectory(artifactId, 'assets');
    const recycledFolder = await this.assetDirectory(artifactId, 'recycle-assets');
    if (!samePath(active, join(activeFolder, basename(active)))) {
      throw resourceScope();
    }
    if (!samePath(recycled, join(recycledFolder, basename(recycled)))) {
      throw resourceScope();
    }

    await regularFile(recycled);
    await rename(recycled, active);
  }

  async duplicate(from: string, to: string): Promise<void> {
    try {
      const source = await this.assetDirectory(from, 'assets');
      const destination = await this.artifactFolder(to);
      await cp(source, join(destination, 'assets'), {
        recursive: true,
      });
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }
}
