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
const invalid = (message = '备份文件无效或不完整。', options?: ErrorOptions) =>
  new StudioError('INVALID_ARCHIVE', message, undefined, options);
const tooLarge = () =>
  new StudioError('TOO_LARGE', '备份超过容量限制：ZIP 128 MB，展开后 256 MB，单个资源 20 MB。');

type ImportedMetadata = ArtifactMetadata & {
  importedFrom?: { artifactId: string; title: string; createdAt: string; importedAt: string };
};
interface ArchiveManifest {
  format: 'agentero-studio-archive';
  version: 2;
  database: 'artifact.sqlite';
  artifactId: string;
}

const unsupported = () =>
  new StudioError(
    'UNSUPPORTED_STORAGE',
    '此备份使用不受支持的旧版存储格式，请由 AI 按迁移说明重建作品。',
  );

export async function readArchiveInput(args: Record<string, unknown>): Promise<Uint8Array> {
  if ((args.archivePath !== undefined) === (args.archiveBase64 !== undefined)) {
    throw new StudioError('INVALID_ARGUMENT', '请提供一个备份文件路径或备份内容。');
  }

  if (args.archiveBase64 !== undefined) {
    const encoded = args.archiveBase64;
    if (
      typeof encoded !== 'string' ||
      !encoded.length ||
      encoded.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4
    ) {
      throw tooLarge();
    }

    let padding = 0;
    if (encoded.endsWith('=')) {
      padding = encoded.endsWith('==') ? 2 : 1;
    }
    if (encoded.length % 4 || /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) {
      throw invalid('备份内容不是有效的 Base64。');
    }

    const data = Buffer.from(encoded, 'base64');
    if (data.length > MAX_ARCHIVE_BYTES) {
      throw tooLarge();
    }

    return data;
  }

  const path = text(args.archivePath, '', 4096);
  if (!path.trim()) {
    throw new StudioError('INVALID_ARGUMENT', '备份文件路径不能为空。');
  }

  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) {
      throw invalid('备份路径必须指向文件。');
    }
    if (info.size > MAX_ARCHIVE_BYTES) {
      throw tooLarge();
    }

    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) {
        break;
      }

      size += bytesRead;
      if (size > MAX_ARCHIVE_BYTES) {
        throw tooLarge();
      }

      chunks.push(chunk.subarray(0, bytesRead));
    }

    return Buffer.concat(chunks, size);
  } finally {
    await file.close();
  }
}

function entryLimit(name: string): number {
  if (name === 'artifact.json') {
    throw unsupported();
  }
  if (name === 'manifest.json') {
    return MAX_MANIFEST_BYTES;
  }
  if (name === 'artifact.sqlite') {
    return MAX_SNAPSHOT_BYTES;
  }
  if (name === 'assets/') {
    return 0;
  }
  if (
    /^assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.slice(7))
  ) {
    return MAX_ASSET_BYTES;
  }

  throw invalid('备份包含不允许的文件路径。');
}

