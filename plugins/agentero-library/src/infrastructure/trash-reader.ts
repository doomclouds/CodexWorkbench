import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { TrashDiagnostics, TrashEntry, TrashOpenInput } from '../contracts/trash.js';
import { LibraryError } from '../contracts/errors.js';
import { relativePath, within } from './files.js';

// Agentero v0.15.2: crates/agentero-core/src/features/vault/trash/mod.rs.
// This is a read-only format adapter. CLI/MCP expose deletion, not list/restore.
export const TRASH_REL = '.agentero/.trash';
export const TRASH_RESTORE_REASON = 'Agentero 0.15.2 的 CLI/MCP 未公开回收站恢复接口；当前插件只提供查看及显式打开，不提供恢复、清空或永久删除。';
const MAX_ROOT_ENTRIES = 1000;
const MAX_BATCHES = 200;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 200;
const MAX_ENTRIES = 1000;
const MAX_CATALOG_ROWS = 2000;
const MAX_ITEM_FILES = 256;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const batchName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const storedName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\\/:\0\x00-\x1f]/.test(value) && !value.includes('..') && value !== '.' && !/[. ]$/.test(value);
interface Budget { remaining: number }
interface Batch { batchId: string; deletedAt: string; items: unknown[] }
interface Item { originalPath: string; storedId: string; title: string; isPaper: boolean }
export interface TrashSnapshotData { items: TrashEntry[]; complete: boolean; diagnostics: TrashDiagnostics }

/** Reject every symlink/junction component, including aliases inside the Vault. */
async function safePath(vault: string, relative: string, allowMissing = false): Promise<string | undefined> {
  const root = await realpath(vault), rel = relativePath(relative);
  let path = root;
  for (const component of rel.split('/')) {
    path = join(path, component);
    let info;
    try { info = await lstat(path); } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (info.isSymbolicLink()) throw new LibraryError('INVALID_TRASH_PATH', '回收站路径不能通过符号链接或目录联接。');
    const actual = await realpath(path);
    if (!within(root, actual)) throw new LibraryError('INVALID_TRASH_PATH', '回收站路径超出当前文献库。');
    path = actual;
  }
  return path;
}

async function boundedDirectory(path: string, limit: number) {
  const handle = await opendir(path), entries = [];
  try {
    for (let index = 0; index < limit; index++) {
      const entry = await handle.read(); if (!entry) return { entries, truncated: false }; entries.push(entry);
    }
    return { entries, truncated: (await handle.read()) !== null };
  } finally { await handle.close(); }
}

async function readBatch(vault: string, batchId: string, budget: Budget): Promise<Batch> {
  if (!batchName(batchId)) throw new LibraryError('INVALID_TRASH_PATH', '回收站批次标识无效。');
  const path = await safePath(vault, `${TRASH_REL}/${batchId}/manifest.json`);
  const handle = await open(path!, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new LibraryError('TRASH_MANIFEST_LIMIT', '批次清单超过读取上限。');
    if (info.size > budget.remaining) throw new LibraryError('TRASH_SCAN_LIMIT', '本次回收站读取达到上限。');
    const buffer = Buffer.alloc(Math.min(MAX_MANIFEST_BYTES + 1, budget.remaining + 1)); let length = 0;
    for (;;) {
      const capacity = Math.min(buffer.length - length, budget.remaining);
      if (capacity <= 0) throw new LibraryError('TRASH_SCAN_LIMIT', '本次回收站读取达到上限。');
      const { bytesRead } = await handle.read(buffer, length, capacity, length);
      if (!bytesRead) break;
      budget.remaining -= bytesRead; length += bytesRead;
      if (length > MAX_MANIFEST_BYTES) throw new LibraryError('TRASH_MANIFEST_LIMIT', '批次清单超过读取上限。');
    }
    // Recheck its namespace after the bounded read; never return content from
    // a newly introduced symlink or a different batch directory.
    await safePath(vault, `${TRASH_REL}/${batchId}/manifest.json`);
    let data: Record<string, unknown>;
    try { data = record(JSON.parse(buffer.subarray(0, length).toString('utf8'))); }
    catch { throw new LibraryError('TRASH_MANIFEST_INVALID', '批次清单格式无效。'); }
    if (data.batchId !== batchId || typeof data.createdAt !== 'string' || data.createdAt.length > 128 || !Number.isFinite(Date.parse(data.createdAt)) || !Array.isArray(data.items) || data.items.length > MAX_ITEMS) throw new LibraryError('TRASH_MANIFEST_INVALID', '批次清单字段或条目数量无效。');
    return { batchId, deletedAt: data.createdAt, items: data.items };
  } finally { await handle.close(); }
}

