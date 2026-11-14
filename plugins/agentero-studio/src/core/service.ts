import { LOCAL_ACTOR, TOOL_NAMES, type Actor, type Presence, type Role, type StudioEvent, type ToolName } from '../contracts/studio.js';
import { copy, safeId, StudioError, StudioStore, type ArtifactState } from './store.js';
import { assertAlive, object, requireRole, text } from './shared/common.js';
import { createArtifact, listArtifacts, manageArtifact } from './shared/artifacts.js';
import { applyMutation, version } from './shared/history.js';
import { updateFeedback } from './shared/feedback.js';
import { clearExpiredProposals, feedbackVisible, previewProposal, proposalExpired, updateProposal, visibleFeedback } from './shared/proposals.js';
import { SHARE_ROLES, shareInfo, shareRole, updateSharing, revokeSharing } from './shared/sharing.js';
import { studioProducts } from './products/index.js';
import type { ProductRegistry } from './shared/products.js';
import type { ContentOperation } from './shared/model.js';
import { StudioCollaboration } from './shared/collaboration.js';
import { duplicateAssets, importAsset, deleteAsset, listAssets, putAsset, getAsset, saveExport, getExport, exportResources, purgeExports, type ExportRecord } from './shared/files.js';
import { ThumbnailCache } from './shared/thumbnails.js';
import { exportArchive, importArchive as importArtifactArchive, readArchiveInput } from './shared/archive.js';

export { StudioError } from './store.js';
export type { ExportRecord } from './shared/files.js';