function extract(data: Uint8Array): Map<string, Uint8Array> {
  if (!data.length) {
    throw invalid();
  }
  if (data.length > MAX_ARCHIVE_BYTES) {
    throw tooLarge();
  }

  const declared = new Map<string, UnzipFileInfo>();
  const names = new Set<string>();
  const files = new Map<string, Uint8Array>();
  let declaredSize = 0;
  let actualSize = 0;
  try {
    unzipSync(data, {
      filter(info) {
        const limit = entryLimit(info.name);
        if (names.has(info.name.toLowerCase())) {
          throw invalid('备份包含重复文件。');
        }

        const exceedsEntryLimit = declared.size >= MAX_ENTRIES || info.originalSize > limit;
        const unsupportedCompression = ![0, 8].includes(info.compression);
        if (exceedsEntryLimit || info.size > MAX_ARCHIVE_BYTES || unsupportedCompression) {
          throw tooLarge();
        }

        declaredSize += info.originalSize;
        if (declaredSize > MAX_EXPANDED_BYTES) {
          throw tooLarge();
        }

        declared.set(info.name, info);
        names.add(info.name.toLowerCase());

        return false;
      },
    });

    if (!declared.has('manifest.json') || !declared.has('artifact.sqlite')) {
      throw invalid('备份缺少数据库或格式说明。');
    }

    const seen = new Set<string>();
    const completed = new Set<string>();
    const unzipper = new Unzip((file) => {
      const limit = entryLimit(file.name);
      const info = declared.get(file.name);
      if (!info || seen.has(file.name)) {
        throw invalid('备份文件目录不一致或存在重复文件。');
      }

      const originalSizeMismatch =
        file.originalSize !== undefined && file.originalSize !== info.originalSize;
      const compressedSizeMismatch = file.size !== undefined && file.size !== info.size;
      if (file.compression !== info.compression || originalSizeMismatch || compressedSizeMismatch) {
        throw invalid();
      }

      seen.add(file.name);
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (error, chunk, final) => {
        if (error) {
          throw error;
        }

        size += chunk.length;
        actualSize += chunk.length;
        if (size > limit || size > info.originalSize || actualSize > MAX_EXPANDED_BYTES) {
          file.terminate();
          throw tooLarge();
        }

        chunks.push(chunk);
        if (final) {
          if (size !== info.originalSize) {
            throw invalid();
          }

          files.set(file.name, Buffer.concat(chunks, size));
          completed.add(file.name);
        }
      };

      file.start();
    });
    unzipper.register(UnzipInflate);

    for (let offset = 0; offset < data.length; offset += 1024) {
      unzipper.push(data.subarray(offset, offset + 1024), offset + 1024 >= data.length);
    }

    if (completed.size !== declared.size) {
      throw invalid();
    }

    return files;
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw invalid(undefined, { cause: error });
  }
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateMetadata(
  value: unknown,
  expectedId?: string,
  expectedType?: string,
): asserts value is ArtifactMetadata {
  if (!object(value)) {
    throw invalid();
  }

  safeId(value.id);
  safeId(value.type, '作品类型');
  const identityMismatch =
    (expectedId !== undefined && value.id !== expectedId) ||
    (expectedType !== undefined && value.type !== expectedType);
  const validTitle =
    typeof value.title === 'string' && value.title.trim() && value.title.length <= 200;

  if (identityMismatch || !validTitle || !validRevision(value.revision)) {
    throw invalid('备份作品信息无效。');
  }
  if (
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt) ||
    typeof value.pinned !== 'boolean'
  ) {
    throw invalid('备份作品信息无效。');
  }
}

function validateActor(value: unknown): asserts value is Actor {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw invalid('备份作者信息无效。');
  }

  const knownKind = ['human', 'agent'].includes(String(value.kind));
  if (!knownKind || !['owner', 'editor', 'commenter', 'viewer'].includes(String(value.role))) {
    throw invalid('备份作者信息无效。');
  }
}

function validRevision(value: unknown, minimum = 0): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function validateUnitClocks(unitClocks: unknown): void {
  if (unitClocks === undefined) {
    return;
  }

  const error = () => invalid('备份对象版本时钟无效。');
  if (!object(unitClocks)) {
    throw error();
  }

  for (const [unitId, clock] of Object.entries(unitClocks)) {
    safeId(unitId.startsWith('$') ? unitId.slice(1) : unitId, '内容单元 ID');
    if (
      !object(clock) ||
      !validRevision(clock.version, 1) ||
      !validRevision(clock.incarnationStart, 1)
    ) {
      throw error();
    }

    const sourceRevision = clock.sourceRevision;
    if (Number(clock.incarnationStart) > Number(clock.version)) {
      throw error();
    }
    if (sourceRevision !== undefined && !validRevision(sourceRevision, 1)) {
      throw error();
    }
  }
}

