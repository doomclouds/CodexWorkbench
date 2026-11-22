import { lstat, mkdir, open, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { lock } from 'proper-lockfile';
import type { BoardOpenScene } from '../contracts/board-open.js';
import type {
  ArtifactAuthorization,
  ArtifactMetadata,
  ArtifactState,
  ArtifactUnitProjection,
  ArtifactUnitRequest,
  ArtifactWriteOptions,
  LocalUnitWritePlan,
  StudioRepository,
} from '../core/ports/studio-repository.js';
import { isRecord as object } from '../shared/is-record.js';
import { safeId, StudioError } from '../shared/studio-error.js';
import { ArtifactMigration, type ArtifactLocation } from './artifact-migration.js';
import { renameWithRetry } from './filesystem/atomic-write.js';
import { samePath } from './filesystem/owned-file.js';
import { readLegacyArtifact, trashLegacyArtifact } from './legacy-artifacts.js';
import { freezeArtifactValue, SqliteArtifactRepository } from './sqlite-artifact.js';

class UpgradeDeferred extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    super('作品存储升级准备失败，旧库仍可使用。', { cause });
  }
}

const resourceScope = () =>
  new StudioError(
    'RESOURCE_SCOPE',
    '删除路径必须位于当前作品的真实目录中，不能通过符号链接访问其他位置。',
  );

const artifactNotFound = (cause: unknown) =>
  new StudioError('NOT_FOUND', '作品不存在。', undefined, { cause });

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function artifactAuthorization(repository: SqliteArtifactRepository, id: string) {
  const authorization = repository.readAuthorization();
  if (authorization.artifact.id !== id) {
    throw new StudioError('CORRUPT_ARTIFACT', '作品数据库信息无效。');
  }

  return authorization;
}

