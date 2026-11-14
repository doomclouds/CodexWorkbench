import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Unzip, UnzipInflate, unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';
import type { Actor } from '../../contracts/studio.js';
import { copy, object, requireRole, safeId, StudioError, text } from './common.js';
import type { ExportBytes } from './files.js';
import type { ArtifactMetadata, ArtifactState } from './model.js';
import type { ProductRegistry } from './products.js';
import type { ArtifactStore } from './store.js';

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const invalid = (message = '备份文件无效或不完整。') => new StudioError('INVALID_ARCHIVE', message);
const tooLarge = () => new StudioError('TOO_LARGE', '备份超过容量限制：ZIP 128 MB，展开后 256 MB，单个资源 20 MB。');
type ImportedMetadata = ArtifactMetadata & { importedFrom?: { artifactId: string; title: string; createdAt: string; importedAt: string } };

/** One bounded input path for explicit owner file requests and internal transports. */
export async function readArchiveInput(args: Record<string, unknown>): Promise<Uint8Array> {
  if ((args.archivePath !== undefined) === (args.archiveBase64 !== undefined)) throw new StudioError('INVALID_ARGUMENT', '请提供一个备份文件路径或备份内容。');
  if (args.archiveBase64 !== undefined) {
    const encoded = args.archiveBase64;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4) throw tooLarge();
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if (encoded.length % 4 || /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) throw invalid('备份内容不是有效的 Base64。');
    const data = Buffer.from(encoded, 'base64'); if (data.length > MAX_ARCHIVE_BYTES) throw tooLarge(); return data;
  }
  const path = text(args.archivePath, '', 4096); if (!path.trim()) throw new StudioError('INVALID_ARGUMENT', '备份文件路径不能为空。');
  const file = await open(path, 'r');
  try {
    const info = await file.stat(); if (!info.isFile()) throw invalid('备份路径必须指向文件。'); if (info.size > MAX_ARCHIVE_BYTES) throw tooLarge();
    const chunks: Buffer[] = []; let size = 0;
    while (true) { const chunk = Buffer.allocUnsafe(64 * 1024), { bytesRead } = await file.read(chunk); if (!bytesRead) break; size += bytesRead; if (size > MAX_ARCHIVE_BYTES) throw tooLarge(); chunks.push(chunk.subarray(0, bytesRead)); }
    return Buffer.concat(chunks, size);
  } finally { await file.close(); }
}

function entryLimit(name: string): number {
  if (name === 'artifact.json') return MAX_SNAPSHOT_BYTES;
  if (name === 'assets/') return 0;
  if (/^assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.slice(7))) return MAX_ASSET_BYTES;
  // Archive paths are never joined to the filesystem before this exact whitelist.
  throw invalid('备份包含不允许的文件路径。');
}