function readItem(raw: unknown): Item {
  const data = record(raw);
  if (!storedName(data.stored) || typeof data.rel !== 'string' || data.rel.length > 4096 || /[\x00-\x1f:]/.test(data.rel)) throw new LibraryError('TRASH_ITEM_INVALID', '回收站条目路径无效。');
  const originalPath = relativePath(data.rel);
  if (originalPath === 'papers' || originalPath === '.agentero' || originalPath.startsWith('.agentero/')) throw new LibraryError('TRASH_ITEM_INVALID', '回收站条目指向受保护路径。');
  if (data.phase !== undefined && !['prepared', 'trashed', 'restoring'].includes(String(data.phase))) throw new LibraryError('TRASH_ITEM_INVALID', '回收站条目阶段未知。');
  const rows = data.catalogRows ?? [];
  if (!Array.isArray(rows) || rows.length > MAX_CATALOG_ROWS) throw new LibraryError('TRASH_ITEM_INVALID', '回收站条目快照数量无效。');
  const paper = rows.length === 1 ? record(rows[0]) : {};
  const title = typeof paper.title === 'string' && paper.title.trim() ? paper.title.trim().slice(0, 500) : basename(originalPath).slice(0, 500);
  return { originalPath, storedId: data.stored, title, isPaper: rows.length === 1 && originalPath.startsWith('papers/') };
}

async function itemLocation(vault: string, batchId: string, item: Item) {
  const relative = `${TRASH_REL}/${batchId}/${item.storedId}`, path = await safePath(vault, relative);
  const info = await stat(path!);
  if (!info.isFile() && !info.isDirectory()) throw new LibraryError('TRASH_ITEM_INVALID', '回收站条目不是普通文件或文件夹。');
  return { relative, path: path!, isDirectory: info.isDirectory() };
}

async function findPdf(vault: string, batchId: string, item: Item): Promise<string | undefined> {
  const location = await itemLocation(vault, batchId, item);
  if (!location.isDirectory) return extname(location.path).toLowerCase() === '.pdf' ? location.path : undefined;
  const { entries } = await boundedDirectory(location.path, MAX_ITEM_FILES);
  const preferred = `${basename(item.originalPath)}.pdf`;
  const names = entries.filter(entry => entry.isFile() && !entry.isSymbolicLink() && extname(entry.name).toLowerCase() === '.pdf').map(entry => entry.name).sort((a, b) => Number(b === preferred) - Number(a === preferred) || a.localeCompare(b));
  for (const name of names) {
    const path = await safePath(vault, `${location.relative}/${name}`);
    if ((await stat(path!)).isFile()) return path;
  }
  return undefined;
}