function maintenancePending(repository: SqliteArtifactRepository): boolean {
  const artifact = repository.readMetadata();

  return object(artifact) && !artifact.trashedAt && repository.needsMaintenance;
}

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
  private readonly migration: ArtifactMigration;
  private readonly upgrades = new Map<string, Promise<void>>();
  private readonly maintenance = new Set<string>();
  private background = Promise.resolve();
  private backgroundClosed = false;
  constructor(
    root?: string,
    private readonly decode?: (value: unknown) => ArtifactState<Content, Anchor, Source>,
    private readonly validateState?: (state: ArtifactState<Content, Anchor, Source>) => void,
  ) {
    this.root = resolve(root ?? join(homedir(), '.codexworkbench', 'luming-studio'));
    this.migration = new ArtifactMigration(this.root);
  }
  folder(id: string) {
    return join(this.root, 'artifacts', safeId(id));
  }
  file(id: string) {
    return join(this.folder(id), 'artifact.sqlite');
  }
  private async activeLocation(id: string): Promise<ArtifactLocation> {
    const folder = join(await realpath(this.root), 'artifacts', safeId(id));

    return this.migration.active(id, { folder, file: join(folder, 'artifact.sqlite') });
  }
  async activeAssetFolder(id: string): Promise<string> {
    return (await this.activeLocation(id)).folder;
  }
  async readLegacyArtifact(id: string): Promise<ArtifactMetadata | undefined> {
    return readLegacyArtifact(this.root, id);
  }
  async trashLegacyArtifact(id: string, expectedRevision?: unknown): Promise<ArtifactMetadata> {
    return trashLegacyArtifact(this.root, id, expectedRevision);
  }
  private async assertOwnedPath(id: string, creating = false): Promise<ArtifactLocation> {
    const current = await this.activeLocation(id);
    const { folder, file } = current;
    const canonical = await realpath(folder);
    if (!samePath(canonical, folder)) {
      throw resourceScope();
    }

    try {
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

    return current;
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
  private async assertDatabase(id: string): Promise<ArtifactLocation> {
    try {
      return await this.assertOwnedPath(id);
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
    const current = await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    try {
      repository = new SqliteArtifactRepository(current.file);
      repository.database.exec('BEGIN');
      const authorization = artifactAuthorization(repository, id);
      repository.database.exec('COMMIT');

      return authorization;
    } catch (error) {
      return this.failure(error);
    } finally {
      repository?.close();
    }
  }

  async readBoardScene(
    id: string,
    authorize: (authorization: ArtifactAuthorization) => void,
  ): Promise<BoardOpenScene | undefined> {
    const current = await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    let selecting = false;
    try {
      repository = new SqliteArtifactRepository(current.file);
      repository.database.exec('BEGIN');
      const authorization = artifactAuthorization(repository, id);
      selecting = true;
      authorize(authorization);
      selecting = false;
      const scene = repository.readBoardScene();
      if (scene && scene.artifact.id !== id) {
        throw new StudioError('CORRUPT_ARTIFACT', '白板投影的作品标识无效。');
      }

      repository.database.exec('COMMIT');

      return scene;
    } catch (error) {
      if (selecting) {
        throw error;
      }

      return this.failure(error);
    } finally {
      repository?.close();
    }
  }

  async read(
    id: string,
    options: { maxExpandedBytes?: number; currentOnly?: boolean } = {},
  ): Promise<ArtifactState<Content, Anchor, Source>> {
    return this.readProjection(id, (state) => state, options);
  }

  async readProjection<R>(
    id: string,
    pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => R,
    options: { maxExpandedBytes?: number; currentOnly?: boolean } = {},
  ): Promise<R> {
    const current = await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    let selecting = false;
    try {
      repository = new SqliteArtifactRepository(current.file);
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
    const current = await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    let selecting = false;
    try {
      repository = new SqliteArtifactRepository(current.file);
      repository.database.exec('BEGIN');
      const authorization = artifactAuthorization(repository, id);
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
    const ids = new Set([
      ...(await this.catalogIds('artifacts')),
      ...(await this.catalogIds('artifact-generations')),
    ]);
    const result: ArtifactMetadata[] = [];
    for (const id of ids) {
      await this.appendCatalogEntry(result, id);
    }

    return result;
  }

  private async catalogIds(directory: string): Promise<string[]> {
    try {
      const path = join(await realpath(this.root), directory);
      if (!samePath(await realpath(path), path)) {
        throw resourceScope();
      }

      const entries = await readdir(path, { withFileTypes: true });

      return entries
        .filter(
          (entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(entry.name),
        )
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }
  private async appendCatalogEntry(result: ArtifactMetadata[], id: string): Promise<void> {
    let repository: SqliteArtifactRepository | undefined;
    try {
      const current = await this.assertOwnedPath(id);
      repository = new SqliteArtifactRepository(current.file);
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
    const id = state.artifact.id;
    await mkdir(this.folder(id), { recursive: true });
    await this.withLock(id, await this.writeFolder(id), async (assertLocked) => {
      const current = await this.assertOwnedPath(id, true);
      let creating = false;
      try {
        await lstat(current.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }

        creating = true;
      }

      const target = creating
        ? join(current.folder, `.${randomUUID().slice(0, 8)}.db`)
        : current.file;
      let repository: SqliteArtifactRepository | undefined;
      let reserved = false;
      try {
        if (creating) {
          const handle = await open(target, 'wx');
          reserved = true;
          await handle.close();
        }

        repository = creating
          ? new SqliteArtifactRepository(target, true)
          : await this.writableRepository(id, assertLocked);
        repository.database.exec('BEGIN IMMEDIATE');
        repository.writeState(normalized);
        assertLocked();
        repository.database.exec('COMMIT');
        repository.close();
        repository = undefined;
        if (creating) {
          assertLocked();
          await renameWithRetry(target, current.file);
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
    options: ArtifactWriteOptions<T> = {},
  ): Promise<T> {
    try {
      return await this.save(id, run, options);
    } catch (error) {
      if (!(error instanceof UpgradeDeferred)) {
        throw error;
      }

      this.reportBackgroundFailure(error);

      return await this.save(id, run, options, error.file);
    }
  }

  private async save<T>(
    id: string,
    run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T,
    options: ArtifactWriteOptions<T>,
    legacyFile?: string,
  ): Promise<T> {
    const upgrading = this.upgrades.get(id);
    if (upgrading) {
      await upgrading;
    }

    await this.assertDatabase(id);

    const committed = await this.withLock(id, await this.writeFolder(id), async (assertLocked) => {
      const repository =
        legacyFile === undefined
          ? await this.writableRepository(id, assertLocked)
          : await this.reopenAfterDeferredUpgrade(id, legacyFile, assertLocked);

      try {
        repository.database.exec('BEGIN IMMEDIATE');
        const result = await this.writeTransaction(repository, id, run, options, assertLocked);
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

    if (committed.maintenance) {
      this.scheduleMaintenance(id);
    }

    return committed.result;
  }

  private async writeTransaction<T>(
    repository: SqliteArtifactRepository,
    id: string,
    run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T,
    options: ArtifactWriteOptions<T>,
    assertLocked: () => void,
  ): Promise<{ result: T; maintenance: boolean }> {
    if (options.localUnit) {
      const local = this.writeLocalUnit(repository, id, options.localUnit, assertLocked);
      if (local) {
        return local;
      }
    }

    const state = this.normalize(
      repository.readState<Content, Anchor, Source>({
        shareContentUnits: options.shareContentUnits,
      }),
      id,
    );

    for (const saved of state.history) {
      freezeArtifactValue(saved);
    }

    const result = structuredClone(await run(state));
    assertLocked();
    repository.keepWritePageCacheForRetainedHistory(state.history);
    repository.writeState(state);

    return { result, maintenance: !state.artifact.trashedAt && repository.needsMaintenance };
  }

  private writeLocalUnit<T>(
    repository: SqliteArtifactRepository,
    id: string,
    local: LocalUnitWritePlan<T>,
    assertLocked: () => void,
  ): { result: T; maintenance: boolean } | undefined {
    const basis = repository.readLocalUnitMutation(local.request);
    if (!basis) {
      return;
    }
    if (basis.authorization.artifact.id !== id) {
      throw new StudioError('CORRUPT_ARTIFACT', '作品数据库信息无效。');
    }

    const planned = local.plan(basis);
    if (!planned) {
      return;
    }

    const result = structuredClone(planned.result);
    assertLocked();

    if (repository.writeLocalUnitMutation(basis, planned.write)) {
      return { result, maintenance: repository.needsMaintenance };
    }
  }

  private async writeFolder(id: string): Promise<string> {
    try {
      const folder = join(await realpath(this.root), 'artifacts', safeId(id));
      const metadata = await lstat(folder);
      if (!metadata.isDirectory() || !samePath(await realpath(folder), folder)) {
        throw resourceScope();
      }

      return folder;
    } catch (error) {
      if (isMissing(error)) {
        throw artifactNotFound(error);
      }

      throw error;
    }
  }

  private readMigrationState(repository: SqliteArtifactRepository, id: string) {
    const current = repository.readState<Content, Anchor, Source>({ currentOnly: true });
    const source =
      current.unitClocks === undefined ? repository.readState<Content, Anchor, Source>() : current;

    return this.normalize(source, id);
  }

  private async writableRepository(id: string, assertLocked: () => void) {
    const source = await this.assertDatabase(id);
    const repository = new SqliteArtifactRepository(source.file, true);
    if (repository.storageVersion === 2) {
      return repository;
    }

    try {
      const active = await this.migration.upgrade(
        source,
        repository,
        (current) => this.readMigrationState(current, id),
        id,
        assertLocked,
      );

      return new SqliteArtifactRepository(active.file, true);
    } catch (error) {
      if (error instanceof StudioError && error.code === 'LOCK_LOST') {
        throw error;
      }
      if (
        !repository.database.isTransaction &&
        repository.database.prepare('PRAGMA user_version').get()?.user_version === 1
      ) {
        throw new UpgradeDeferred(source.file, error);
      }

      throw error;
    } finally {
      repository.close();
    }
  }

  private async reopenAfterDeferredUpgrade(
    id: string,
    originalFile: string,
    assertLocked: () => void,
  ): Promise<SqliteArtifactRepository> {
    const active = await this.assertDatabase(id);
    assertLocked();
    const repository = new SqliteArtifactRepository(active.file, true);
    if (repository.storageVersion === 2 || samePath(active.file, originalFile)) {
      return repository;
    }

    repository.close();
    throw new StudioError('LOCK_LOST', '作品的有效存储已经变化，请重新打开作品。');
  }

  scheduleUpgrade(id: string): void {
    if (this.backgroundClosed || this.upgrades.has(id)) {
      return;
    }

    const upgrade = this.background
      .then(async () => {
        const remaining = await this.withLock(
          id,
          await this.writeFolder(id),
          async (assertLocked) => {
            const repository = await this.writableRepository(id, assertLocked);
            try {
              return maintenancePending(repository);
            } finally {
              repository.close();
            }
          },
        );

        if (remaining) {
          this.scheduleMaintenance(id);
        }
      })
      .catch((error: unknown) => this.reportBackgroundFailure(error))
      .finally(() => this.upgrades.delete(id))
      .then(() => undefined);
    this.upgrades.set(id, upgrade);
    this.background = upgrade;
  }

  private scheduleMaintenance(id: string): void {
    if (this.backgroundClosed || this.maintenance.has(id)) {
      return;
    }

    this.maintenance.add(id);
    this.background = this.background
      .then(() => nextTurn())
      .then(() => this.maintainArtifact(id))
      .then((remaining) => {
        if (remaining) {
          setTimeout(() => this.scheduleMaintenance(id), 100).unref();
        }
      })
      .catch((error: unknown) => this.reportBackgroundFailure(error))
      .finally(() => this.maintenance.delete(id))
      .then(() => undefined);
  }

  private async maintainArtifact(id: string): Promise<boolean> {
    const current = await this.assertDatabase(id);
    const reader = new SqliteArtifactRepository(current.file);
    try {
      if (!maintenancePending(reader)) {
        return false;
      }
    } finally {
      reader.close();
    }

    return this.withLock(id, await this.writeFolder(id), async (assertLocked) => {
      const active = await this.assertDatabase(id);
      const repository = new SqliteArtifactRepository(active.file, true);
      try {
        repository.database.exec('BEGIN IMMEDIATE');
        const remaining = maintenancePending(repository) && repository.maintainStorage();
        assertLocked();
        repository.database.exec('COMMIT');

        return remaining;
      } catch (error) {
        rollback(repository);
        throw error;
      } finally {
        repository.close();
      }
    });
  }

  private reportBackgroundFailure(error: unknown): void {
    if (
      (error instanceof StudioError && ['BUSY', 'NOT_FOUND'].includes(error.code)) ||
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }

    process.emitWarning(error instanceof Error ? error : String(error), {
      code: 'STUDIO_STORAGE_BACKGROUND_FAILED',
    });
  }

  waitForBackground(): Promise<void> {
    return this.background;
  }

  async drainBackground(): Promise<void> {
    this.backgroundClosed = true;
    await this.waitForBackground();
  }

  async createLegacyRollback(id: string): Promise<string> {
    return this.withLock(id, await this.writeFolder(id), async (assertLocked) => {
      const active = await this.assertDatabase(id);
      const repository = new SqliteArtifactRepository(active.file);
      try {
        repository.database.exec('BEGIN');
        const state = this.readMigrationState(repository, id);
        const destination = await this.migration.legacyRollback(active, state, assertLocked);
        repository.database.exec('COMMIT');

        return destination;
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

    return this.withLock(id, await this.writeFolder(id), async (assertLocked) => {
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
    return this.withLock(id, await this.writeFolder(id), async (assertLocked) => {
      const projection = await this.readProjection(id, pick);
      assertLocked();
      const result = await run(projection);
      assertLocked();

      return result;
    });
  }

  async purge(id: string, beforeDelete: () => Promise<void>): Promise<void> {
    const canonical = await this.writeFolder(id);
    await this.deletionTargets(id, canonical).catch((error: unknown) => {
      if (!isMissing(error)) {
        throw error;
      }
    });

    await this.withLock(id, canonical, async (assertLocked) => {
      const legacy = await readLegacyArtifact(this.root, id);
      const artifact = legacy ?? (await this.readProjection(id, (state) => state.artifact));
      if (!artifact.trashedAt) {
        throw new StudioError('NOT_TRASHED', '仅能永久删除回收站中的作品，请先移入回收站。');
      }

      const { entries, migrated } = await this.deletionTargets(id, canonical);

      assertLocked();
      await beforeDelete();
      if (migrated) {
        assertLocked();
        await rm(migrated, { recursive: true, force: true });
      }

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

  private async deletionTargets(id: string, canonical: string) {
    if (!samePath(await this.writeFolder(id), canonical)) {
      throw resourceScope();
    }

    const entries = (await readdir(canonical)).filter((entry) => entry !== 'write.lock');
    for (const entry of entries) {
      await validateDeletionTree(join(canonical, entry));
    }

    const migrated = await this.migration.migratedDirectory(id);
    if (migrated) {
      await validateDeletionTree(migrated);
    }

    return { entries, migrated };
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
      if (isMissing(error)) {
        throw artifactNotFound(error);
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