/** Preflight the central directory without inflating; then bound actual streaming output. */
function extract(data: Uint8Array): Map<string, Uint8Array> {
  if (!data.length) throw invalid(); if (data.length > MAX_ARCHIVE_BYTES) throw tooLarge();
  const declared = new Map<string, UnzipFileInfo>(), names = new Set<string>(), files = new Map<string, Uint8Array>(); let declaredSize = 0, actualSize = 0;
  try {
    unzipSync(data, { filter(info) {
      const limit = entryLimit(info.name);
      if (names.has(info.name.toLowerCase())) throw invalid('备份包含重复文件。');
      if (declared.size >= MAX_ENTRIES || info.originalSize > limit || info.size > MAX_ARCHIVE_BYTES || ![0, 8].includes(info.compression)) throw tooLarge();
      declaredSize += info.originalSize; if (declaredSize > MAX_EXPANDED_BYTES) throw tooLarge();
      declared.set(info.name, info); names.add(info.name.toLowerCase()); return false;
    } });
    if (!declared.has('artifact.json')) throw invalid('备份缺少作品快照。');
    const seen = new Set<string>(), completed = new Set<string>();
    const unzipper = new Unzip(file => {
      const limit = entryLimit(file.name), info = declared.get(file.name);
      if (!info || seen.has(file.name)) throw invalid('备份文件目录不一致或存在重复文件。');
      if (file.compression !== info.compression || file.originalSize !== undefined && file.originalSize !== info.originalSize || file.size !== undefined && file.size !== info.size) throw invalid();
      seen.add(file.name); const chunks: Uint8Array[] = []; let size = 0;
      file.ondata = (error, chunk, final) => {
        if (error) throw error; size += chunk.length; actualSize += chunk.length;
        if (size > limit || size > info.originalSize || actualSize > MAX_EXPANDED_BYTES) { file.terminate(); throw tooLarge(); }
        chunks.push(chunk);
        if (final) { if (size !== info.originalSize) throw invalid(); files.set(file.name, Buffer.concat(chunks, size)); completed.add(file.name); }
      };
      file.start();
    });
    unzipper.register(UnzipInflate);
    // Small compressed chunks also bound a dishonest DEFLATE stream's transient output.
    for (let offset = 0; offset < data.length; offset += 1024) unzipper.push(data.subarray(offset, offset + 1024), offset + 1024 >= data.length);
    if (completed.size !== declared.size) throw invalid();
    return files;
  } catch (error) { if (error instanceof StudioError) throw error; throw invalid(); }
}

function validDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validateMetadata(value: unknown, expectedId?: string, expectedType?: string): asserts value is ArtifactMetadata {
  if (!object(value)) throw invalid();
  safeId(value.id); safeId(value.type, '作品类型');
  if (expectedId !== undefined && value.id !== expectedId || expectedType !== undefined && value.type !== expectedType || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !validDate(value.createdAt) || !validDate(value.updatedAt) || typeof value.pinned !== 'boolean') throw invalid('备份作品信息无效。');
}
function validateActor(value: unknown): void {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !['human', 'agent'].includes(String(value.kind)) || !['owner', 'editor', 'commenter', 'viewer'].includes(String(value.role))) throw invalid('备份作者信息无效。');
}
function validateState(value: unknown, products: ProductRegistry): ArtifactState<unknown> {
  const state = products.decode(value);
  if (!object(state) || state.schemaVersion !== 2 || !('content' in state) || !Array.isArray(state.history) || !state.history.length || !Array.isArray(state.feedback) || !object(state.sources) || !object(state.assets)) throw invalid();
  validateMetadata(state.artifact); const { id, type, revision } = state.artifact, product = products.get(type);
  product.adapter.validate(state.content);
  const historyIds = new Set<string>(), revisions = new Set<number>();
  for (const saved of state.history) {
    if (!object(saved) || !object(saved.entry)) throw invalid('备份历史记录无效。');
    validateMetadata(saved.artifact, id, type); product.adapter.validate(saved.content);
    const entry = saved.entry; safeId(entry.id, '历史 ID'); validateActor(entry.actor);
    if (historyIds.has(entry.id) || revisions.has(entry.revision) || entry.revision !== saved.artifact.revision || entry.revision > revision || !validDate(entry.createdAt) || typeof entry.summary !== 'string' || !Array.isArray(entry.changedIds) || entry.changedIds.some(changed => typeof changed !== 'string')) throw invalid('备份历史记录无效。');
    historyIds.add(entry.id); revisions.add(entry.revision);
  }
  const feedbackIds = new Set<string>();
  for (const feedback of state.feedback) {
    if (!object(feedback)) throw invalid(); safeId(feedback.id, '反馈 ID'); validateActor(feedback.author);
    if (feedbackIds.has(feedback.id) || feedback.artifactId !== id || !['comment', 'request'].includes(feedback.type) || !['open', 'pending', 'processing', 'resolved'].includes(feedback.status) || typeof feedback.text !== 'string' || !object(feedback.anchor) || !validDate(feedback.createdAt) || !validDate(feedback.updatedAt) || !Array.isArray(feedback.replies)) throw invalid('备份反馈信息无效。');
    feedbackIds.add(feedback.id);
    for (const reply of feedback.replies) { if (!object(reply) || typeof reply.text !== 'string' || !validDate(reply.createdAt)) throw invalid(); safeId(reply.id, '回复 ID'); validateActor(reply.author); }
    if (feedback.proposal) {
      const proposal = feedback.proposal;
      if (!object(proposal) || proposal.audience !== 'owner' || !validDate(proposal.expiresAt) || typeof proposal.fingerprint !== 'string' || !Array.isArray(proposal.options) || !Array.isArray(proposal.receipts)) throw invalid('备份建议记录无效。');
      const optionIds = new Set<string>();
      for (const option of proposal.options) {
        if (!object(option)) throw invalid(); safeId(option.id, '方案 ID');
        if (optionIds.has(option.id) || typeof option.label !== 'string' || !Array.isArray(option.operations) || option.operations.some(op => !object(op) || typeof op.op !== 'string') || !Number.isSafeInteger(option.baselineRevision) || option.baselineRevision < 0 || !object(option.baseline) || !object(option.versions) || Object.values(option.versions).some(value => !Number.isSafeInteger(value) || value < 0) || !Array.isArray(option.targetIds) || option.targetIds.some(value => typeof value !== 'string') || typeof option.wholeContent !== 'boolean' || typeof option.active !== 'boolean') throw invalid('备份建议方案无效。');
        optionIds.add(option.id);
        if (option.active && !option.application) throw invalid('备份缺少已应用方案的变更记录。');
        if (option.application) { const application = option.application; if (!object(application) || !Number.isSafeInteger(application.revision) || application.revision < 0 || !Array.isArray(application.changes) || application.changes.some(change => !object(change) || typeof change.id !== 'string')) throw invalid(); safeId(application.historyId, '历史 ID'); }
      }
      for (const receipt of proposal.receipts) { if (!object(receipt) || typeof receipt.fingerprint !== 'string') throw invalid(); safeId(receipt.id, '操作 ID'); if (receipt.historyId !== undefined) safeId(receipt.historyId, '历史 ID'); }
    }
  }
  for (const [feedbackId, sources] of Object.entries(state.sources)) if (!feedbackIds.has(feedbackId) || !Array.isArray(sources)) throw invalid('备份来源记录无效。');
  for (const [assetId, asset] of Object.entries(state.assets)) {
    safeId(assetId, '资源 ID');
    if (!object(asset) || asset.id !== assetId || typeof asset.filename !== 'string' || typeof asset.mimeType !== 'string' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) throw invalid('备份资源信息无效。');
    product.validateAsset(asset.mimeType);
  }
  return state;
}