function validateHistory(
  state: ArtifactState<unknown>,
  validateContent: (content: unknown) => void,
): void {
  const { id, type, revision } = state.artifact;
  const historyIds = new Set<string>();
  const revisions = new Set<number>();
  const error = () => invalid('备份历史记录无效。');
  for (const saved of state.history) {
    if (!object(saved) || !object(saved.entry)) {
      throw error();
    }

    validateMetadata(saved.artifact, id, type);
    validateContent(saved.content);
    const entry = saved.entry;
    safeId(entry.id, '历史 ID');
    validateActor(entry.actor);
    const duplicate = historyIds.has(entry.id) || revisions.has(entry.revision);
    const wrongRevision = entry.revision !== saved.artifact.revision || entry.revision > revision;
    if (duplicate || wrongRevision || !validDate(entry.createdAt)) {
      throw error();
    }
    if (typeof entry.summary !== 'string' || !stringArray(entry.changedIds)) {
      throw error();
    }

    historyIds.add(entry.id);
    revisions.add(entry.revision);
  }
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function singleElementId(value: unknown): value is [string] {
  return Array.isArray(value) && value.length === 1 && typeof value[0] === 'string';
}

function validDocumentBlocks(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    return false;
  }

  return value.every(
    (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id),
  );
}

function validateAnchor(anchor: Record<string, unknown>): void {
  const { pin, coordinateSpace, elementIds, blockIds, itemId, sourceVersion } = anchor;
  if (pin !== undefined) {
    if (!isCommentPin(pin)) {
      throw invalid('备份备注气泡位置无效。');
    }

    if (pin.coordinateSpace === 'document') {
      if (
        coordinateSpace !== 'document' ||
        !singleElementId(elementIds) ||
        !validDocumentBlocks(blockIds)
      ) {
        throw invalid('备份文档气泡缺少有效段落定位。');
      }
    }
    if (pin.coordinateSpace === 'todo' && coordinateSpace !== 'todo') {
      throw invalid('备份任务气泡缺少任务行定位。');
    }
  }
  if (coordinateSpace !== 'todo') {
    return;
  }

  const validElement = singleElementId(elementIds) && isTodoId(elementIds[0]);
  if (!validElement || !isTodoId(itemId) || !validRevision(sourceVersion, 1)) {
    throw invalid('备份任务行来源无效。');
  }
}

function validateAttachment(value: unknown): void {
  if (value === undefined) {
    return;
  }

  const error = () => invalid('备份备注附加记录无效。');
  if (!object(value)) {
    throw error();
  }

  const { requestId, contentKey, state, requestedAt, attachedAt, attachedBy, requestedBy } = value;
  const validRequest =
    typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(requestId);
  const validKey = typeof contentKey === 'string' && /^[a-f0-9]{64}$/.test(contentKey);
  const validState = ['pending', 'attached'].includes(String(state));
  if (!validRequest || !validKey || !validState) {
    throw error();
  }
  if (!validDate(requestedAt)) {
    throw error();
  }

  validateActor(requestedBy);
  if (state !== 'attached') {
    return;
  }
  if (!validDate(attachedAt)) {
    throw invalid('备份缺少备注附加成功时间。');
  }

  validateActor(attachedBy);
  if (attachedBy.kind !== 'human' || attachedBy.role !== 'owner') {
    throw invalid('备份备注附加回执的身份无效。');
  }
}

function validateProposalApplication(value: unknown): void {
  if (!object(value) || !validRevision(value.revision) || !Array.isArray(value.changes)) {
    throw invalid();
  }
  if (value.changes.some((change) => !object(change) || typeof change.id !== 'string')) {
    throw invalid();
  }

  safeId(value.historyId, '历史 ID');
}

function validateProposalOption(value: unknown, optionIds: Set<string>): void {
  if (!object(value)) {
    throw invalid();
  }

  const id = safeId(value.id, '方案 ID');
  const error = () => invalid('备份建议方案无效。');
  const operations = value.operations;
  if (optionIds.has(id) || typeof value.label !== 'string' || !Array.isArray(operations)) {
    throw error();
  }
  if (operations.some((operation) => !object(operation) || typeof operation.op !== 'string')) {
    throw error();
  }
  if (
    !validRevision(value.baselineRevision) ||
    !object(value.baseline) ||
    !object(value.versions)
  ) {
    throw error();
  }
  if (Object.values(value.versions).some((version) => !validRevision(version))) {
    throw error();
  }
  if (
    !stringArray(value.targetIds) ||
    typeof value.wholeContent !== 'boolean' ||
    typeof value.active !== 'boolean'
  ) {
    throw error();
  }

  optionIds.add(id);
  if (value.active && !value.application) {
    throw invalid('备份缺少已应用方案的变更记录。');
  }

  if (value.application) {
    validateProposalApplication(value.application);
  }
}

