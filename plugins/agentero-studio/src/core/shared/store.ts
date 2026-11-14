import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { lock } from 'proper-lockfile';
import { atomicWrite, object, safeId, StudioError } from './common.js';
import type { ArtifactState } from './model.js';

const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const resourceScope = () => new StudioError('RESOURCE_SCOPE', '删除路径必须位于当前作品的真实目录中，不能通过符号链接访问其他位置。');
const CACHE_ENTRIES = 4, CACHE_BYTES = 64 * 1024 * 1024;
const signature = (info: BigIntStats) => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
function freezeState<T>(value: T): T {
  const pending: object[] = [value as object], seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    Object.freeze(current);
    for (const child of Object.values(current)) if (child && typeof child === 'object') pending.push(child);
  }
  return value;
}

async function validateDeletionTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !samePath(await realpath(path), path)) throw resourceScope();
  if (info.isDirectory()) for (const entry of await readdir(path)) await validateDeletionTree(join(path, entry));
  else if (!info.isFile()) throw resourceScope();
}

/** One canonical artifact envelope and one process-shared lock, for all products. */
export class ArtifactStore<Content, Anchor = unknown, Source = unknown> {
  readonly root: string;
  private readonly parsed = new Map<string, { signature: string; bytes: number; state: ArtifactState<Content, Anchor, Source> }>();
  private parsedBytes = 0;
  constructor(root?: string, private readonly decode?: (value: unknown) => ArtifactState<Content, Anchor, Source>, private readonly validateState?: (state: ArtifactState<Content, Anchor, Source>) => void) {
    this.root = resolve(root ?? join(homedir(), '.codexworkbench', 'agentero-studio'));
  }
  folder(id: string) { return join(this.root, 'artifacts', safeId(id)); }
  file(id: string) { return join(this.folder(id), 'artifact.json'); }
  async read(id: string): Promise<ArtifactState<Content, Anchor, Source>> {
    return this.readProjection(id, state => state);
  }
  /** Select synchronously from private frozen state; callers only receive an isolated copy. */
  async readProjection<R>(id: string, pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => R): Promise<R> {
    try {
      return structuredClone(pick(await this.normalizedState(id)));
    } catch (error) { this.evict(id); throw error; }
  }
  private evict(id: string): void {
    const cached = this.parsed.get(id);
    if (cached) { this.parsedBytes -= cached.bytes; this.parsed.delete(id); }
  }
  private async normalizedState(id: string): Promise<ArtifactState<Content, Anchor, Source>> {
    try {
      const file = this.file(id), before = await stat(file, { bigint: true }), key = signature(before), cached = this.parsed.get(id);
      if (cached?.signature === key) { this.parsed.delete(id); this.parsed.set(id, cached); return cached.state; }
      this.evict(id);
      const raw = await readFile(file, 'utf8');
      let state: ArtifactState<Content, Anchor, Source>;
      try {
        const parsed: unknown = JSON.parse(raw); state = this.decode ? this.decode(parsed) : parsed as ArtifactState<Content, Anchor, Source>;
        if (!object(state) || state.schemaVersion !== 2 || state.artifact?.id !== id || typeof state.artifact.type !== 'string' || !('content' in state) || !Array.isArray(state.history) || !Array.isArray(state.feedback) || !Array.isArray(state.operations) || !object(state.sharing) || !object(state.sources) || !object(state.assets)) throw new Error('invalid artifact');
        // Migration/validation may normalize data; finish it before publishing frozen cache state.
        this.validateState?.(state);
      } catch { throw new StudioError('CORRUPT_ARTIFACT', '作品文件无法读取，请保留原文件并从备份恢复。'); }
      const after = await stat(file, { bigint: true }), bytes = Buffer.byteLength(raw);
      freezeState(state);
      if (key === signature(after) && bytes <= CACHE_BYTES) {
        this.evict(id); this.parsed.set(id, { signature: key, bytes, state }); this.parsedBytes += bytes;
        while (this.parsed.size > CACHE_ENTRIES || this.parsedBytes > CACHE_BYTES) this.evict(this.parsed.keys().next().value!);
      }
      return state;
    } catch (error) {
      this.evict(id);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioError('NOT_FOUND', '作品不存在。');
      throw error;
    }
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
  async write(state: ArtifactState<Content, Anchor, Source>): Promise<void> {
    try { await atomicWrite(this.file(state.artifact.id), JSON.stringify(state)); }
    finally { this.evict(state.artifact.id); }
  }
  async transaction<T>(id: string, run: (state: ArtifactState<Content, Anchor, Source>) => Promise<T> | T): Promise<T> {
    const folder = this.folder(id);
    try { await mkdir(folder, { recursive: true }); }
    catch (error) { this.evict(id); throw error; }
    return this.withLock(id, folder, async assertLocked => {
      const state = await this.read(id), result = await run(state);
      assertLocked(); await this.write(state); return result;
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
    this.evict(id);
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
      const state = await this.read(id);
      if (!state.artifact.trashedAt) throw new StudioError('NOT_TRASHED', '仅能永久删除回收站中的作品，请先移入回收站。');
      const entries = (await readdir(canonical)).filter(entry => entry !== 'write.lock');
      for (const entry of entries) await validateDeletionTree(join(canonical, entry));
      assertLocked(); await beforeDelete();
      // Keep artifact.json until all owned resources have been removed, so failures remain retryable.
      for (const entry of entries.filter(entry => entry !== 'artifact.json')) { assertLocked(); await rm(join(canonical, entry), { recursive: true, force: true }); }
      assertLocked(); await rm(join(canonical, 'artifact.json'));
    });
    this.evict(id);
    // Another waiting transaction may have acquired write.lock; never recursively remove it.
    try { await rmdir(canonical); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  private async withLock<T>(id: string, folder: string, run: (assertLocked: () => void) => Promise<T>): Promise<T> {
    let lost: Error | undefined, release: (() => Promise<void>) | undefined;
    try {
      release = await lock(join(folder, 'write'), { realpath: false, stale: 30_000, update: 5000, retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 }, onCompromised: error => { lost = error; } });
    } catch (error) {
      this.evict(id);
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new StudioError('BUSY', '另一个进程正在保存作品，请稍后重试。');
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioError('NOT_FOUND', '作品不存在。');
      throw error;
    }
    const assertLocked = () => { if (lost) throw new StudioError('LOCK_LOST', '作品写锁已失效，修改未被提交。'); };
    try { return await run(assertLocked); }
    catch (error) { this.evict(id); throw error; }
    finally {
      try { if (!lost) await release(); }
      catch (error) { this.evict(id); throw error; }
    }
  }
}