export class StudioService {
  private readonly thumbnails = new ThumbnailCache();
  readonly store: StudioStore;
  private readonly products: ProductRegistry;
  private readonly collaboration = new StudioCollaboration();
  private tasks = new Set<Promise<unknown>>();
  private closing = false;
  private sharingOrigin = '';
  private shareHandler?: (enabled: boolean) => Promise<string | undefined>;
  constructor(options: { dataRoot?: string; products?: ProductRegistry } = {}) { this.products = options.products ?? studioProducts(); this.store = new StudioStore(options.dataRoot, this.products); }
  get dataRoot() { return this.store.root; }
  configureSharing(handler: (enabled: boolean) => Promise<string | undefined>) { this.shareHandler = handler; }
  subscribe(artifactId: string, listener: (event: StudioEvent) => void): () => void { return this.collaboration.subscribe(artifactId, listener); }
  private emit(event: StudioEvent) { this.collaboration.emit(event); }
  async execute(name: ToolName, args: Record<string, unknown> = {}, actor: Actor = LOCAL_ACTOR): Promise<any> {
    if (this.closing) throw new StudioError('CLOSED', 'Studio 服务已经关闭。');
    if (!TOOL_NAMES.includes(name)) throw new StudioError('UNKNOWN_TOOL', '不支持的 Studio 操作。');
    if (!object(args)) throw new StudioError('INVALID_ARGUMENT', '操作参数必须是对象。');
    const task = this.dispatch(name, args, copy(actor)); this.tasks.add(task);
    try { return await task; } finally { this.tasks.delete(task); }
  }
  private async dispatch(name: ToolName, args: Record<string, unknown>, actor: Actor): Promise<any> {
    if (name === 'studio_open') { if (args.artifactId) await this.store.read(safeId(args.artifactId)); return { view: args.view ?? (args.artifactId ? 'editor' : 'library'), products: this.products.catalog(), ...(args.artifactId ? { artifactId: args.artifactId } : {}) }; }
    if (name === 'artifact_list') { const result = listArtifacts(await this.store.list(), args, actor); return { ...result, artifacts: result.artifacts.map(artifact => ({ ...artifact, thumbnail: `/api/thumbnails/${artifact.id}?revision=${artifact.revision}` })) }; }
    if (name === 'artifact_manage') return this.manage(args, actor);
    const id = safeId(args.artifactId);
    if (name === 'artifact_read') return this.read(id, args, actor);
    if (name === 'artifact_apply') return this.apply(id, args, actor);
    if (name === 'artifact_feedback') return this.feedback(id, args, actor);
    if (name === 'artifact_share') return this.share(id, args, actor);
    if (name === 'artifact_export') return this.export(id, args, actor);
    throw new StudioError('UNKNOWN_TOOL', '不支持的 Studio 操作。');
  }
  private async manage(args: Record<string, unknown>, actor: Actor) {
    requireRole(actor, ['owner']); const action = text(args.action, 'create');
    if (action === 'purge') return this.purge(args);
    if (action === 'import') return this.importArchive(await readArchiveInput(args), actor, args.title);
    if (action === 'create' || action === 'duplicate') {
      const base = action === 'duplicate' ? await this.store.read(safeId(args.artifactId)) : undefined;
      const product = this.products.get(base?.artifact.type ?? text(args.type, 'whiteboard'));
      const title = text(args.title, base ? `${base.artifact.title} 副本` : product.defaultTitle, 200);
      const content = product.create(args, base?.content); product.adapter.validate(content);
      const state = createArtifact(product.adapter.type, title, content, actor, action === 'create' ? '创建作品' : '复制作品', product.initialIds(content));
      const id = state.artifact.id;
      if (base) {
        product.rewriteAssetReferences?.(state.content, base.artifact.id, id);
        state.assets = copy(base.assets); state.history[0]!.content = copy(state.content);
        await duplicateAssets(this.store, base.artifact.id, id);
      }
      await this.store.write(state); this.emit({ type: 'artifact', artifactId: id, artifact: copy(state.artifact) });
      return { artifact: copy(state.artifact), ...product.result(state) };
    }
    const id = safeId(args.artifactId);
    if (action === 'asset-import') {
      const state = await this.store.read(id); assertAlive(state.artifact);
      return { asset: await importAsset(this.store, id, args.assetPath, actor, this.products.get(state.artifact.type).validateAsset) };
    }
    if (action === 'asset-delete') return deleteAsset(this.store, id, args.assetId, actor);
    const result = await this.store.transaction(id, state => {
      manageArtifact(state, action, args, actor); return { artifact: copy(state.artifact), ...this.products.get(state.artifact.type).result(state) };
    });
    this.emit({ type: 'artifact', artifactId: id, artifact: result.artifact });
    if (action === 'trash') { this.emit({ type: 'share', artifactId: id, enabled: false, revokedRoles: [...SHARE_ROLES] }); await this.shareHandler?.(false); }
    return result;
  }
  private async purge(args: Record<string, unknown>) {
    const multiple = args.artifactIds !== undefined;
    if (multiple === (args.artifactId !== undefined) || multiple && (!Array.isArray(args.artifactIds) || !args.artifactIds.length || args.artifactIds.length > 100)) throw new StudioError('INVALID_ARGUMENT', '请提供单个作品 ID，或 1 到 100 个作品 ID 的列表，两者不能同时提供。');
    const ids = [...new Set((multiple ? args.artifactIds as unknown[] : [args.artifactId]).map(id => safeId(id)))];
    const deletedIds: string[] = [], failures: { artifactId: string; code: string; message: string }[] = [];
    for (const id of ids) {
      try { await this.store.purge(id, () => purgeExports(this.dataRoot, id)); }
      catch (error) {
        failures.push({ artifactId: id, code: error instanceof StudioError ? error.code : 'PURGE_FAILED', message: error instanceof StudioError ? error.message : `永久删除未完成，可能已移除部分所属资源；请检查存储状态后重试。${error instanceof Error ? ` ${error.message}` : ''}` });
        continue;
      }
      deletedIds.push(id); this.collaboration.forget(id); this.thumbnails.delete(id);
      this.emit({ type: 'share', artifactId: id, enabled: false, revokedRoles: [...SHARE_ROLES] });
      this.emit({ type: 'purged', artifactId: id });
    }
    return { deletedIds, failures };
  }
  async importArchive(data: Uint8Array, actor: Actor = LOCAL_ACTOR, title?: unknown) {
    if (this.closing) throw new StudioError('CLOSED', 'Studio 服务已经关闭。');
    const task = (async () => {
      const state = await importArtifactArchive(this.store, this.products, data, actor, title);
      this.emit({ type: 'artifact', artifactId: state.artifact.id, artifact: copy(state.artifact) });
      return { artifact: copy(state.artifact), ...this.products.get(state.artifact.type).result(state) };
    })();
    this.tasks.add(task); try { return await task; } finally { this.tasks.delete(task); }
  }
  private async read(id: string, args: Record<string, unknown>, actor: Actor) {
    const mode = text(args.mode, 'document');
    if (mode === 'assets') requireRole(actor, ['owner']);
    const state = await this.store.read(id), product = this.products.get(state.artifact.type);
    if (mode === 'assets') return listAssets(state, args, actor);
    // Filter at the shared boundary, including product-specific source readers and counts.
    // A LAN visitor cannot recover a private option by guessing its feedback/context ID.
    const hidden = state.feedback.filter(item => !feedbackVisible(item, actor));
    if (hidden.some(item => item.id === args.feedbackId || item.id === args.contextId)) throw new StudioError('NOT_FOUND', '反馈上下文不存在。');
    for (const item of hidden) delete state.sources[item.id];
    state.feedback = visibleFeedback(state.feedback, actor);
    if (mode === 'document' || mode === 'board') return product.project(state);
    if (mode === 'history') return { history: state.history.map(item => item.entry) };
    if (mode === 'version') return product.result(version(state, args.versionId ?? args.revision));
    if (mode === 'diff') {
      const before = version(state, args.fromVersionId ?? args.from ?? args.versionId ?? args.revision);
      const after = args.toVersionId !== undefined || args.to !== undefined ? version(state, args.toVersionId ?? args.to) : state;
      return { ...product.diff(before, after), fromRevision: before.artifact.revision, toRevision: after.artifact.revision };
    }
    if (mode === 'context') {
      if (args.feedbackId || args.contextId) { const feedbackId = safeId(args.feedbackId ?? args.contextId, '反馈 ID'), feedback = state.feedback.find(item => item.id === feedbackId); if (!feedback) throw new StudioError('NOT_FOUND', '反馈上下文不存在。'); return { contextId: feedbackId, artifact: state.artifact, feedback, sources: state.sources[feedbackId] ?? [], timer: this.getTimer(id) }; }
      const peers = this.getPresence(id).filter(peer => !args.viewId || peer.context?.viewId === args.viewId); return { artifactId: id, contexts: peers.flatMap(peer => peer.context ? [{ ...peer.context, actor: peer.actor, updatedAt: peer.updatedAt }] : []), pending: state.feedback.filter(item => item.status === 'pending'), timer: this.getTimer(id) };
    }
    return product.read(state, mode, args);
  }
  private async apply(id: string, args: Record<string, unknown>, actor: Actor) {
    const result = await this.store.transaction(id, state => {
      const adapter = this.products.get(state.artifact.type).adapter;
      if (actor.kind === 'agent' && !state.operations.some(operation => operation.id === args.operationId) && Array.isArray(args.operations)) {
        const editing = new Set(this.getPresence(id).filter(peer => ['owner', 'editor'].includes(peer.actor.role) && (!args.viewId || peer.context?.viewId !== args.viewId)).flatMap(peer => [...(peer.context?.editingIds ?? []), ...(Array.isArray(peer.context?.movingIds) ? peer.context.movingIds as string[] : [])]));
        const conflicts = new Set<string>();
        for (const operation of args.operations) {
          if (!object(operation) || typeof operation.op !== 'string' || !editing.size) continue;
          const targets = operation.op === 'restore' ? undefined : adapter.targets(state.content, { ...operation, op: operation.op });
          for (const target of targets ?? editing) if (editing.has(target)) conflicts.add(target);
        }
        if (conflicts.size) throw new StudioError('EDIT_IN_PROGRESS', '目标内容正在其他视图中编辑，请等待编辑完成后重试。', { ids: [...conflicts] });
      }
      return applyMutation(state, { operationId: args.operationId, operations: args.operations as ContentOperation[], expectedRevision: args.expectedRevision, expectedVersions: args.expectedVersions, summary: args.summary }, actor, adapter);
    });
    const snapshot = result.snapshot;
    if (result.changed) this.emit({ type: 'board', artifactId: id, revision: snapshot.artifact.revision, changedIds: result.historyEntry.changedIds });
    return { ...this.products.get(snapshot.artifact.type).result(snapshot), historyEntry: result.historyEntry };
  }
  private async feedback(id: string, args: Record<string, unknown>, actor: Actor) {
    const action = text(args.action, 'list');
    if (action === 'preview') {
      const state = await this.store.read(id), product = this.products.get(state.artifact.type);
      const snapshot = previewProposal(state, args, actor, product.adapter);
      return { document: product.project(snapshot) };
    }
    if (action === 'list' || action === 'get') {
      let state = await this.store.read(id);
      if (state.feedback.some(item => proposalExpired(item))) state = await this.store.transaction(id, current => { clearExpiredProposals(current); return copy(current); });
      const feedback = visibleFeedback(state.feedback, actor).filter(item => (args.status === undefined || item.status === args.status) && (args.feedbackId === undefined || item.id === args.feedbackId));
      if (action === 'get' && !feedback.length) throw new StudioError('NOT_FOUND', '反馈不存在。');
      return { feedback };
    }
    if (['suggest', 'choose', 'withdraw'].includes(action)) {
      const result = await this.store.transaction(id, state => updateProposal(state, args, actor, this.products.get(state.artifact.type).adapter));
      // SSE is a shared channel. Publish only a refresh notification, never private options.
      this.emit({ type: 'feedback', artifactId: id });
      if (result.changed && result.snapshot && result.historyEntry) this.emit({ type: 'board', artifactId: id, revision: result.snapshot.artifact.revision, changedIds: result.historyEntry.changedIds });
      const { snapshot, changed: _changed, ...response } = result;
      return { ...response, ...(snapshot ? this.products.get(snapshot.artifact.type).result(snapshot) : {}) };
    }
    const result = await this.store.transaction(id, state => updateFeedback(state, args, actor, this.products.get(state.artifact.type).adapter));
    this.emit({ type: 'feedback', artifactId: id }); return result;
  }
  private async share(id: string, args: Record<string, unknown>, actor: Actor) {
    requireRole(actor, ['owner']); const action = text(args.action, 'status');
    const current = await this.store.read(id);
    if (action === 'status') return shareInfo(id, current.sharing, this.sharingOrigin);
    if (!['start', 'stop', 'reset'].includes(action)) throw new StudioError('INVALID_ARGUMENT', '不支持的分享操作。');
    // Validate before opening LAN, and close a newly opened listener if the commit fails.
    assertAlive(current.artifact); let opened = false;
    try {
      if (action === 'start') { const origin = await this.shareHandler?.(true); opened = true; if (origin) this.sharingOrigin = origin; }
      const committed = await this.store.transaction(id, state => {
        const revokedRoles = updateSharing(state.artifact, state.sharing, action, actor, args.role);
        return { info: shareInfo(id, state.sharing, this.sharingOrigin), revokedRoles };
      });
      this.emit({ type: 'share', artifactId: id, enabled: committed.info.enabled, generation: committed.info.generation, revokedRoles: [...committed.revokedRoles] });
      if (action === 'stop') await this.shareHandler?.(false);
      return committed.info;
    } catch (error) { if (opened) await this.shareHandler?.(false); throw error; }
  }
  async shareRole(artifactId: string, token: string): Promise<Exclude<Role, 'owner'> | undefined> {
    let state: ArtifactState; try { state = await this.store.read(artifactId); } catch { return; }
    return shareRole(state.artifact, state.sharing, token);
  }
  async hasShares() { return (await this.store.list()).some(state => state.sharing.enabled && !state.artifact.trashedAt); }
  async resetSharingSessions() {
    for (const saved of await this.store.list()) if (saved.sharing.enabled) {
      await this.store.transaction(saved.artifact.id, state => { revokeSharing(state.sharing); });
      this.emit({ type: 'share', artifactId: saved.artifact.id, enabled: false, revokedRoles: [...SHARE_ROLES] });
    }
  }
  async putAsset(artifactId: string, data: Uint8Array, input: { filename?: string; mimeType?: string }, actor: Actor) { const state = await this.store.read(artifactId); return putAsset(this.store, artifactId, data, input, actor, this.products.get(state.artifact.type).validateAsset); }
  async getAsset(artifactId: string, assetId: string) { return getAsset(this.store, artifactId, assetId); }
  async getThumbnail(artifactId: string, actor: Actor = LOCAL_ACTOR) {
    const state = await this.store.read(safeId(artifactId));
    if (state.artifact.trashedAt) requireRole(actor, ['owner']);
    const product = this.products.get(state.artifact.type);
    if (!product.thumbnail) throw new StudioError('NO_PREVIEW', '此产品未提供预览，请直接打开作品。');
    return this.thumbnails.get(artifactId, state.artifact.revision, () => product.thumbnail!(state, exportResources(this.store, artifactId)));
  }
  async updatePresence(artifactId: string, input: Record<string, unknown>, actor: Actor) { await this.store.read(artifactId); return this.collaboration.update(artifactId, input, actor); }
  getPresence(artifactId: string): Presence[] { return this.collaboration.getPresence(artifactId); }
  getTimer(artifactId: string) { return this.collaboration.getTimer(artifactId); }
  private async export(id: string, args: Record<string, unknown>, actor: Actor): Promise<ExportRecord> {
    const state = await this.store.read(id); assertAlive(state.artifact); const format = text(args.format, 'json', 20).toLowerCase();
    let result;
    const { artifactId: _artifactId, format: _format, options: nestedOptions, ...flatOptions } = args;
    const options = { ...(object(nestedOptions) ? nestedOptions : {}), ...flatOptions };
    const resources = exportResources(this.store, id);
    try { result = format === 'zip' ? await exportArchive(this.store, state, actor) : await this.products.get(state.artifact.type).export(state, format, options, resources); }
    catch (error) { if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new StudioError(error.code, error.message); throw error; }
    return this.store.transaction(id, current => { assertAlive(current.artifact); return saveExport(this.dataRoot, id, result); });
  }
  async getExport(exportId: string) { return getExport(this.dataRoot, exportId); }
  async close() { this.closing = true; await Promise.allSettled([...this.tasks]); this.collaboration.close(); this.thumbnails.clear(); }
}
