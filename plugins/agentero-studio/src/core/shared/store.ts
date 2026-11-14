import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { lock } from 'proper-lockfile';
import { atomicWrite, object, safeId, StudioError } from './common.js';
import type { ArtifactState } from './model.js';

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
  file(id: string) { return join(this.folder(id), 'artifact.json'); }
  async read(id: string): Promise<ArtifactState<Content, Anchor, Source>> {
    let raw: string;
    try { raw = await readFile(this.file(id), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioError('NOT_FOUND', '作品不存在。'); throw error; }
    try {
      const parsed: unknown = JSON.parse(raw), state = this.decode ? this.decode(parsed) : parsed as ArtifactState<Content, Anchor, Source>;
      if (!object(state) || state.schemaVersion !== 2 || state.artifact?.id !== id || typeof state.artifact.type !== 'string' || !('content' in state) || !Array.isArray(state.history) || !Array.isArray(state.feedback) || !Array.isArray(state.operations) || !object(state.sharing) || !object(state.sources) || !object(state.assets)) throw new Error('invalid artifact');
      this.validateState?.(state); return state;
    } catch { throw new StudioError('CORRUPT_ARTIFACT', '作品文件无法读取，请保留原文件并从备份恢复。'); }
  }
  async list(): Promise<ArtifactState<Content, Anchor, Source>[]> {
    let entries;
    try { entries = await readdir(join(this.root, 'artifacts'), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const values: ArtifactState<Content, Anchor, Source>[] = [];
    for (const entry of entries) if (entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(entry.name)) {
      try { values.push(await this.read(entry.name)); }
      catch (error) { if (!(error instanceof StudioError) || !['NOT_FOUND', 'CORRUPT_ARTIFACT'].includes(error.code)) throw error; }
    }
    return values;
  }
  async write(state: ArtifactState<Content, Anchor, Source>): Promise<void> { await atomicWrite(this.file(state.artifact.id), JSON.stringify(state)); }
  async transaction<T>(id: string, run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T): Promise<T> {
    const folder = this.folder(id); await mkdir(folder, { recursive: true });
    return this.withLock(folder, async assertLocked => {
      const state = await this.read(id), result = await run(state);
      assertLocked(); await this.write(state); return result;
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
    await this.withLock(canonical, async assertLocked => {
      const state = await this.read(id);
      if (!state.artifact.trashedAt) throw new StudioError('NOT_TRASHED', '仅能永久删除回收站中的作品，请先移入回收站。');
      const entries = (await readdir(canonical)).filter(entry => entry !== 'write.lock');
      for (const entry of entries) await validateDeletionTree(join(canonical, entry));
      assertLocked(); await beforeDelete();
      // Keep artifact.json until all owned resources have been removed, so failures remain retryable.
      for (const entry of entries.filter(entry => entry !== 'artifact.json')) { assertLocked(); await rm(join(canonical, entry), { recursive: true, force: true }); }
      assertLocked(); await rm(join(canonical, 'artifact.json'));
    });
    // Another waiting transaction may have acquired write.lock; never recursively remove it.
    try { await rmdir(canonical); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  private async withLock<T>(folder: string, run: (assertLocked: () => void) => Promise<T>): Promise<T> {
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
    finally { if (!lost) await release(); }
  }
}