/** Bound nesting before generic traversal; metadata and content remain product-neutral. */
function walk(value: unknown, visit?: (record: Record<string, unknown>, key: string, value: unknown) => void): void {
  const queue = [{ value, depth: 0 }];
  while (queue.length) {
    const next = queue.pop()!;
    if (next.depth > 64) throw invalid('备份数据嵌套过深。');
    if (!next.value || typeof next.value !== 'object') continue;
    for (const [key, child] of Object.entries(next.value)) { visit?.(next.value as Record<string, unknown>, key, child); if (child && typeof child === 'object') queue.push({ value: child, depth: next.depth + 1 }); }
  }
}
function portable(state: ArtifactState<unknown>): ArtifactState<unknown> {
  // Pick the envelope explicitly: exports cannot accidentally include future daemon state.
  const snapshot: ArtifactState<unknown> = { schemaVersion: 2, artifact: copy(state.artifact), content: copy(state.content), history: copy(state.history), feedback: copy(state.feedback), sources: copy(state.sources), assets: copy(state.assets), operations: [], sharing: { enabled: false, generation: 0, tokens: {} } };
  snapshot.artifact.sharing = false;
  for (const saved of snapshot.history) saved.artifact.sharing = false;
  for (const feedback of snapshot.feedback) { delete feedback.targetViewId; if (feedback.status === 'processing') feedback.status = 'pending'; }
  return snapshot;
}

