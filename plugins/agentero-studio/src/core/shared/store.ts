import { mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { lock } from 'proper-lockfile';
import { atomicWrite, object, safeId, StudioError } from './common.js';
import type { ArtifactState } from './model.js';

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
    let lost: Error | undefined, release: (() => Promise<void>) | undefined;
    try {
      release = await lock(join(folder, 'write'), { realpath: false, stale: 30_000, update: 5000, retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 }, onCompromised: error => { lost = error; } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new StudioError('BUSY', '另一个进程正在保存作品，请稍后重试。');
      throw error;
    }
    try {
      const state = await this.read(id), result = await run(state);
      if (lost) throw new StudioError('LOCK_LOST', '作品写锁已失效，修改未被提交。');
      await this.write(state); return result;
    } finally { if (!lost) await release(); }
  }
}
