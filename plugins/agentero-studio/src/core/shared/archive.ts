import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Unzip, UnzipInflate, unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';
import { isCommentPin, type Actor } from '../../contracts/studio.js';
import { normalizeDocument } from '../../contracts/document.js';
import { isTodoId, normalizeTodoItems } from '../../contracts/todo.js';
import { copy, object, renameWithRetry, requireRole, safeId, StudioError, text } from './common.js';
import type { ExportBytes } from './files.js';
import type { ArtifactMetadata, ArtifactState } from './model.js';
import type { ProductRegistry } from './products.js';
import type { ArtifactStore } from './store.js';
import { SqliteArtifactRepository } from './sqlite-artifact.js';

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4096;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const invalid = (message = '备份文件无效或不完整。') => new StudioError('INVALID_ARCHIVE', message);
const tooLarge = () => new StudioError('TOO_LARGE', '备份超过容量限制：ZIP 128 MB，展开后 256 MB，单个资源 20 MB。');
type ImportedMetadata = ArtifactMetadata & { importedFrom?: { artifactId: string; title: string; createdAt: string; importedAt: string } };
interface ArchiveManifest { format: 'agentero-studio-archive'; version: 2; database: 'artifact.sqlite'; artifactId: string }
const unsupported = () => new StudioError('UNSUPPORTED_STORAGE', '此备份使用不受支持的旧版存储格式，请由 AI 按迁移说明重建作品。');

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
  if (name === 'artifact.json') throw unsupported();
  if (name === 'manifest.json') return MAX_MANIFEST_BYTES;
  if (name === 'artifact.sqlite') return MAX_SNAPSHOT_BYTES;
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
    if (!declared.has('manifest.json') || !declared.has('artifact.sqlite')) throw invalid('备份缺少数据库或格式说明。');
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
function validateActor(value: unknown): asserts value is Actor {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !['human', 'agent'].includes(String(value.kind)) || !['owner', 'editor', 'commenter', 'viewer'].includes(String(value.role))) throw invalid('备份作者信息无效。');
}
function validateState(value: unknown, products: ProductRegistry): ArtifactState<unknown> {
  const state = products.decode(value);
  if (!object(state) || state.schemaVersion !== 2 || !('content' in state) || !Array.isArray(state.history) || !state.history.length || !Array.isArray(state.feedback) || !object(state.sources) || !object(state.assets)) throw invalid();
  validateMetadata(state.artifact); const { id, type, revision } = state.artifact, product = products.get(type);
  product.adapter.validate(state.content);
  if (state.unitClocks !== undefined) {
    if (!object(state.unitClocks)) throw invalid('备份对象版本时钟无效。');
    for (const [unitId, clock] of Object.entries(state.unitClocks)) {
      safeId(unitId.startsWith('$') ? unitId.slice(1) : unitId, '内容单元 ID');
      if (!object(clock) || !Number.isSafeInteger(clock.version) || Number(clock.version) < 1 || !Number.isSafeInteger(clock.incarnationStart) || Number(clock.incarnationStart) < 1 || Number(clock.incarnationStart) > Number(clock.version) || clock.sourceRevision !== undefined && (!Number.isSafeInteger(clock.sourceRevision) || Number(clock.sourceRevision) < 1)) throw invalid('备份对象版本时钟无效。');
    }
  }
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
    if (feedback.anchor.pin !== undefined) {
      const pin = feedback.anchor.pin;
      if (!isCommentPin(pin)) throw invalid('备份备注气泡位置无效。');
      if (pin.coordinateSpace === 'document' && (feedback.anchor.coordinateSpace !== 'document' || !Array.isArray(feedback.anchor.elementIds) || feedback.anchor.elementIds.length !== 1 || typeof feedback.anchor.elementIds[0] !== 'string' || !Array.isArray(feedback.anchor.blockIds) || !feedback.anchor.blockIds.length || feedback.anchor.blockIds.length > 100 || feedback.anchor.blockIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id)))) throw invalid('备份文档气泡缺少有效段落定位。');
      if (pin.coordinateSpace === 'todo' && feedback.anchor.coordinateSpace !== 'todo') throw invalid('备份任务气泡缺少任务行定位。');
    }
    if (feedback.anchor.coordinateSpace === 'todo') {
      const { elementIds, itemId, sourceVersion } = feedback.anchor;
      if (!Array.isArray(elementIds) || elementIds.length !== 1 || !isTodoId(elementIds[0]) || !isTodoId(itemId) || !Number.isSafeInteger(sourceVersion) || Number(sourceVersion) < 1) throw invalid('备份任务行来源无效。');
    }
    feedbackIds.add(feedback.id);
    for (const reply of feedback.replies) { if (!object(reply) || typeof reply.text !== 'string' || !validDate(reply.createdAt)) throw invalid(); safeId(reply.id, '回复 ID'); validateActor(reply.author); }
    if (feedback.attachment !== undefined) {
      const attachment = feedback.attachment;
      if (!object(attachment) || typeof attachment.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(attachment.requestId) || typeof attachment.contentKey !== 'string' || !/^[a-f0-9]{64}$/.test(attachment.contentKey) || !['pending', 'attached'].includes(String(attachment.state)) || !validDate(attachment.requestedAt)) throw invalid('备份备注附加记录无效。');
      validateActor(attachment.requestedBy);
      if (attachment.state === 'attached') {
        if (!validDate(attachment.attachedAt)) throw invalid('备份缺少备注附加成功时间。');
        validateActor(attachment.attachedBy);
        if (attachment.attachedBy.kind !== 'human' || attachment.attachedBy.role !== 'owner') throw invalid('备份备注附加回执的身份无效。');
      }
    }
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
  for (const [feedbackId, sources] of Object.entries(state.sources)) {
    if (!feedbackIds.has(feedbackId) || !Array.isArray(sources)) throw invalid('备份来源记录无效。');
    for (const source of sources) if (object(source) && object(source.element)) {
      if (source.element.type === 'document') normalizeDocument(source.element.document);
      if (source.element.type === 'todo') normalizeTodoItems(object(source.element.data) ? source.element.data.items : undefined);
    }
  }
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
  if (state.unitClocks) snapshot.unitClocks = copy(state.unitClocks);
  snapshot.artifact.sharing = false;
  for (const saved of snapshot.history) saved.artifact.sharing = false;
  for (const feedback of snapshot.feedback) { delete feedback.targetViewId; if (feedback.status === 'processing') feedback.status = 'pending'; }
  return snapshot;
}

