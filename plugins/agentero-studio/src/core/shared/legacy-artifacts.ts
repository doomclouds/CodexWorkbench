import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { atomicWrite, object, safeId, StudioError } from './common.js';
import type { ArtifactMetadata } from './model.js';

const LEGACY_HEADER_BYTES = 128 * 1024;
const TRASH_MARKER = 'unsupported-trash.json';
const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const timestamp = (value: unknown, fallback: string) => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)) ? value : fallback;

async function readTrashMarker(folder: string): Promise<{ trashedAt: string; artifact?: Record<string, unknown> } | undefined> {
  let marker;
  try { marker = await open(join(folder, TRASH_MARKER), 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  try {
    const info = await marker.stat();
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid legacy trash marker');
    const value: unknown = JSON.parse(await marker.readFile('utf8'));
    if (!object(value) || value.storageStatus !== 'unsupported' || typeof value.trashedAt !== 'string' || !timestamp(value.trashedAt, '')) throw new Error('Invalid legacy trash marker');
    return { trashedAt: value.trashedAt, ...(object(value.artifact) ? { artifact: value.artifact } : {}) };
  } catch { throw new StudioError('CORRUPT_ARTIFACT', '旧版作品的回收站记录无法读取，请保留原目录。'); }
  finally { await marker.close(); }
}

/** Read only the legacy envelope header. No legacy content is imported or normalized. */
function metadataHeader(header: string): Record<string, unknown> | undefined {
  const match = /"artifact"\s*:\s*\{/.exec(header);
  if (!match) return;
  const start = match.index + match[0].lastIndexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < header.length; index++) {
    const character = header[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      try { const value: unknown = JSON.parse(header.slice(start, index + 1)); return object(value) ? value : undefined; }
      catch { return; }
    }
  }
}

export async function readLegacyArtifact(root: string, id: string): Promise<ArtifactMetadata | undefined> {
  const folder = join(root, 'artifacts', safeId(id));
  try { await lstat(join(folder, 'artifact.sqlite')); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const marker = await readTrashMarker(folder);
  let info;
  try { info = await lstat(join(folder, 'artifact.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (!marker) return; }
  let parsed: Record<string, unknown> | undefined;
  if (info?.isFile() && !info.isSymbolicLink()) {
    const handle = await open(join(folder, 'artifact.json'), 'r');
    try { const buffer = Buffer.alloc(Math.min(LEGACY_HEADER_BYTES, info.size)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); parsed = metadataHeader(buffer.subarray(0, bytesRead).toString('utf8')); }
    finally { await handle.close(); }
  }
  const source = parsed?.id === id ? parsed : marker?.artifact?.id === id ? marker.artifact : undefined;
  const fallbackTime = info?.mtime.toISOString() ?? marker!.trashedAt;
  const artifact: ArtifactMetadata = {
    id, type: typeof source?.type === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(source.type) ? source.type : 'whiteboard',
    title: typeof source?.title === 'string' && source.title.trim() ? source.title.slice(0, 200) : '旧版作品',
    revision: Number.isSafeInteger(source?.revision) && Number(source?.revision) >= 0 ? Number(source?.revision) : 0,
    createdAt: timestamp(source?.createdAt, fallbackTime),
    updatedAt: timestamp(source?.updatedAt, fallbackTime),
    pinned: false, sharing: false, storageStatus: 'unsupported',
    ...(marker ? { trashedAt: marker.trashedAt } : typeof source?.trashedAt === 'string' && timestamp(source.trashedAt, '') ? { trashedAt: source.trashedAt } : {}),
  };
  return artifact;
}

export async function listLegacyArtifacts(root: string): Promise<ArtifactMetadata[]> {
  let entries;
  try { entries = await readdir(join(root, 'artifacts'), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const artifacts: ArtifactMetadata[] = [];
  for (const entry of entries) if (entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(entry.name)) {
    const artifact = await readLegacyArtifact(root, entry.name);
    if (artifact) artifacts.push(artifact);
  }
  return artifacts;
}

export async function trashLegacyArtifact(root: string, id: string, expectedRevision?: unknown): Promise<ArtifactMetadata> {
  const folder = join(root, 'artifacts', safeId(id));
  const canonical = await realpath(folder);
  if (!samePath(canonical, join(await realpath(root), 'artifacts', id))) throw new StudioError('RESOURCE_SCOPE', '旧版作品必须位于当前作品目录内。');
  let lost = false;
  const release = await lock(join(folder, 'write'), { realpath: false, stale: 30_000, update: 5000, retries: { retries: 100, minTimeout: 10, maxTimeout: 50, factor: 1 }, onCompromised: () => { lost = true; } });
  try {
    const artifact = await readLegacyArtifact(root, id);
    if (!artifact) throw new StudioError('NOT_FOUND', '旧版作品不存在。');
    if (expectedRevision !== undefined && expectedRevision !== artifact.revision) throw new StudioError('CONFLICT', '作品记录已变化，请刷新后重试。');
    if (artifact.trashedAt) return artifact;
    if (lost) throw new StudioError('LOCK_LOST', '作品写锁已失效，回收操作未提交。');
    const trashedAt = new Date().toISOString();
    await atomicWrite(join(folder, TRASH_MARKER), JSON.stringify({ storageStatus: 'unsupported', trashedAt, artifact }));
    return { ...artifact, trashedAt };
  } finally { if (!lost) await release(); }
}
