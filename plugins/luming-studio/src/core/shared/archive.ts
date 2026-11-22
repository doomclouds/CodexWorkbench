import { randomUUID } from 'node:crypto';
import { MAX_ARCHIVE_ASSET_BYTES } from '../../contracts/archive.js';
import { normalizeDocument } from '../../contracts/document.js';
import { isCommentPin, type Actor } from '../../contracts/studio.js';
import { isTodoId, normalizeTodoItems } from '../../contracts/todo.js';
import { invalidArchive as invalid } from '../../shared/studio-error.js';
import type { ArchiveInput, ArchiveSnapshot, ArchiveStorage } from '../ports/archive-storage.js';
import { copy, object, requireRole, safeId, StudioError, text } from './common.js';
import type { ArtifactMetadata, ArtifactState } from './model.js';
import type { ProductRegistry } from './products.js';

type ImportedMetadata = ArtifactMetadata & {
  importedFrom?: { artifactId: string; title: string; createdAt: string; importedAt: string };
};

const MAX_ARCHIVE_NESTING = 64;

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
      asset.size > MAX_ARCHIVE_ASSET_BYTES
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
  const validateContent =
    product.createArchiveContentValidator?.() ?? ((content) => product.adapter.validate(content));
  validateContent(state.content);
  validateUnitClocks(state.unitClocks);
  validateHistory(state, validateContent);
  const feedbackIds = validateFeedback(state);
  validateSources(state, feedbackIds);
  validateAssets(state, (mimeType) => product.validateAsset(mimeType));

  return state;
}

function walk(
  value: unknown,
  visit?: (record: Record<string, unknown>, key: string, value: unknown) => void,
): void {
  const heights = new WeakMap<object, number>();
  const ancestors = new WeakSet<object>();

  function requireDepth(depth: number): void {
    if (depth > MAX_ARCHIVE_NESTING) {
      throw invalid('备份数据嵌套过深。');
    }
  }

  function walkRecord(record: object, depth: number): number {
    requireDepth(depth);
    const knownHeight = heights.get(record);
    if (knownHeight !== undefined) {
      requireDepth(depth + knownHeight);
      return knownHeight;
    }
    if (ancestors.has(record)) {
      throw invalid('备份数据包含循环引用。');
    }

    ancestors.add(record);
    let height = 0;
    for (const [key, child] of Object.entries(record)) {
      visit?.(record as Record<string, unknown>, key, child);
      if (child && typeof child === 'object') {
        height = Math.max(height, 1 + walkRecord(child, depth + 1));
      }
    }
    ancestors.delete(record);
    heights.set(record, height);

    return height;
  }

  if (value && typeof value === 'object') {
    walkRecord(value, 0);
  }
}

function portable(state: ArtifactState<unknown>, detach: boolean): ArtifactState<unknown> {
  const data: ArtifactState<unknown> = {
    schemaVersion: 2,
    artifact: { ...state.artifact, sharing: false },
    content: state.content,
    history: state.history.map((saved) => ({
      ...saved,
      artifact: { ...saved.artifact, sharing: false },
    })),
    feedback: state.feedback,
    sources: state.sources,
    assets: state.assets,
    operations: [],
    sharing: { enabled: false, generation: 0, tokens: {} },
    ...(state.unitClocks ? { unitClocks: state.unitClocks } : {}),
  };
  const snapshot = detach ? copy(data) : data;

  for (const feedback of snapshot.feedback) {
    delete feedback.targetViewId;
    if (feedback.status === 'processing') {
      feedback.status = 'pending';
    }
  }

  return snapshot;
}

export async function captureArchive(
  storage: ArchiveStorage,
  state: ArtifactState<unknown>,
  actor: Actor,
): Promise<ArchiveSnapshot> {
  requireRole(actor, ['owner']);

  return storage.captureSnapshot(portable(state, true));
}

export async function importArchive(
  storage: ArchiveStorage,
  products: ProductRegistry,
  data: ArchiveInput,
  actor: Actor,
  title?: unknown,
): Promise<ArtifactState<unknown>> {
  requireRole(actor, ['owner']);
  const snapshot = await storage.readArchive(data);
  try {
    const state = prepareImport(snapshot, products, title);
    await storage.publishImported(state, snapshot);

    return state;
  } catch (error) {
    await snapshot.dispose();
    throw error;
  }
}

function prepareImport(
  { state: raw, assets }: ArchiveSnapshot,
  products: ProductRegistry,
  title: unknown,
): ArtifactState<unknown> {
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

  const state = portable(original, false);
  for (const clock of Object.values(state.unitClocks ?? {})) {
    delete clock.children;
  }
  for (const [id, asset] of Object.entries(state.assets)) {
    const file = assets.get(id);
    if (!file || file.size !== asset.size) {
      throw invalid('备份缺少资源或资源体积不符。');
    }
  }

  if ([...assets.keys()].some((id) => !Object.hasOwn(state.assets, id))) {
    throw invalid('备份包含未登记资源。');
  }

  const previous = copy(state.artifact);
  const id = randomUUID();
  const now = new Date().toISOString();
  const oldAssetPath = `/assets/${previous.id}/`;
  const newAssetPath = `/assets/${id}/`;
  walk(state, (record, key, value) => {
    if (typeof value === 'string') {
      record[key] =
        key === 'artifactId' && value === previous.id
          ? id
          : value.replaceAll(oldAssetPath, newAssetPath);
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

  return state;
}