function validateProposal(value: unknown): void {
  if (!value) {
    return;
  }

  const error = () => invalid('备份建议记录无效。');
  if (!object(value) || value.audience !== 'owner' || !validDate(value.expiresAt)) {
    throw error();
  }
  if (
    typeof value.fingerprint !== 'string' ||
    !Array.isArray(value.options) ||
    !Array.isArray(value.receipts)
  ) {
    throw error();
  }

  const optionIds = new Set<string>();
  for (const option of value.options) {
    validateProposalOption(option, optionIds);
  }

  for (const receipt of value.receipts) {
    if (!object(receipt) || typeof receipt.fingerprint !== 'string') {
      throw invalid();
    }

    safeId(receipt.id, '操作 ID');
    if (receipt.historyId !== undefined) {
      safeId(receipt.historyId, '历史 ID');
    }
  }
}

function validateFeedback(state: ArtifactState<unknown>): Set<string> {
  const feedbackIds = new Set<string>();
  const error = () => invalid('备份反馈信息无效。');
  for (const feedback of state.feedback) {
    if (!object(feedback)) {
      throw invalid();
    }

    safeId(feedback.id, '反馈 ID');
    validateActor(feedback.author);
    const wrongIdentity = feedbackIds.has(feedback.id) || feedback.artifactId !== state.artifact.id;
    const knownType = ['comment', 'request'].includes(feedback.type);
    const knownStatus = ['open', 'pending', 'processing', 'resolved'].includes(feedback.status);
    if (wrongIdentity || !knownType || !knownStatus) {
      throw error();
    }
    if (typeof feedback.text !== 'string' || !object(feedback.anchor)) {
      throw error();
    }
    if (
      !validDate(feedback.createdAt) ||
      !validDate(feedback.updatedAt) ||
      !Array.isArray(feedback.replies)
    ) {
      throw error();
    }

    validateAnchor(feedback.anchor);
    feedbackIds.add(feedback.id);
    for (const reply of feedback.replies) {
      if (!object(reply) || typeof reply.text !== 'string' || !validDate(reply.createdAt)) {
        throw invalid();
      }

      safeId(reply.id, '回复 ID');
      validateActor(reply.author);
    }

    validateAttachment(feedback.attachment);
    validateProposal(feedback.proposal);
  }

  return feedbackIds;
}

function validateSources(state: ArtifactState<unknown>, feedbackIds: Set<string>): void {
  for (const [feedbackId, sources] of Object.entries(state.sources)) {
    if (!feedbackIds.has(feedbackId) || !Array.isArray(sources)) {
      throw invalid('备份来源记录无效。');
    }

    for (const source of sources) {
      if (!object(source) || !object(source.element)) {
        continue;
      }

      const element = source.element;
      if (element.type === 'document') {
        normalizeDocument(element.document);
      }
      if (element.type === 'todo') {
        normalizeTodoItems(object(element.data) ? element.data.items : undefined);
      }
    }
  }
}

function validateAssets(
  state: ArtifactState<unknown>,
  validateMimeType: (mimeType: string) => void,
) {
  const error = () => invalid('备份资源信息无效。');
  for (const [assetId, asset] of Object.entries(state.assets)) {
    safeId(assetId, '资源 ID');
    if (!object(asset) || asset.id !== assetId || typeof asset.filename !== 'string') {
      throw error();
    }
    if (
      typeof asset.mimeType !== 'string' ||
      !validRevision(asset.size, 1) ||
      asset.size > MAX_ASSET_BYTES
    ) {
      throw error();
    }

    validateMimeType(asset.mimeType);
  }
}

function validateState(value: unknown, products: ProductRegistry): ArtifactState<unknown> {
  const state = products.decode(value);
  if (!object(state) || state.schemaVersion !== 2 || !('content' in state)) {
    throw invalid();
  }
  if (!Array.isArray(state.history) || !state.history.length || !Array.isArray(state.feedback)) {
    throw invalid();
  }
  if (!object(state.sources) || !object(state.assets)) {
    throw invalid();
  }

  validateMetadata(state.artifact);
  const product = products.get(state.artifact.type);
  product.adapter.validate(state.content);
  validateUnitClocks(state.unitClocks);
  validateHistory(state, (content) => product.adapter.validate(content));
  const feedbackIds = validateFeedback(state);
  validateSources(state, feedbackIds);
  validateAssets(state, (mimeType) => product.validateAsset(mimeType));

  return state;
}

