import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReadingContextSummary } from '../contracts/context.js';
import { LibraryError } from '../contracts/errors.js';
import { atomicJson, containedPath } from './files.js';

export interface ReadingSnapshot extends ReadingContextSummary {
  schemaVersion: 1; vaultPath: string; marksRevision?: string; content: string;
  images: Record<string, { mediaType: 'image/png'; data: string }>;
}
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const CONTEXT_MAX_BYTES = 8 * 1024 * 1024;
export const CONTEXT_CACHE_BYTES = 64 * 1024 * 1024;
export const CONTEXT_MAX_COUNT = 200;
export const CONTEXT_TTL = 7 * 24 * 60 * 60 * 1000;
const serializedBytes = (value: unknown) => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
export function checkContextCancellation(signal?: AbortSignal) { if (signal?.aborted) throw new LibraryError('OPERATION_CANCELLED', '附加阅读来源已取消。'); }

/** Validate actual PNG bytes, chunk boundaries/CRCs and bounded image dimensions. */
export function validateContextPng(asset: { mediaType: string; data: string }): { mediaType: 'image/png'; data: string } {
  if (asset.mediaType !== 'image/png' || typeof asset.data !== 'string' || !asset.data || asset.data.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(asset.data)) throw new LibraryError('INVALID_ASSET', '阅读来源截图必须是 4.5 MB 以内的 PNG。');
  const bytes = Buffer.from(asset.data, 'base64');
  if (bytes.length > 4_500_000 || bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new LibraryError('INVALID_ASSET', '阅读来源截图不是有效 PNG。');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 16_000_000) throw new LibraryError('INVALID_ASSET', '阅读来源截图不能超过 1600 万像素。');
  let offset = 8, first = true, pixels = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) throw new LibraryError('INVALID_ASSET', 'PNG 数据块不完整。');
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (first && (kind !== 'IHDR' || length !== 13) || !first && kind === 'IHDR') throw new LibraryError('INVALID_ASSET', 'PNG 图像头无效。');
    if (first) {
      const bitDepth = bytes[offset + 16], colorType = bytes[offset + 17];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colorType]?.includes(bitDepth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw new LibraryError('INVALID_ASSET', 'PNG 图像头参数无效。');
    }
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end - 4; index += 1) {
      crc ^= bytes[index];
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) throw new LibraryError('INVALID_ASSET', 'PNG 校验失败。');
    if (kind === 'IDAT') pixels = true;
    if (kind === 'IEND') { ended = length === 0 && end === bytes.length; break; }
    offset = end; first = false;
  }
  if (!pixels || !ended) throw new LibraryError('INVALID_ASSET', 'PNG 缺少像素数据或结束块。');
  return { mediaType: 'image/png', data: bytes.toString('base64') };
}

/** Frozen source evidence is independent of the current Reader and MCP process. */
export class ReadingContextStore {
  private readonly root: string;
  constructor(private readonly dataRoot: string) { this.root = join(dataRoot, 'cache', 'reading-context'); }

  private async safeRoot(create = false) {
    if (create) await mkdir(this.dataRoot, { recursive: true });
    for (const relative of ['cache', 'cache/reading-context']) {
      const path = await containedPath(this.dataRoot, relative, create);
      if (create) await mkdir(path, { recursive: true });
      if ((await lstat(join(this.dataRoot, relative))).isSymbolicLink()) throw new LibraryError('INVALID_PATH', '阅读来源缓存不能使用符号链接。');
    }
  }