export async function exportArchive(store: ArtifactStore<unknown>, state: ArtifactState<unknown>, actor: Actor): Promise<ExportBytes> {
  requireRole(actor, ['owner']);
  const snapshot = portable(state), json = Buffer.from(JSON.stringify(snapshot)), entries: Zippable = { 'artifact.json': json }; let size = json.length;
  if (json.length > MAX_SNAPSHOT_BYTES || Object.keys(snapshot.assets).length + 1 > MAX_ENTRIES) throw tooLarge();
  for (const [id, asset] of Object.entries(snapshot.assets)) {
    safeId(id, '资源 ID'); const bytes = await readFile(join(store.folder(state.artifact.id), 'assets', id));
    if (bytes.length !== asset.size) throw invalid('作品资源不完整，未生成备份。');
    size += bytes.length; if (bytes.length > MAX_ASSET_BYTES || size > MAX_EXPANDED_BYTES) throw tooLarge();
    entries[`assets/${id}`] = [bytes, { level: 0 }];
  }
  const bytes = zipSync(entries, { level: 6 }); if (bytes.length > MAX_ARCHIVE_BYTES) throw tooLarge();
  const filename = (basename(state.artifact.title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '作品') + '.studio.zip';
  return { filename, mimeType: 'application/zip', data: Buffer.from(bytes).toString('base64'), encoding: 'base64' };
}

/** Validate completely, create a private staging folder, then publish a fresh artifact once. */
export async function importArchive(store: ArtifactStore<unknown>, products: ProductRegistry, data: Uint8Array, actor: Actor, title?: unknown): Promise<ArtifactState<unknown>> {
  requireRole(actor, ['owner']); const files = extract(data);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('artifact.json')!)); } catch { throw invalid('作品快照不是有效的 JSON。'); }
  walk(raw); let original: ArtifactState<unknown>;
  try { original = validateState(raw, products); } catch (error) { if (error instanceof StudioError) throw error; throw invalid(); }
  const state = portable(original);
  for (const [id, asset] of Object.entries(state.assets)) { const bytes = files.get(`assets/${id}`); if (!bytes || bytes.length !== asset.size) throw invalid('备份缺少资源或资源体积不符。'); }
  if ([...files.keys()].some(name => name !== 'artifact.json' && name !== 'assets/' && !Object.hasOwn(state.assets, name.slice(7)))) throw invalid('备份包含未登记资源。');
  const previous = copy(state.artifact), id = randomUUID(), now = new Date().toISOString();
  walk(state, (record, key, value) => {
    if (typeof value === 'string') record[key] = key === 'artifactId' && value === previous.id ? id : value.replaceAll(`/assets/${previous.id}/`, `/assets/${id}/`);
  });
  state.artifact.id = id; state.artifact.updatedAt = now; delete state.artifact.trashedAt;
  if (title !== undefined) { const name = text(title, '', 200).trim(); if (!name) throw new StudioError('INVALID_ARGUMENT', '作品名称不能为空。'); state.artifact.title = name; }
  (state.artifact as ImportedMetadata).importedFrom = { artifactId: previous.id, title: previous.title, createdAt: previous.createdAt, importedAt: now };
  for (const saved of state.history) saved.artifact.id = id;
  products.validate(state); products.get(state.artifact.type).result(state);
  // staging is outside artifacts/, so library scans cannot observe an incomplete import.
  await mkdir(join(store.root, 'staging'), { recursive: true });
  const staging = await mkdtemp(join(store.root, 'staging', 'import-'));
  try {
    await mkdir(join(staging, 'assets'));
    for (const assetId of Object.keys(state.assets)) await writeFile(join(staging, 'assets', assetId), files.get(`assets/${assetId}`)!, { flag: 'wx' });
    await writeFile(join(staging, 'artifact.json'), JSON.stringify(state), { flag: 'wx' });
    await mkdir(join(store.root, 'artifacts'), { recursive: true });
    await rename(staging, store.folder(id));
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  return state;
}
