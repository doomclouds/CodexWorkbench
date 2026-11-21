import { lstat, mkdir, open, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { lock } from 'proper-lockfile';
import type {
  ArtifactAuthorization,
  ArtifactMetadata,
  ArtifactState,
  ArtifactUnitProjection,
  ArtifactUnitRequest,
  StudioRepository,
} from '../core/ports/studio-repository.js';
import { isRecord as object } from '../shared/is-record.js';
import { safeId, StudioError } from '../shared/studio-error.js';
import { renameWithRetry } from './filesystem/atomic-write.js';
import { samePath } from './filesystem/owned-file.js';
import { readLegacyArtifact, trashLegacyArtifact } from './legacy-artifacts.js';
import { freezeArtifactValue, SqliteArtifactRepository } from './sqlite-artifact.js';

const resourceScope = () =>
  new StudioError(
    'RESOURCE_SCOPE',
    '删除路径必须位于当前作品的真实目录中，不能通过符号链接访问其他位置。',
  );

async function validateDeletionTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !samePath(await realpath(path), path)) {
    throw resourceScope();
  }

  if (info.isDirectory()) {
    for (const entry of await readdir(path)) {
      await validateDeletionTree(join(path, entry));
    }
  } else if (!info.isFile()) {
    throw resourceScope();
  }
}

function rollback(repository: SqliteArtifactRepository | undefined): void {
  try {
    if (repository?.database.isTransaction) {
      repository.database.exec('ROLLBACK');
    }
  } catch (error) {
    process.emitWarning(`SQLite rollback failed: ${String(error)}`, {
      code: 'STUDIO_SQLITE_ROLLBACK_FAILED',
    });
  }
}

export class ArtifactStore<Content, Anchor = unknown, Source = unknown> implements StudioRepository<
  Content,
  Anchor,
  Source