function walk(
  value: unknown,
  visit?: (record: Record<string, unknown>, key: string, value: unknown) => void,
): void {
  const queue = [{ value, depth: 0 }];
  while (queue.length) {
    const next = queue.pop()!;
    if (next.depth > 64) {
      throw invalid('备份数据嵌套过深。');
    }
    if (!next.value || typeof next.value !== 'object') {
      continue;
    }

    for (const [key, child] of Object.entries(next.value)) {
      visit?.(next.value as Record<string, unknown>, key, child);
      if (child && typeof child === 'object') {
        queue.push({ value: child, depth: next.depth + 1 });
      }
    }
  }
}

function portable(state: ArtifactState<unknown>): ArtifactState<unknown> {
  const snapshot: ArtifactState<unknown> = {
    schemaVersion: 2,
    artifact: copy(state.artifact),
    content: copy(state.content),
    history: copy(state.history),
    feedback: copy(state.feedback),
    sources: copy(state.sources),
    assets: copy(state.assets),
    operations: [],
    sharing: { enabled: false, generation: 0, tokens: {} },
  };

  if (state.unitClocks) {
    snapshot.unitClocks = copy(state.unitClocks);
  }

  snapshot.artifact.sharing = false;
  for (const saved of snapshot.history) {
    saved.artifact.sharing = false;
  }

  for (const feedback of snapshot.feedback) {
    delete feedback.targetViewId;
    if (feedback.status === 'processing') {
      feedback.status = 'pending';
    }
  }

  return snapshot;
}