  private async path(contextId: string, missing = false) {
    const path = await containedPath(this.root, `${contextId}.json`, missing);
    try { if ((await lstat(join(this.root, `${contextId}.json`))).isSymbolicLink()) throw new LibraryError('INVALID_PATH', '阅读来源缓存不能使用符号链接。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !missing) throw error; }
    return path;
  }

  async create(input: Omit<ReadingSnapshot, 'contextId' | 'createdAt' | 'expiresAt' | 'schemaVersion'>, signal?: AbortSignal): Promise<ReadingSnapshot> {
    checkContextCancellation(signal);
    const contextId = randomUUID(), createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + CONTEXT_TTL).toISOString();
    const snapshot: ReadingSnapshot = { ...input, schemaVersion: 1, contextId, createdAt, expiresAt };
    const newBytes = serializedBytes(snapshot);
    if (newBytes > CONTEXT_MAX_BYTES) throw new LibraryError('CONTEXT_TOO_LARGE', '所选来源超过 8 MiB，请减少页数、批注或截图后再附加。');
    await this.safeRoot(true);
    // Multiple MCP processes share these cache quotas. A short exclusive lock
    // only covers the bounded scan and atomic write, never the Reader work.
    await containedPath(this.root, '.create.lock', true);
    const lockPath = join(this.root, '.create.lock'), deadline = Date.now() + 3000;
    let lock: Awaited<ReturnType<typeof open>>;
    while (true) {
      checkContextCancellation(signal);
      try { lock = await open(lockPath, 'wx', 0o600); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let info;
        try { info = await lstat(lockPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (info.isSymbolicLink()) throw new LibraryError('INVALID_PATH', '阅读来源缓存锁不能使用符号链接。');
        if (Date.now() - info.mtimeMs > 30_000) { await unlink(lockPath); continue; }
        if (Date.now() >= deadline) throw new LibraryError('CONTEXT_BUSY', '其他实例正在附加阅读来源，请稍后重试。', true);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try {
      const names = (await readdir(this.root)).filter(name => name.endsWith('.json') && validId.test(name.slice(0, -5)));
      if (names.length > 1000) throw new LibraryError('CONTEXT_CACHE_FULL', '阅读来源缓存文件过多，请稍后再附加。');
      let bytes = newBytes, count = 1;
      for (const name of names) {
        checkContextCancellation(signal);
        const path = await this.path(name.slice(0, -5)), info = await stat(path);
        // Only this cache's expired UUID entries are eligible for eviction.
        if (Date.now() - info.mtimeMs > CONTEXT_TTL) { await unlink(path); continue; }
        count += 1; bytes += info.size;
      }
      if (count > CONTEXT_MAX_COUNT || bytes > CONTEXT_CACHE_BYTES) throw new LibraryError('CONTEXT_CACHE_FULL', '阅读来源缓存已达上限，请稍后再附加，已有来源不会被覆盖。');
      checkContextCancellation(signal);
      await atomicJson(await this.path(contextId, true), snapshot);
      return snapshot;
    } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
  }

  async read(contextId: string, signal?: AbortSignal): Promise<ReadingSnapshot> {
    checkContextCancellation(signal);
    if (!validId.test(contextId)) throw new LibraryError('CONTEXT_NOT_FOUND', '阅读来源引用无效。');
    let snapshot: ReadingSnapshot;
    try {
      await this.safeRoot();
      const path = await this.path(contextId);
      if ((await stat(path)).size > CONTEXT_MAX_BYTES) throw new LibraryError('CONTEXT_TOO_LARGE', '阅读来源缓存超过大小上限。');
      try { snapshot = JSON.parse(await readFile(path, 'utf8')) as ReadingSnapshot; } catch { throw new LibraryError('CONTEXT_INVALID', '阅读来源缓存格式无效。'); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LibraryError('CONTEXT_NOT_FOUND', '该阅读来源已失效，请重新选择并附加。');
      throw error;
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new LibraryError('CONTEXT_INVALID', '阅读来源缓存格式无效。');
    const images = snapshot.images;
    if (snapshot.schemaVersion !== 1 || snapshot.contextId !== contextId || typeof snapshot.vaultId !== 'string' || typeof snapshot.vaultPath !== 'string' || typeof snapshot.paperId !== 'string' || typeof snapshot.paperPath !== 'string' || typeof snapshot.title !== 'string' || !Array.isArray(snapshot.pages) || !snapshot.pages.every(page => Number.isInteger(page) && page > 0) || !Number.isInteger(snapshot.marksCount) || snapshot.marksCount < 0 || !['summarize', 'create-note', 'update-note', 'revise-paper'].includes(snapshot.action) || typeof snapshot.content !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Number.isFinite(Date.parse(snapshot.expiresAt)) || !images || typeof images !== 'object' || Array.isArray(images) || !Array.isArray(snapshot.imageIds) || snapshot.imageIds.length !== Object.keys(images).length || snapshot.imageIds.some(id => typeof id !== 'string' || !/^image-\d+$/.test(id) || !Object.hasOwn(images, id) || !images[id] || images[id].mediaType !== 'image/png' || typeof images[id].data !== 'string')) throw new LibraryError('CONTEXT_INVALID', '阅读来源缓存格式无效。');
    if (Date.parse(snapshot.expiresAt) < Date.now()) throw new LibraryError('CONTEXT_EXPIRED', '该阅读来源已过期，请重新选择并附加。');
    checkContextCancellation(signal);
    return snapshot;
  }
}
