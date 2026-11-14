import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import type { Actor } from '../../contracts/studio.js';
import type { ExportResources } from './products.js';
import { assertAlive, atomicWrite, requireRole, safeId, StudioError, text } from './common.js';
import type { ArtifactState, AssetRecord } from './model.js';
import type { ArtifactStore } from './store.js';

export interface ExportRecord { exportId: string; artifactId: string; filename: string; mimeType: string; size: number; downloadPath: string }
export interface ExportBytes { filename: string; mimeType: string; data: string; encoding?: 'base64' | 'utf8' }
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const assetReference = (artifactId: string, asset: AssetRecord) => ({ ...asset, url: `/assets/${artifactId}/${asset.id}`, src: `/assets/${artifactId}/${asset.id}` });
const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const resourceScope = () => new StudioError('RESOURCE_SCOPE', '资源路径必须位于当前作品的真实目录中，不能通过符号链接访问其他位置。');

/** A configured root may itself be an alias; artifact/asset directories must stay inside it. */
async function assetDirectory<C, A, S>(store: ArtifactStore<C, A, S>, artifactId: string, directory: 'assets' | 'recycle-assets', create = false) {
  const root = await realpath(store.root), folder = await realpath(store.folder(artifactId));
  if (!samePath(folder, join(root, 'artifacts', safeId(artifactId)))) throw resourceScope();
  const path = join(folder, directory);
  if (create) await mkdir(path, { recursive: true });
  if (!samePath(await realpath(path), path)) throw resourceScope();
  return path;
}
async function regularFile(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || !samePath(await realpath(path), path)) throw resourceScope();
  return info;
}
async function readBoundedAsset(path: string): Promise<Buffer> {
  const before = await regularFile(path), file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) throw resourceScope();
    if (info.size > MAX_ASSET_BYTES) throw new StudioError('TOO_LARGE', '资源应小于 20 MB。');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_ASSET_BYTES + 1 - size)), { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_ASSET_BYTES) throw new StudioError('TOO_LARGE', '资源应小于 20 MB。');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (!size) throw new StudioError('INVALID_ARGUMENT', '资源文件不能为空。');
    return Buffer.concat(chunks, size);
  } finally { await file.close(); }
}
const EXTENSION_MIMES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html', '.htm': 'text/html' };
const MEDIA_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/quicktime', 'video/webm']);
function assetMimeType(data: Buffer, filename: string): string {
  let detected: string | undefined;
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) detected = 'image/png';
  else if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) detected = 'image/jpeg';
  else if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'))) detected = 'image/gif';
  else if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') detected = 'image/webp';
  else if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') {
    const brand = data.toString('ascii', 8, 12);
    if (brand === 'qt  ') detected = 'video/quicktime';
    else if (/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV|3gp[4-9])$/.test(brand)) detected = 'video/mp4';
  } else if (data.length >= 8 && ['moov', 'mdat', 'wide'].includes(data.toString('ascii', 4, 8)) && data.readUInt32BE(0) >= 8) detected = 'video/quicktime';
  else if (data.length >= 4 && data.readUInt32BE(0) === 0x1a45dfa3 && data.subarray(0, 4096).includes(Buffer.from('webm'))) detected = 'video/webm';
  else if (/^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(data.subarray(0, 64 * 1024).toString('utf8'))) detected = 'image/svg+xml';
  const fallback = EXTENSION_MIMES[extname(filename).toLowerCase()] ?? 'application/octet-stream';
  if (!detected && MEDIA_MIMES.has(fallback)) throw new StudioError('INVALID_ARGUMENT', '文件内容与图片或视频格式不符，请提供实际媒体文件。');
  return detected ?? fallback;
}
/** Only the caller-supplied canonical absolute filename is read; it is never persisted. */
export async function importAsset<C, A, S>(store: ArtifactStore<C, A, S>, artifactId: string, assetPath: unknown, actor: Actor, validateMimeType: (mimeType: string) => void) {
  requireRole(actor, ['owner']);
  const path = text(assetPath, '', 4096);
  if (!path || !isAbsolute(path)) throw new StudioError('INVALID_ARGUMENT', '请提供明确的资源文件绝对路径。');
  const canonical = await realpath(path);
  if (!samePath(canonical, resolve(path))) throw new StudioError('RESOURCE_SCOPE', '请提供资源文件的真实绝对路径，不能通过符号链接导入。');
  const data = await readBoundedAsset(canonical), filename = basename(canonical), mimeType = assetMimeType(data, filename);
  return putAsset(store, artifactId, data, { filename, mimeType }, actor, validateMimeType);
}
export function listAssets<C, A, S>(state: ArtifactState<C, A, S>, args: Record<string, unknown>, actor: Actor) {
  requireRole(actor, ['owner']);
  const offset = args.offset ?? 0, limit = args.limit ?? 50;
  if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new StudioError('INVALID_ARGUMENT', '资源分页须使用非负 offset 与 1 到 100 的 limit。');
  const assets = Object.values(state.assets), end = (offset as number) + (limit as number);
  return { assets: assets.slice(offset as number, end).map(asset => assetReference(state.artifact.id, asset)), offset, limit, total: assets.length, ...(end < assets.length ? { nextOffset: end } : {}) };
}
function referencesAsset(value: unknown, id: string): boolean {
  if (typeof value === 'string') return value.includes(id);
  if (value !== null && typeof value === 'object') return Object.values(value).some(item => referencesAsset(item, id));
  return false;
}
export async function deleteAsset<C, A, S>(store: ArtifactStore<C, A, S>, artifactId: string, assetId: unknown, actor: Actor) {
  requireRole(actor, ['owner']); const id = safeId(assetId, '资源 ID'); let moved: { active: string; recycled: string } | undefined;
  try {
    await store.transaction(artifactId, async state => {
      assertAlive(state.artifact);
      if (!Object.hasOwn(state.assets, id)) throw new StudioError('NOT_FOUND', '资源不存在。');
      // Include retained versions and private proposals even when they are absent from public reads.
      if (referencesAsset([state.content, state.history, state.sources, state.feedback], id)) throw new StudioError('REFERENCE_IN_USE', '当前内容、保留历史或反馈仍引用此资源，请保留资源以便恢复。');
      const active = join(await assetDirectory(store, artifactId, 'assets'), id), recycled = join(await assetDirectory(store, artifactId, 'recycle-assets', true), id);
      let activeExists = true;
      try { await regularFile(active); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; activeExists = false; }
      if (activeExists) {
        try { await lstat(recycled); throw new StudioError('RESOURCE_STATE', '资源已有内部回收副本，请保留文件并检查作品数据。'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await rename(active, recycled); moved = { active, recycled };
      } else await regularFile(recycled); // Recover a deletion interrupted before metadata commit.
      delete state.assets[id];
    });
  } catch (error) {
    if (moved) {
      // A failed metadata commit keeps its bytes; getAsset also reads this recovery location.
      try { await assetDirectory(store, artifactId, 'assets'); await assetDirectory(store, artifactId, 'recycle-assets'); await regularFile(moved.recycled); await rename(moved.recycled, moved.active); } catch { /* Keep the internal recovery copy. */ }
    }
    throw error;
  }
  return { assetId: id, removed: true as const };
}
export async function duplicateAssets<C, A, S>(store: ArtifactStore<C, A, S>, from: string, to: string): Promise<void> {
  await cp(join(store.folder(from), 'assets'), join(store.folder(to), 'assets'), { recursive: true }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
}
export async function putAsset<C, A, S>(store: ArtifactStore<C, A, S>, artifactId: string, data: Uint8Array, input: { filename?: string; mimeType?: string }, actor: Actor, validateMimeType: (mimeType: string) => void) {
  requireRole(actor, ['owner', 'editor']);
  if (!data.byteLength || data.byteLength > MAX_ASSET_BYTES) throw new StudioError('TOO_LARGE', '资源应小于 20 MB。');
  const mimeType = text(input.mimeType, 'application/octet-stream', 100).split(';')[0]!; validateMimeType(mimeType);
  const id = randomUUID(), filename = basename(text(input.filename, 'resource', 250)).replace(/[\x00-\x1f]/g, '');
  await store.transaction(artifactId, async state => { assertAlive(state.artifact); await atomicWrite(join(await assetDirectory(store, artifactId, 'assets', true), id), data); state.assets[id] = { id, filename, mimeType, size: data.byteLength }; });
  return { id, url: `/assets/${artifactId}/${id}`, src: `/assets/${artifactId}/${id}`, filename, mimeType, size: data.byteLength };
}
export async function getAsset<C, A, S>(store: ArtifactStore<C, A, S>, artifactId: string, assetId: string): Promise<AssetRecord & { data: Uint8Array }> {
  safeId(assetId, '资源 ID'); const state = await store.read(artifactId), asset = Object.hasOwn(state.assets, assetId) ? state.assets[assetId] : undefined;
  if (!asset) throw new StudioError('NOT_FOUND', '资源不存在。');
  let data: Uint8Array;
  try { data = await readBoundedAsset(join(await assetDirectory(store, artifactId, 'assets'), assetId)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; data = await readBoundedAsset(join(await assetDirectory(store, artifactId, 'recycle-assets'), assetId)); }
  return { ...asset, data };
}
export function exportResources<C, A, S>(store: ArtifactStore<C, A, S>, artifactId: string): ExportResources {
  return { assetDataUri: async reference => {
    const match = /^\/assets\/([^/]+)\/([^/?#]+)/.exec(reference); if (!match) return reference;
    if (match[1] !== artifactId) throw new StudioError('RESOURCE_SCOPE', '不能读取其他作品的资源。');
    const asset = await getAsset(store, artifactId, match[2]); return `data:${asset.mimeType};base64,${Buffer.from(asset.data).toString('base64')}`;
  } };
}
export async function saveExport(root: string, artifactId: string, result: ExportBytes): Promise<ExportRecord> {
  const exportId = randomUUID(), data = Buffer.from(result.data, result.encoding === 'base64' ? 'base64' : 'utf8');
  const record: ExportRecord = { exportId, artifactId, filename: basename(result.filename), mimeType: result.mimeType, size: data.length, downloadPath: `/api/exports/${exportId}?artifactId=${encodeURIComponent(artifactId)}` };
  await atomicWrite(join(root, 'exports', exportId), data); await atomicWrite(join(root, 'exports', `${exportId}.json`), JSON.stringify(record)); return record;
}
export async function getExport(root: string, exportId: string): Promise<ExportRecord & { data: Uint8Array }> {
  safeId(exportId, '导出 ID');
  try { const record = JSON.parse(await readFile(join(root, 'exports', `${exportId}.json`), 'utf8')) as ExportRecord; return { ...record, data: await readFile(join(root, 'exports', exportId)) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioError('NOT_FOUND', '导出文件不存在。'); throw error; }
}