function manifest(files: Map<string, Uint8Array>): ArchiveManifest {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(files.get('manifest.json')!),
    );
  } catch (error) {
    throw invalid('备份格式说明无效。', { cause: error });
  }

  if (!object(value) || value.format !== 'agentero-studio-archive') {
    throw unsupported();
  }
  if (value.version !== 2 || value.database !== 'artifact.sqlite') {
    throw unsupported();
  }

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

    structuredClone(database.readState({ maxExpandedBytes: MAX_SNAPSHOT_BYTES }));
    database.close();
    database = undefined;
    const bytes = await readFile(file);
    if (bytes.length > MAX_SNAPSHOT_BYTES) {
      throw tooLarge();
    }

    return bytes;
  } finally {
    database?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readDatabase(
  root: string,
  files: Map<string, Uint8Array>,
  metadata: ArchiveManifest,
): Promise<ArtifactState<unknown>> {
  const bytes = files.get(metadata.database)!;
  if (!Buffer.from(bytes.subarray(0, 16)).equals(Buffer.from('SQLite format 3\0'))) {
    throw invalid('备份数据库无效。');
  }

  await mkdir(join(root, 'staging'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'staging', 'read-'));
  let database: SqliteArtifactRepository | undefined;
  try {
    const file = join(temporary, 'artifact.sqlite');
    await writeFile(file, bytes, { flag: 'wx' });
    try {
      database = new SqliteArtifactRepository(file);
      const state = structuredClone(
        database.readState<unknown, unknown, unknown>({ maxExpandedBytes: MAX_SNAPSHOT_BYTES }),
      );

      if (state.artifact.id !== metadata.artifactId) {
        throw invalid('备份作品标识与数据库不一致。');
      }

      return state;
    } catch (error) {
      if (
        error instanceof StudioError &&
        ['UNSUPPORTED_STORAGE', 'TOO_LARGE'].includes(error.code)
      ) {
        throw error;
      }

      throw invalid('备份数据库无法读取或内容不完整。');
    }
  } finally {
    database?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function exportArchive(
  store: ArtifactStore<unknown>,
  state: ArtifactState<unknown>,
  actor: Actor,
): Promise<ExportBytes> {
  requireRole(actor, ['owner']);
  const snapshot = portable(state);
  const database = await databaseBytes(store.root, snapshot);
  const metadata: ArchiveManifest = {
    format: 'agentero-studio-archive',
    version: 2,
    database: 'artifact.sqlite',
    artifactId: snapshot.artifact.id,
  };
  const description = Buffer.from(JSON.stringify(metadata));
  const entries: Zippable = { 'manifest.json': description, 'artifact.sqlite': database };
  let size = database.length + description.length;
  if (Object.keys(snapshot.assets).length + 2 > MAX_ENTRIES) {
    throw tooLarge();
  }

  for (const [id, asset] of Object.entries(snapshot.assets)) {
    safeId(id, '资源 ID');
    const bytes = await readFile(join(store.folder(state.artifact.id), 'assets', id));
    if (bytes.length !== asset.size) {
      throw invalid('作品资源不完整，未生成备份。');
    }

    size += bytes.length;
    if (bytes.length > MAX_ASSET_BYTES || size > MAX_EXPANDED_BYTES) {
      throw tooLarge();
    }

    entries[`assets/${id}`] = [bytes, { level: 0 }];
  }

  const bytes = zipSync(entries, { level: 6 });
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw tooLarge();
  }

  const filename =
    (basename(state.artifact.title)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .trim() || '作品') + '.studio.zip';

  return {
    filename,
    mimeType: 'application/zip',
    data: Buffer.from(bytes).toString('base64'),
    encoding: 'base64',
  };
}

export async function importArchive(
  store: ArtifactStore<unknown>,
  products: ProductRegistry,
  data: Uint8Array,
  actor: Actor,
  title?: unknown,
): Promise<ArtifactState<unknown>> {
  requireRole(actor, ['owner']);
  const files = extract(data);
  const metadata = manifest(files);
  const raw = await readDatabase(store.root, files, metadata);
  walk(raw);
  let original: ArtifactState<unknown>;
  try {
    original = validateState(raw, products);
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw invalid(undefined, { cause: error });
  }

  const state = portable(original);
  for (const [id, asset] of Object.entries(state.assets)) {
    const bytes = files.get(`assets/${id}`);
    if (!bytes || bytes.length !== asset.size) {
      throw invalid('备份缺少资源或资源体积不符。');
    }
  }

  if (
    [...files.keys()].some(
      (name) =>
        name !== 'manifest.json' &&
        name !== 'artifact.sqlite' &&
        name !== 'assets/' &&
        !Object.hasOwn(state.assets, name.slice(7)),
    )
  ) {
    throw invalid('备份包含未登记资源。');
  }

  const previous = copy(state.artifact);
  const id = randomUUID();
  const now = new Date().toISOString();
  walk(state, (record, key, value) => {
    if (typeof value === 'string') {
      record[key] =
        key === 'artifactId' && value === previous.id
          ? id
          : value.replaceAll(`/assets/${previous.id}/`, `/assets/${id}/`);
    }
  });
  state.artifact.id = id;
  state.artifact.updatedAt = now;
  delete state.artifact.trashedAt;
  if (title !== undefined) {
    const name = text(title, '', 200).trim();
    if (!name) {
      throw new StudioError('INVALID_ARGUMENT', '作品名称不能为空。');
    }

    state.artifact.title = name;
  }

  (state.artifact as ImportedMetadata).importedFrom = {
    artifactId: previous.id,
    title: previous.title,
    createdAt: previous.createdAt,
    importedAt: now,
  };

  for (const saved of state.history) {
    saved.artifact.id = id;
  }

  products.validate(state);
  products.get(state.artifact.type).result(state);

  await mkdir(join(store.root, 'staging'), { recursive: true });
  const staging = await mkdtemp(join(store.root, 'staging', 'import-'));
  try {
    await mkdir(join(staging, 'assets'));
    for (const assetId of Object.keys(state.assets)) {
      await writeFile(join(staging, 'assets', assetId), files.get(`assets/${assetId}`)!, {
        flag: 'wx',
      });
    }

    await writeFile(join(staging, 'artifact.sqlite'), await databaseBytes(store.root, state), {
      flag: 'wx',
    });
    await mkdir(join(store.root, 'artifacts'), { recursive: true });
    await renameWithRetry(staging, store.folder(id));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return state;
}