function manifest(files: Map<string, Uint8Array>): ArchiveManifest {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('manifest.json')!)); }
  catch { throw invalid('备份格式说明无效。'); }
  if (!object(value) || value.format !== 'agentero-studio-archive' || value.version !== 2 || value.database !== 'artifact.sqlite') throw unsupported();
  safeId(value.artifactId, '作品 ID');
  return value as unknown as ArchiveManifest;
}

async function databaseBytes(root: string, state: ArtifactState<unknown>): Promise<Buffer> {
  await mkdir(join(root, 'staging'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'staging', 'db-'));
  const file = join(temporary, 'artifact.sqlite');
  let database: SqliteArtifactRepository | undefined;
  try {
    database = new SqliteArtifactRepository(file, true);
    database.database.exec('BEGIN IMMEDIATE');
    database.writeState(state);
    database.database.exec('COMMIT');
    // A produced backup must satisfy the same logical expansion limit as import.
    structuredClone(database.readState({ maxExpandedBytes: MAX_SNAPSHOT_BYTES }));
    database.close(); database = undefined;
    const bytes = await readFile(file);
    if (bytes.length > MAX_SNAPSHOT_BYTES) throw tooLarge();
    return bytes;
  } finally { database?.close(); await rm(temporary, { recursive: true, force: true }); }
}

async function readDatabase(root: string, files: Map<string, Uint8Array>, metadata: ArchiveManifest): Promise<ArtifactState<unknown>> {
  const bytes = files.get(metadata.database)!;
  if (!Buffer.from(bytes.subarray(0, 16)).equals(Buffer.from('SQLite format 3\0'))) throw invalid('备份数据库无效。');
  await mkdir(join(root, 'staging'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'staging', 'read-'));
  let database: SqliteArtifactRepository | undefined;
  try {
    const file = join(temporary, 'artifact.sqlite');
    await writeFile(file, bytes, { flag: 'wx' });
    try {
      database = new SqliteArtifactRepository(file);
      const state = structuredClone(database.readState<unknown, unknown, unknown>({ maxExpandedBytes: MAX_SNAPSHOT_BYTES }));
      if (state.artifact.id !== metadata.artifactId) throw invalid('备份作品标识与数据库不一致。');
      return state;
    }
    catch (error) {
      if (error instanceof StudioError && ['UNSUPPORTED_STORAGE', 'TOO_LARGE'].includes(error.code)) throw error;
      throw invalid('备份数据库无法读取或内容不完整。');
    }
  } finally { database?.close(); await rm(temporary, { recursive: true, force: true }); }
}

export async function exportArchive(store: ArtifactStore<unknown>, state: ArtifactState<unknown>, actor: Actor): Promise<ExportBytes> {
  requireRole(actor, ['owner']);
  const snapshot = portable(state), database = await databaseBytes(store.root, snapshot);
  const metadata: ArchiveManifest = { format: 'agentero-studio-archive', version: 2, database: 'artifact.sqlite', artifactId: snapshot.artifact.id };
  const description = Buffer.from(JSON.stringify(metadata)), entries: Zippable = { 'manifest.json': description, 'artifact.sqlite': database }; let size = database.length + description.length;
  if (Object.keys(snapshot.assets).length + 2 > MAX_ENTRIES) throw tooLarge();
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
  const metadata = manifest(files), raw = await readDatabase(store.root, files, metadata);
  walk(raw); let original: ArtifactState<unknown>;
  try { original = validateState(raw, products); } catch (error) { if (error instanceof StudioError) throw error; throw invalid(); }
  const state = portable(original);
  for (const [id, asset] of Object.entries(state.assets)) { const bytes = files.get(`assets/${id}`); if (!bytes || bytes.length !== asset.size) throw invalid('备份缺少资源或资源体积不符。'); }
  if ([...files.keys()].some(name => name !== 'manifest.json' && name !== 'artifact.sqlite' && name !== 'assets/' && !Object.hasOwn(state.assets, name.slice(7)))) throw invalid('备份包含未登记资源。');
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
    await writeFile(join(staging, 'artifact.sqlite'), await databaseBytes(store.root, state), { flag: 'wx' });
    await mkdir(join(store.root, 'artifacts'), { recursive: true });
    await renameWithRetry(staging, store.folder(id));
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  return state;
}
