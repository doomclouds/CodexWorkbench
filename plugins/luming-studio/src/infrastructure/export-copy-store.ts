import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  ExportBytes,
  ExportCopyStore,
  ExportRecord,
  ExportStream,
  StagedArchiveFile,
} from '../core/ports/export-copy-store.js';
import { safeId, StudioError } from '../shared/studio-error.js';
import { atomicWrite } from './filesystem/atomic-write.js';
import { regularFile, resourceScope, samePath } from './filesystem/owned-file.js';

async function* exportChunks(result: StagedArchiveFile): AsyncIterable<Uint8Array> {
  let size = 0;
  for await (const chunk of result.chunks()) {
    size += chunk.length;
    if (size > result.size) {
      throw new StudioError('CORRUPT_EXPORT', '导出文件体积不符。');
    }

    yield chunk;
  }

  if (size !== result.size) {
    throw new StudioError('CORRUPT_EXPORT', '导出文件体积不符。');
  }
}

export class FileExportCopyStore implements ExportCopyStore {
  constructor(private readonly root: string) {}

  async save(artifactId: string, result: ExportBytes | StagedArchiveFile): Promise<ExportRecord> {
    const exportId = randomUUID();
    let data: Uint8Array | AsyncIterable<Uint8Array>;
    let size: number;
    if ('data' in result) {
      data = Buffer.from(result.data, result.encoding === 'base64' ? 'base64' : 'utf8');
      size = data.length;
    } else {
      data = exportChunks(result);
      size = result.size;
    }

    const record: ExportRecord = {
      exportId,
      artifactId,
      filename: basename(result.filename),
      mimeType: result.mimeType,
      size,
      downloadPath: `/api/exports/${exportId}?artifactId=${encodeURIComponent(artifactId)}`,
    };
    const file = join(this.root, 'exports', exportId);
    await atomicWrite(file, data);
    try {
      await atomicWrite(join(this.root, 'exports', `${exportId}.json`), JSON.stringify(record));
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    }

    return record;
  }

  private async record(exportId: string): Promise<ExportRecord> {
    safeId(exportId, '导出 ID');
    try {
      const metadata = join(this.root, 'exports', `${exportId}.json`);
      await regularFile(metadata);
      const record = JSON.parse(await readFile(metadata, 'utf8')) as ExportRecord;
      const file = await regularFile(join(this.root, 'exports', exportId));
      if (record.exportId !== exportId || record.size !== file.size) {
        throw new StudioError('CORRUPT_EXPORT', '导出记录与文件不一致。');
      }

      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StudioError('NOT_FOUND', '导出文件不存在。', undefined, { cause: error });
      }

      throw error;
    }
  }

  async read(exportId: string): Promise<ExportRecord & { data: Uint8Array }> {
    const record = await this.record(exportId);

    return { ...record, data: await readFile(join(this.root, 'exports', exportId)) };
  }

  async open(exportId: string): Promise<ExportStream> {
    const record = await this.record(exportId);
    const file = join(this.root, 'exports', exportId);

    return { ...record, chunks: () => createReadStream(file) };
  }

  async purge(artifactId: string): Promise<void> {
    const directory = join(await realpath(this.root), 'exports');
    let entries: string[];
    try {
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        !samePath(await realpath(directory), directory)
      ) {
        throw resourceScope();
      }

      entries = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }

      throw error;
    }

    const owned: { metadata: string; data: string }[] = [];
    for (const name of entries) {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,119})\.json$/.exec(name);
      if (!match) {
        continue;
      }

      const metadata = join(directory, name);
      let record: unknown;
      try {
        await regularFile(metadata);
        record = JSON.parse(await readFile(metadata, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        if (error instanceof SyntaxError) {
          throw new StudioError(
            'CORRUPT_EXPORT',
            '导出记录无法读取，作品尚未删除；请保留并检查导出目录。',
            undefined,
            { cause: error },
          );
        }

        throw error;
      }

      if (!record || typeof record !== 'object' || !('artifactId' in record)) {
        continue;
      }
      if (record.artifactId !== artifactId) {
        continue;
      }
      if (!('exportId' in record) || record.exportId !== match[1]) {
        throw new StudioError(
          'CORRUPT_EXPORT',
          '导出记录与文件名不符，作品尚未删除；请保留并检查导出目录。',
        );
      }

      const data = join(directory, match[1]);
      try {
        await regularFile(data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      owned.push({ metadata, data });
    }

    for (const entry of owned) {
      await rm(entry.data, { force: true });
      await rm(entry.metadata, { force: true });
    }
  }
}