export async function scanTrash(vault: string): Promise<TrashSnapshotData> {
  const diagnostics: TrashDiagnostics = { skippedBatches: 0, skippedItems: 0, scannedBatches: 0, warnings: [] };
  const warn = (message: string) => { if (diagnostics.warnings.length < 20) diagnostics.warnings.push(message); };
  const trash = await safePath(vault, TRASH_REL, true);
  if (!trash) return { items: [], complete: true, diagnostics };
  if (!(await stat(trash)).isDirectory()) throw new LibraryError('INVALID_TRASH_PATH', '回收站位置不是文件夹。');
  const root = await boundedDirectory(trash, MAX_ROOT_ENTRIES), names: string[] = [];
  for (const entry of root.entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && batchName(entry.name)) names.push(entry.name);
    else { diagnostics.skippedBatches += 1; warn('已忽略不符合批次目录格式的回收站内容。'); }
  }
  const limited = root.truncated || names.length > MAX_BATCHES;
  let complete = !limited && diagnostics.skippedBatches === 0;
  if (limited) warn('回收站批次较多，本次列表达到扫描上限，可能还有未列出的内容。');
  const budget = { remaining: MAX_SCAN_BYTES }, items: TrashEntry[] = [];
  outer: for (const batchId of names.sort().reverse().slice(0, MAX_BATCHES)) {
    diagnostics.scannedBatches += 1;
    let batch: Batch;
    try { batch = await readBatch(vault, batchId, budget); }
    catch (error) {
      diagnostics.skippedBatches += 1;
      complete = false;
      warn(`已跳过无法安全读取的批次 ${batchId}。`);
      if (error instanceof LibraryError && error.code === 'TRASH_SCAN_LIMIT') { complete = false; warn('本次回收站清单读取达到字节上限，可能还有未列出的内容。'); break; }
      continue;
    }
    const seen = new Set<string>();
    for (const raw of batch.items) {
      try {
        const item = readItem(raw);
        if (seen.has(item.storedId)) throw new LibraryError('TRASH_ITEM_INVALID', '批次包含重复存储标识。');
        seen.add(item.storedId);
        const location = await itemLocation(vault, batchId, item), pdfAvailable = !!await findPdf(vault, batchId, item);
        const kind = item.isPaper ? 'paper' : location.isDirectory ? 'directory' : extname(item.originalPath).toLowerCase() === '.pdf' ? 'pdf' : extname(item.originalPath).toLowerCase() === '.md' ? 'note' : 'file';
        items.push({ id: `${batchId}::${item.storedId}`, batchId, storedId: item.storedId, title: item.title, kind, originalPath: item.originalPath, deletedAt: batch.deletedAt, itemsCount: batch.items.length, pdfAvailable, folderAvailable: true });
        if (items.length >= MAX_ENTRIES) { complete = false; warn('回收站条目较多，本次列表达到条目上限。'); break outer; }
      } catch { complete = false; diagnostics.skippedItems += 1; warn(`批次 ${batchId} 中有无法安全读取的条目，已跳过。`); }
    }
  }
  items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || b.id.localeCompare(a.id));
  return { items, complete, diagnostics };
}

/** Re-read the selected manifest on every explicit open; no caller-controlled path. */
export async function trashOpenTarget(vault: string, input: Pick<TrashOpenInput, 'batchId' | 'storedId' | 'target'>): Promise<string> {
  if (!batchName(input.batchId) || !storedName(input.storedId) || !['pdf', 'folder'].includes(input.target)) throw new LibraryError('INVALID_TRASH_PATH', '回收站打开参数无效。');
  const batch = await readBatch(vault, input.batchId, { remaining: MAX_MANIFEST_BYTES + 1 });
  const matches = batch.items.filter(raw => record(raw).stored === input.storedId);
  if (matches.length !== 1) throw new LibraryError('TRASH_ITEM_NOT_FOUND', '回收站条目不存在或存储标识重复，请刷新。');
  const item = readItem(matches[0]); await itemLocation(vault, input.batchId, item);
  if (input.target === 'folder') return (await safePath(vault, `${TRASH_REL}/${input.batchId}`))!;
  const pdf = await findPdf(vault, input.batchId, item);
  if (!pdf) throw new LibraryError('PDF_MISSING', '该回收站条目没有已确认的 PDF，可打开批次文件夹查看。');
  const handle = await open(pdf, 'r');
  try {
    const buffer = Buffer.alloc(1024), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (!buffer.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) throw new LibraryError('INVALID_PDF', '回收站文件没有有效的 PDF 文件头。');
  } finally { await handle.close(); }
  return pdf;
}
