import { lstat, mkdir, open, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { lock } from 'proper-lockfile';
import { object, renameWithRetry, safeId, StudioError } from './common.js';
import type { ArtifactMetadata, ArtifactState } from './model.js';
import { freezeArtifactValue, SqliteArtifactRepository } from './sqlite-artifact.js';
import { readLegacyArtifact } from './legacy-artifacts.js';

const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const resourceScope = () => new StudioError('RESOURCE_SCOPE', '删除路径必须位于当前作品的真实目录中，不能通过符号链接访问其他位置。');
async function validateDeletionTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !samePath(await realpath(path), path)) throw resourceScope();
  if (info.isDirectory()) for (const entry of await readdir(path)) await validateDeletionTree(join(path, entry));
  else if (!info.isFile()) throw resourceScope();
}

/** One canonical artifact envelope and one process-shared lock, for all products. */
export class ArtifactStore<Content, Anchor = unknown, Source = unknown> {
  readonly root: string;
  constructor(root?: string, private readonly decode?: (value: unknown) => ArtifactState<Content, Anchor, Source>, private readonly validateState?: (state: ArtifactState<Content, Anchor, Source>) => void) {
    this.root = resolve(root ?? join(homedir(), '.codexworkbench', 'agentero-studio'));
  }
  folder(id: string) { return join(this.root, 'artifacts', safeId(id)); }
  file(id: string) { return join(this.folder(id), 'artifact.sqlite'); }
  private async assertOwnedPath(id: string, creating = false): Promise<void> {
    const folder = this.folder(id);
    const canonical = await realpath(folder);
    if (!samePath(canonical, join(await realpath(this.root), 'artifacts', safeId(id)))) throw resourceScope();
    try {
      const file = this.file(id), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || !samePath(await realpath(file), join(canonical, 'artifact.sqlite'))) throw resourceScope();
    } catch (error) { if (!creating || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private normalize(value: unknown, id: string): ArtifactState<Content, Anchor, Source> {
    const state = this.decode ? this.decode(value) : value as ArtifactState<Content, Anchor, Source>;
    if (!object(state) || state.schemaVersion !== 2 || state.artifact?.id !== id || typeof state.artifact.type !== 'string' || !('content' in state) || !Array.isArray(state.history) || !Array.isArray(state.feedback) || !Array.isArray(state.operations) || !object(state.sharing) || !object(state.sources) || !object(state.assets)) throw new StudioError('CORRUPT_ARTIFACT', '作品数据库内容无效。');
    this.validateState?.(state);
    return state;
  }
  private async assertDatabase(id: string): Promise<void> {
    try { await this.assertOwnedPath(id); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (await readLegacyArtifact(this.root, id)) throw new StudioError('UNSUPPORTED_STORAGE', '此旧版作品不受支持，可将其移入回收站。');
      throw new StudioError('NOT_FOUND', '作品不存在。');
    }
  }
  private failure(error: unknown): never {
    if (error instanceof StudioError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'SQLITE_BUSY' || (error as { errcode?: number }).errcode === 5) throw new StudioError('BUSY', '另一个进程正在保存作品，请稍后重试。');
    throw new StudioError('CORRUPT_ARTIFACT', '作品数据库无法读取，请保留原文件并从备份恢复。');
  }
  async read(id: string, options: { maxExpandedBytes?: number } = {}): Promise<ArtifactState<Content, Anchor, Source>> {
    return this.readProjection(id, state => state, options);
  }
  /** Selection runs inside one SQLite read snapshot. Returned values contain no database-backed getters. */
  async readProjection<R>(id: string, pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => R, options: { maxExpandedBytes?: number } = {}): Promise<R> {
    await this.assertDatabase(id);
    let repository: SqliteArtifactRepository | undefined;
    let selecting = false;
    try {
      repository = new SqliteArtifactRepository(this.file(id)); repository.database.exec('BEGIN');
      const state = this.normalize(repository.readState<Content, Anchor, Source>(options), id);
      freezeArtifactValue(state);
      selecting = true;
      const result = structuredClone(pick(state));
      selecting = false;
      repository.database.exec('COMMIT'); return result;
    } catch (error) { if (selecting) throw error; return this.failure(error); }
    finally { repository?.close(); }
  }
  async catalog(): Promise<ArtifactMetadata[]> {
    let entries;
    try { entries = await readdir(join(this.root, 'artifacts'), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: ArtifactMetadata[] = [];
    for (const entry of entries) if (entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(entry.name)) {
      let repository: SqliteArtifactRepository | undefined;
      try {
        await this.assertOwnedPath(entry.name); repository = new SqliteArtifactRepository(this.file(entry.name));
        repository.database.exec('BEGIN');
        const artifact = repository.readMetadata();
        if (!object(artifact) || artifact.id !== entry.name) throw new StudioError('CORRUPT_ARTIFACT', '作品数据库信息无效。');
        result.push(artifact as unknown as ArtifactMetadata); repository.database.exec('COMMIT');
      } catch (error) {
        if (error instanceof StudioError && ['CORRUPT_ARTIFACT', 'UNSUPPORTED_STORAGE'].includes(error.code)) continue;
        if ((error as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR' || error instanceof SyntaxError) continue;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const legacy = await readLegacyArtifact(this.root, entry.name); if (legacy) result.push(legacy);
      } finally { repository?.close(); }
    }
    return result;
  }
  async list(): Promise<ArtifactState<Content, Anchor, Source>[]> {
    const artifacts = await this.catalog();
    return Promise.all(artifacts.filter(artifact => artifact.storageStatus !== 'unsupported').map(artifact => this.read(artifact.id)));
  }
  /** Explicit creation/import uses this path; opening legacy JSON never invokes it. */
  async write(state: ArtifactState<Content, Anchor, Source>): Promise<void> {
    const normalized = this.normalize(structuredClone(state), state.artifact.id);
    await mkdir(this.folder(state.artifact.id), { recursive: true });
    await this.withLock(state.artifact.id, this.folder(state.artifact.id), async assertLocked => {
      await this.assertOwnedPath(state.artifact.id, true);
      let creating = false;
      try { await lstat(this.file(state.artifact.id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; creating = true; }
      const target = creating ? join(this.folder(state.artifact.id), `.${randomUUID().slice(0, 8)}.db`) : this.file(state.artifact.id);
      let repository: SqliteArtifactRepository | undefined;
      let reserved = false;
      try {
        if (creating) { const handle = await open(target, 'wx'); reserved = true; await handle.close(); }
        repository = new SqliteArtifactRepository(target, true);
        repository.database.exec('BEGIN IMMEDIATE'); repository.writeState(normalized); assertLocked(); repository.database.exec('COMMIT');
        repository.close(); repository = undefined;
        if (creating) { assertLocked(); await renameWithRetry(target, this.file(state.artifact.id)); }
      } catch (error) { try { repository?.database.exec('ROLLBACK'); } catch { /* Preserve the original failed commit. */ } throw error; }
      finally { repository?.close(); if (reserved) await rm(target, { force: true }); }
    });
  }
  async transaction<T>(id: string, run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T): Promise<T> {
    await this.assertDatabase(id);
    return this.withLock(id, this.folder(id), async assertLocked => {
      await this.assertDatabase(id);
      const repository = new SqliteArtifactRepository(this.file(id), true);
      try {
        repository.database.exec('BEGIN IMMEDIATE');
        const state = this.normalize(repository.readState<Content, Anchor, Source>(), id);
        for (const saved of state.history) freezeArtifactValue(saved);
        const result = structuredClone(await run(state)); assertLocked();
        repository.writeState(state); assertLocked(); repository.database.exec('COMMIT');
        return result;
      } catch (error) { try { repository.database.exec('ROLLBACK'); } catch { /* Preserve the original failed commit. */ } throw error; }
      finally { repository.close(); }
    });
  }
  /** Serialize an external room commit with artifact permissions without rewriting unchanged content. */
  async withSnapshotLock<T>(id: string, run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T): Promise<T> {
    return this.withLock(id, this.folder(id), async assertLocked => {
      const state = await this.read(id); assertLocked();
      const result = await run(state); assertLocked(); return result;
    });
  }
  /** Hold the ordinary artifact lock while authorizing an external commit from a small fresh projection. */
  async withProjectionLock<R, T>(id: string, pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => R, run: (projection: R) => Promise<T> | T): Promise<T> {
    return this.withLock(id, this.folder(id), async assertLocked => {
      const projection = await this.readProjection(id, pick); assertLocked();
      const result = await run(projection); assertLocked(); return result;
    });
  }
  /** Delete only a trashed artifact while retaining the same lock used by restore/save. */
  async purge(id: string, beforeDelete: () => Promise<void>): Promise<void> {

    const folder = this.folder(id);
    let canonical: string;
    try {
      canonical = await realpath(folder);
      if (!samePath(canonical, join(await realpath(this.root), 'artifacts', safeId(id)))) throw resourceScope();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioError('NOT_FOUND', '作品不存在。');
      throw error;
    }
    await this.withLock(id, canonical, async assertLocked => {
      const legacy = await readLegacyArtifact(this.root, id);
      const artifact = legacy ?? await this.readProjection(id, state => state.artifact);
      if (!artifact.trashedAt) throw new StudioError('NOT_TRASHED', '仅能永久删除回收站中的作品，请先移入回收站。');
      const entries = (await readdir(canonical)).filter(entry => entry !== 'write.lock');
      for (const entry of entries) await validateDeletionTree(join(canonical, entry));
      assertLocked(); await beforeDelete();
      const metadataFile = legacy ? 'artifact.json' : 'artifact.sqlite';
      // Keep the owning metadata until owned resources are removed, so failures remain retryable.
      for (const entry of entries.filter(entry => entry !== metadataFile && !(legacy && entry === 'unsupported-trash.json'))) { assertLocked(); await rm(join(canonical, entry), { recursive: true, force: true }); }
      assertLocked(); await rm(join(canonical, metadataFile), { force: true });
      if (legacy) { assertLocked(); await rm(join(canonical, 'unsupported-trash.json'), { force: true }); }
    });

    // Another waiting transaction may have acquired write.lock; never recursively remove it.
    try { await rmdir(canonical); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  private async withLock<T>(id: string, folder: string, run: (assertLocked: () => void) => Promise<T>): Promise<T> {
    let lost: Error | undefined, release: (() => Promise<void>) | undefined;
    try {
      release = await lock(join(folder, 'write'), { realpath: false, stale: 30_000, update: 5000, retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 }, onCompromised: error => { lost = error; } });
    } catch (error) {

      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new StudioError('BUSY', '另一个进程正在保存作品，请稍后重试。');
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioError('NOT_FOUND', '作品不存在。');
      throw error;
    }
    const assertLocked = () => { if (lost) throw new StudioError('LOCK_LOST', '作品写锁已失效，修改未被提交。'); };
    try { return await run(assertLocked); }
    catch (error) {  throw error; }
    finally {
      try { if (!lost) await release(); }
      catch (error) {  throw error; }
    }
  }
}