> {
  readonly root: string;
  constructor(
    root?: string,
    private readonly decode?: (value: unknown) => ArtifactState<Content, Anchor, Source>,
    private readonly validateState?: (state: ArtifactState<Content, Anchor, Source>) => void,
  ) {
    this.root = resolve(root ?? join(homedir(), '.codexworkbench', 'luming-studio'));
  }
  folder(id: string) {
    return join(this.root, 'artifacts', safeId(id));
  }
  file(id: string) {
    return join(this.folder(id), 'artifact.sqlite');
  }
  async readLegacyArtifact(id: string): Promise<ArtifactMetadata | undefined> {
    return readLegacyArtifact(this.root, id);
  }
  async trashLegacyArtifact(id: string, expectedRevision?: unknown): Promise<ArtifactMetadata> {
    return trashLegacyArtifact(this.root, id, expectedRevision);
  }
  private async assertOwnedPath(id: string, creating = false): Promise<void> {
    const folder = this.folder(id);
    const canonical = await realpath(folder);
    if (!samePath(canonical, join(await realpath(this.root), 'artifacts', safeId(id)))) {
      throw resourceScope();
    }

    try {
      const file = this.file(id);
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !samePath(await realpath(file), join(canonical, 'artifact.sqlite'))
      ) {
        throw resourceScope();
      }
    } catch (error) {
      if (!creating || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  private normalize(value: unknown, id: string): ArtifactState<Content, Anchor, Source> {
    const state = this.decode
      ? this.decode(value)
      : (value as ArtifactState<Content, Anchor, Source>);
    const error = () => new StudioError('CORRUPT_ARTIFACT', '作品数据库内容无效。');
    if (!object(state) || state.schemaVersion !== 2 || state.artifact?.id !== id) {
      throw error();
    }
    if (typeof state.artifact.type !== 'string' || !('content' in state)) {
      throw error();
    }
    if (
      !Array.isArray(state.history) ||
      !Array.isArray(state.feedback) ||
      !Array.isArray(state.operations)
    ) {
      throw error();
    }
    if (!object(state.sharing) || !object(state.sources) || !object(state.assets)) {
      throw error();
    }

    this.validateState?.(state);

    return state;
  }
  private async assertDatabase(id: string): Promise<void> {
    try {
      await this.assertOwnedPath(id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      if (await readLegacyArtifact(this.root, id)) {
        throw new StudioError(
          'UNSUPPORTED_STORAGE',
          '此旧版作品不受支持，可将其移入回收站。',
          undefined,
          { cause: error },
        );
      }

      throw new StudioError('NOT_FOUND', '作品不存在。', undefined, { cause: error });
    }
  }
  private failure(error: unknown): never {
    if (error instanceof StudioError) {
      throw error;
    }

    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'SQLITE_BUSY' || (error as { errcode?: number }).errcode === 5) {
      throw new StudioError('BUSY', '另一个进程正在保存作品，请稍后重试。', undefined, {
        cause: error,
      });
    }

    throw new StudioError(
      'CORRUPT_ARTIFACT',
      '作品数据库无法读取，请保留原文件并从备份恢复。',
      undefined,
      { cause: error },
    );
  }
  async readAuthorization(id: string): Promise<ArtifactAuthorization> {
    await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    try {
      repository = new SqliteArtifactRepository(this.file(id));
      repository.database.exec('BEGIN');
      const authorization = repository.readAuthorization();
      if (authorization.artifact.id !== id) {
        throw new StudioError('CORRUPT_ARTIFACT', '作品数据库信息无效。');
      }

      repository.database.exec('COMMIT');

      return authorization;
    } catch (error) {
      return this.failure(error);
    } finally {
      repository?.close();
    }
  }

  async read(
    id: string,
    options: { maxExpandedBytes?: number } = {},
  ): Promise<ArtifactState<Content, Anchor, Source>> {
    return this.readProjection(id, (state) => state, options);
  }

  async readProjection<R>(
    id: string,
    pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => R,
    options: { maxExpandedBytes?: number } = {},
  ): Promise<R> {
    await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    let selecting = false;
    try {
      repository = new SqliteArtifactRepository(this.file(id));
      repository.database.exec('BEGIN');
      const state = this.normalize(repository.readState<Content, Anchor, Source>(options), id);
      freezeArtifactValue(state);
      selecting = true;
      const result = structuredClone(pick(state));
      selecting = false;
      repository.database.exec('COMMIT');

      return result;
    } catch (error) {
      if (selecting) {
        throw error;
      }

      return this.failure(error);
    } finally {
      repository?.close();
    }
  }

  async readUnitProjection(
    id: string,
    select: (authorization: ArtifactAuthorization) => ArtifactUnitRequest | undefined,
  ): Promise<ArtifactUnitProjection | undefined> {
    await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    let selecting = false;
    try {
      repository = new SqliteArtifactRepository(this.file(id));
      repository.database.exec('BEGIN');
      const authorization = repository.readAuthorization();
      if (authorization.artifact.id !== id) {
        throw new StudioError('CORRUPT_ARTIFACT', '作品数据库信息无效。');
      }

      selecting = true;
      const request = select(authorization);
      selecting = false;
      const result = request && repository.readUnitProjection(authorization, request);
      const projection = result && this.normalizeUnitProjection(id, result);
      repository.database.exec('COMMIT');

      return projection;
    } catch (error) {
      if (selecting) {
        throw error;
      }

      return this.failure(error);
    } finally {
      repository?.close();
    }
  }

  private normalizeUnitProjection(
    id: string,
    result: { current: unknown; projection: ArtifactUnitProjection },
  ): ArtifactUnitProjection {
    const current = this.normalize(result.current, id);
    const { snapshot, order } = result.projection;
    if (snapshot?.artifact.revision === current.artifact.revision) {
      return { snapshot: { artifact: current.artifact, content: current.content }, order };
    }

    return result.projection;
  }

  async catalog(): Promise<ArtifactMetadata[]> {
    let entries;
    try {
      entries = await readdir(join(this.root, 'artifacts'), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }

    const result: ArtifactMetadata[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(entry.name)) {
        await this.appendCatalogEntry(result, entry.name);
      }
    }

    return result;
  }
  private async appendCatalogEntry(result: ArtifactMetadata[], id: string): Promise<void> {
    let repository: SqliteArtifactRepository | undefined;
    try {
      await this.assertOwnedPath(id);
      repository = new SqliteArtifactRepository(this.file(id));
      repository.database.exec('BEGIN');
      const artifact = repository.readMetadata();
      if (!object(artifact) || artifact.id !== id) {
        throw new StudioError('CORRUPT_ARTIFACT', '作品数据库信息无效。');
      }

      result.push(artifact as unknown as ArtifactMetadata);
      repository.database.exec('COMMIT');
    } catch (error) {
      if (
        error instanceof StudioError &&
        ['CORRUPT_ARTIFACT', 'UNSUPPORTED_STORAGE'].includes(error.code)
      ) {
        return;
      }

      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ERR_SQLITE_ERROR' || error instanceof SyntaxError) {
        return;
      }
      if (code !== 'ENOENT') {
        throw error;
      }

      const legacy = await readLegacyArtifact(this.root, id);
      if (legacy) {
        result.push(legacy);
      }
    } finally {
      repository?.close();
    }
  }
  async list(): Promise<ArtifactState<Content, Anchor, Source>[]> {
    const artifacts = await this.catalog();

    return Promise.all(
      artifacts
        .filter((artifact) => artifact.storageStatus !== 'unsupported')
        .map((artifact) => this.read(artifact.id)),
    );
  }

  async write(state: ArtifactState<Content, Anchor, Source>): Promise<void> {
    const normalized = this.normalize(structuredClone(state), state.artifact.id);
    await mkdir(this.folder(state.artifact.id), { recursive: true });
    await this.withLock(state.artifact.id, this.folder(state.artifact.id), async (assertLocked) => {
      await this.assertOwnedPath(state.artifact.id, true);
      let creating = false;
      try {
        await lstat(this.file(state.artifact.id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }

        creating = true;
      }

      const target = creating
        ? join(this.folder(state.artifact.id), `.${randomUUID().slice(0, 8)}.db`)
        : this.file(state.artifact.id);
      let repository: SqliteArtifactRepository | undefined;
      let reserved = false;
      try {
        if (creating) {
          const handle = await open(target, 'wx');
          reserved = true;
          await handle.close();
        }

        repository = new SqliteArtifactRepository(target, true);
        repository.database.exec('BEGIN IMMEDIATE');
        repository.writeState(normalized);
        assertLocked();
        repository.database.exec('COMMIT');
        repository.close();
        repository = undefined;
        if (creating) {
          assertLocked();
          await renameWithRetry(target, this.file(state.artifact.id));
        }
      } catch (error) {
        rollback(repository);
        throw error;
      } finally {
        repository?.close();
        if (reserved) {
          await rm(target, { force: true });
        }
      }
    });
  }
  async transaction<T>(
    id: string,
    run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T,
  ): Promise<T> {
    await this.assertDatabase(id);

    return this.withLock(id, this.folder(id), async (assertLocked) => {
      await this.assertDatabase(id);
      const repository = new SqliteArtifactRepository(this.file(id), true);
      try {
        repository.database.exec('BEGIN IMMEDIATE');
        const state = this.normalize(repository.readState<Content, Anchor, Source>(), id);
        for (const saved of state.history) {
          freezeArtifactValue(saved);
        }

        const result = structuredClone(await run(state));
        assertLocked();
        repository.keepWritePageCacheForRetainedHistory(state.history);
        repository.writeState(state);
        assertLocked();
        repository.database.exec('COMMIT');

        return result;
      } catch (error) {
        rollback(repository);
        throw error;
      } finally {
        repository.close();
      }
    });
  }

  async withSnapshotLock<T>(
    id: string,
    run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T,
  ): Promise<T> {
    await this.assertDatabase(id);

    return this.withLock(id, this.folder(id), async (assertLocked) => {
      const state = await this.read(id);
      assertLocked();
      const result = await run(state);
      assertLocked();

      return result;
    });
  }

  async withProjectionLock<R, T>(
    id: string,
    pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => R,
    run: (projection: R) => Promise<T> | T,
  ): Promise<T> {
    return this.withLock(id, this.folder(id), async (assertLocked) => {
      const projection = await this.readProjection(id, pick);
      assertLocked();
      const result = await run(projection);
      assertLocked();

      return result;
    });
  }

  async purge(id: string, beforeDelete: () => Promise<void>): Promise<void> {
    const folder = this.folder(id);
    let canonical: string;
    try {
      canonical = await realpath(folder);
      if (!samePath(canonical, join(await realpath(this.root), 'artifacts', safeId(id)))) {
        throw resourceScope();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StudioError('NOT_FOUND', '作品不存在。', undefined, { cause: error });
      }

      throw error;
    }

    await this.withLock(id, canonical, async (assertLocked) => {
      const legacy = await readLegacyArtifact(this.root, id);
      const artifact = legacy ?? (await this.readProjection(id, (state) => state.artifact));
      if (!artifact.trashedAt) {
        throw new StudioError('NOT_TRASHED', '仅能永久删除回收站中的作品，请先移入回收站。');
      }

      const entries = (await readdir(canonical)).filter((entry) => entry !== 'write.lock');
      for (const entry of entries) {
        await validateDeletionTree(join(canonical, entry));
      }

      assertLocked();
      await beforeDelete();
      const metadataFile = legacy ? 'artifact.json' : 'artifact.sqlite';

      for (const entry of entries.filter(
        (entry) => entry !== metadataFile && !(legacy && entry === 'unsupported-trash.json'),
      )) {
        assertLocked();
        await rm(join(canonical, entry), { recursive: true, force: true });
      }

      assertLocked();
      await rm(join(canonical, metadataFile), { force: true });
      if (legacy) {
        assertLocked();
        await rm(join(canonical, 'unsupported-trash.json'), { force: true });
      }
    });

    try {
      await rmdir(canonical);
    } catch (error) {
      if (
        !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error;
      }
    }
  }
  private async withLock<T>(
    id: string,
    folder: string,
    run: (assertLocked: () => void) => Promise<T>,
  ): Promise<T> {
    let lost: Error | undefined;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(join(folder, 'write'), {
        realpath: false,
        stale: 30_000,
        update: 5000,
        retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 },
        onCompromised: (error) => {
          lost = error;
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
        throw new StudioError('BUSY', '另一个进程正在保存作品，请稍后重试。', undefined, {
          cause: error,
        });
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StudioError('NOT_FOUND', '作品不存在。', undefined, { cause: error });
      }

      throw error;
    }

    const assertLocked = () => {
      if (lost) {
        throw new StudioError('LOCK_LOST', '作品写锁已失效，修改未被提交。');
      }
    };

    try {
      return await run(assertLocked);
    } finally {
      if (!lost) {
        await release();
      }
    }
  }
}
