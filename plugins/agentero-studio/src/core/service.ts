import { LOCAL_ACTOR, TOOL_NAMES, type Actor, type Presence, type Role, type StudioEvent, type ToolName } from '../contracts/studio.js';
import { copy, safeId, StudioError, StudioStore, type ArtifactState } from './store.js';
import { assertAlive, object, requireRole, text } from './shared/common.js';
import { createArtifact, listArtifacts, manageArtifact } from './shared/artifacts.js';
import { applyMutation, historyBatches, initializeVersionClocks, mutationTargets, version } from './shared/history.js';
import { updateFeedback } from './shared/feedback.js';
import { clearExpiredProposals, feedbackVisible, previewProposal, proposalExpired, updateProposal, visibleFeedback } from './shared/proposals.js';
import { SHARE_ROLES, shareInfo, shareRole, shareAccess, sharingAccess, guestName, registerGuestName, rememberGuestNames, joinSharingMember, updateSharing, revokeSharing } from './shared/sharing.js';
import { studioProducts } from './products/index.js';
import type { ProductRegistry } from './shared/products.js';
import type { ContentOperation, Snapshot } from './shared/model.js';
import { StudioCollaboration, type SyncOptions } from './shared/collaboration.js';
import { duplicateAssets, importAsset, deleteAsset, listAssets, putAsset, getAsset, saveExport, getExport, exportResources, purgeExports, type ExportRecord } from './shared/files.js';
import { ThumbnailCache } from './shared/thumbnails.js';
import { exportArchive, importArchive as importArtifactArchive, readArchiveInput } from './shared/archive.js';
import { userInfo } from 'node:os';

export { StudioError } from './store.js';
export type { ExportRecord } from './shared/files.js';
export interface StudioAuthority { owner: boolean; actorId: string; credential?: string; viaLan: boolean }
type AuthorizationState = Pick<ArtifactState, 'artifact' | 'sharing' | 'guestNames'>;
const authorizationState = (state: Readonly<ArtifactState>): AuthorizationState => ({ artifact: state.artifact, sharing: state.sharing, guestNames: state.guestNames });
function ownerActor(name?: string): Actor {
  if (name === undefined) { try { name = userInfo().username; } catch { name = 'You'; } }
  return { ...LOCAL_ACTOR, name: text(name, 'You', 200).trim() || 'You' };
}

export class StudioService {
  private readonly thumbnails = new ThumbnailCache();
  readonly store: StudioStore;
  readonly owner: Actor;
  private readonly products: ProductRegistry;
  private readonly collaboration: StudioCollaboration;
  private tasks = new Set<Promise<unknown>>();
  private closing = false;
  private sharingOrigin = '';
  private localOrigin = '';
  private shareHandler?: (enabled: boolean) => Promise<string | undefined>;
  constructor(options: { dataRoot?: string; products?: ProductRegistry; ownerName?: string } = {}) { this.products = options.products ?? studioProducts(); this.store = new StudioStore(options.dataRoot, this.products, state => initializeVersionClocks(state, this.products.get(state.artifact.type).adapter)); this.owner = ownerActor(options.ownerName); this.collaboration = new StudioCollaboration({ dataRoot: this.store.root }); }
  get dataRoot() { return this.store.root; }
  configureSharing(handler: (enabled: boolean) => Promise<string | undefined>) { this.shareHandler = handler; }
  configureLocalOrigin(origin: string) { this.localOrigin = origin; }
  subscribe(artifactId: string, listener: (event: StudioEvent) => void): () => void { return this.collaboration.subscribe(artifactId, listener); }
  private emit(event: StudioEvent) { this.collaboration.emit(event); }
  private emitBoard(snapshot: Snapshot<unknown>, changedIds: string[]) {
    const adapter = this.products.get(snapshot.artifact.type).adapter;
    const units = [...new Set(changedIds)].map(id => ({ id, after: copy(adapter.readUnit(snapshot.content, id) ?? null) }));
    this.emit({ type: 'board', artifactId: snapshot.artifact.id, revision: snapshot.artifact.revision, changedIds, artifact: copy(snapshot.artifact), ...(Buffer.byteLength(JSON.stringify(units)) <= 128 * 1024 ? { units } : { invalidation: true }) });
  }
  private authorizedActor(state: AuthorizationState, actor: Actor, authority?: StudioAuthority): Actor {
    if (!authority) return actor;
    if (authority.actorId !== actor.id) throw new StudioError('FORBIDDEN', '请求身份与授权上下文不一致。');
    if (authority.viaLan && sharingAccess(state.sharing) !== 'lan') throw new StudioError('UNAUTHORIZED', '这块白板当前不允许局域网访问。', { reason: state.sharing.enabled ? 'local-only' : 'sharing-closed' });
    if (authority.owner) return actor.kind === 'human' && actor.id === this.owner.id ? copy(this.owner) : actor;
    const access = shareAccess(state.artifact, state.sharing, authority.credential, actor.id);
    if (!access.role) throw new StudioError('UNAUTHORIZED', '分享权限已失效。', { reason: access.reason });
    const name = guestName(state, actor.id, this.owner.name);
    if (!name) throw new StudioError('NAME_REQUIRED', '请输入你的名字后加入白板。');
    return { id: actor.id, name, kind: 'human', role: access.role };
  }
  async execute(name: ToolName, args: Record<string, unknown> = {}, actor: Actor = this.owner, authority?: StudioAuthority): Promise<any> {
    if (this.closing) throw new StudioError('CLOSED', 'Studio 服务已经关闭。');
    if (!TOOL_NAMES.includes(name)) throw new StudioError('UNKNOWN_TOOL', '不支持的 Studio 操作。');
    if (!object(args)) throw new StudioError('INVALID_ARGUMENT', '操作参数必须是对象。');
    const task = this.perform(name, args, copy(actor), authority); this.tasks.add(task);
    try { return await task; } finally { this.tasks.delete(task); }
  }
  private async perform(name: ToolName, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority): Promise<any> {
    let finish: (() => void) | undefined;
    const createsArtifact = name === 'artifact_manage' && ['create', 'import'].includes(text(args.action, 'create'));
    if (actor.kind === 'agent' && args.artifactId !== undefined && !createsArtifact) {
      const id = safeId(args.artifactId), projected = await this.store.readProjection(id, state => {
        const adapter = this.products.get(state.artifact.type).adapter;
        const ids = name === 'artifact_apply' && Array.isArray(args.operations) ? [...new Set(args.operations.flatMap(operation => object(operation) && typeof operation.op === 'string' ? mutationTargets(state.content, operation as unknown as ContentOperation, adapter) ?? this.products.get(state.artifact.type).initialIds(state.content) : []))] : [];
        return { authorization: authorizationState(state), ids };
      }), currentActor = this.authorizedActor(projected.authorization, actor, authority);
      const writing = name === 'artifact_apply' || name === 'artifact_manage' || name === 'artifact_share' && args.action !== 'status' || name === 'artifact_feedback' && !['list', 'get', 'preview'].includes(text(args.action, 'list'));
      const ids = projected.ids;
      finish = this.collaboration.beginActivity(id, currentActor, { status: writing ? 'writing' : 'reading', editingIds: writing ? ids : [], selectedIds: Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === 'string').slice(0, 200) : ids });
    }
    try { return await this.dispatch(name, args, actor, authority); }
    finally { finish?.(); }
  }
  private async dispatch(name: ToolName, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority): Promise<any> {
    if (name === 'studio_open') { if (args.artifactId) await this.store.read(safeId(args.artifactId)); return { view: args.view ?? (args.artifactId ? 'editor' : 'library'), products: this.products.catalog(), ...(args.artifactId ? { artifactId: args.artifactId } : {}) }; }
    if (name === 'artifact_list') { const result = listArtifacts(await this.store.list(), args, actor); return { ...result, artifacts: result.artifacts.map(artifact => ({ ...artifact, thumbnail: `/api/thumbnails/${artifact.id}?revision=${artifact.revision}` })) }; }
    if (name === 'artifact_manage') return this.manage(args, actor, authority);
    const id = safeId(args.artifactId);
    if (name === 'artifact_read') return this.read(id, args, actor, authority);
    if (name === 'artifact_apply') return this.apply(id, args, actor, authority);
    if (name === 'artifact_feedback') return this.feedback(id, args, actor, authority);
    if (name === 'artifact_share') return this.share(id, args, actor, authority);
    if (name === 'artifact_export') return this.export(id, args, actor, authority);
    throw new StudioError('UNKNOWN_TOOL', '不支持的 Studio 操作。');
  }
  private async manage(args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    requireRole(actor, ['owner']); const action = text(args.action, 'create');
    if (action === 'purge') return this.purge(args, actor, authority);
    if (action === 'import') return this.importArchive(await readArchiveInput(args), actor, args.title);
    if (action === 'create' || action === 'duplicate') {
      const base = action === 'duplicate' ? await this.store.read(safeId(args.artifactId)) : undefined;
      const product = this.products.get(base?.artifact.type ?? text(args.type, 'whiteboard'));
      const title = text(args.title, base ? `${base.artifact.title} 副本` : product.defaultTitle, 200);
      const content = product.create(args, base?.content); product.adapter.validate(content);
      const state = createArtifact(product.adapter.type, title, content, actor, action === 'create' ? '创建作品' : '复制作品', product.initialIds(content));
      initializeVersionClocks(state, product.adapter);
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
      return { asset: await importAsset(this.store, id, args.assetPath, actor, this.products.get(state.artifact.type).validateAsset, current => this.authorizedActor(current, actor, authority)) };
    }
    if (action === 'asset-delete') return deleteAsset(this.store, id, args.assetId, actor, current => this.authorizedActor(current, actor, authority));
    const result = await this.store.transaction(id, state => {
      const currentActor = this.authorizedActor(state, actor, authority);
      manageArtifact(state, action, args, currentActor); return { artifact: copy(state.artifact), ...this.products.get(state.artifact.type).result(state) };
    });
    this.emit({ type: 'artifact', artifactId: id, artifact: result.artifact });
    if (action === 'trash') { this.emit({ type: 'share', artifactId: id, enabled: false, reason: 'sharing-closed', revokedRoles: [...SHARE_ROLES] }); await this.shareHandler?.(false); }
    return result;
  }
  private async purge(args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    const multiple = args.artifactIds !== undefined;
    if (multiple === (args.artifactId !== undefined) || multiple && (!Array.isArray(args.artifactIds) || !args.artifactIds.length || args.artifactIds.length > 100)) throw new StudioError('INVALID_ARGUMENT', '请提供单个作品 ID，或 1 到 100 个作品 ID 的列表，两者不能同时提供。');
    const ids = [...new Set((multiple ? args.artifactIds as unknown[] : [args.artifactId]).map(id => safeId(id)))];
    const deletedIds: string[] = [], failures: { artifactId: string; code: string; message: string }[] = [];
    for (const id of ids) {
      try { await this.store.purge(id, async () => { this.authorizedActor(await this.store.read(id), actor, authority); await purgeExports(this.dataRoot, id); }); }
      catch (error) {
        failures.push({ artifactId: id, code: error instanceof StudioError ? error.code : 'PURGE_FAILED', message: error instanceof StudioError ? error.message : `永久删除未完成，可能已移除部分所属资源；请检查存储状态后重试。${error instanceof Error ? ` ${error.message}` : ''}` });
        continue;
      }
      deletedIds.push(id); this.collaboration.forget(id); this.thumbnails.delete(id);
      this.emit({ type: 'share', artifactId: id, enabled: false, reason: 'sharing-closed', revokedRoles: [...SHARE_ROLES] });
      this.emit({ type: 'purged', artifactId: id });
    }
    return { deletedIds, failures };
  }
  async importArchive(data: Uint8Array, actor: Actor = this.owner, title?: unknown) {
    if (this.closing) throw new StudioError('CLOSED', 'Studio 服务已经关闭。');
    const task = (async () => {
      const state = await importArtifactArchive(this.store, this.products, data, actor, title);
      this.emit({ type: 'artifact', artifactId: state.artifact.id, artifact: copy(state.artifact) });
      return { artifact: copy(state.artifact), ...this.products.get(state.artifact.type).result(state) };
    })();
    this.tasks.add(task); try { return await task; } finally { this.tasks.delete(task); }
  }
  private async read(id: string, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    const mode = text(args.mode, 'document');
    if (mode === 'source' && args.contextId !== undefined && args.feedbackId === undefined) args = { ...args, feedbackId: safeId(args.contextId, '反馈 ID') };
    if (mode === 'assets') requireRole(actor, ['owner']);
    if (mode === 'context') return this.store.readProjection(id, state => {
      const currentActor = this.authorizedActor(state, actor, authority);
      if (args.feedbackId || args.contextId) {
        const feedbackId = safeId(args.feedbackId ?? args.contextId, '反馈 ID'), found = state.feedback.find(item => item.id === feedbackId && feedbackVisible(item, currentActor));
        if (!found) throw new StudioError('NOT_FOUND', '反馈上下文不存在。');
        const { creationReceipt: _receipt, ...feedback } = found;
        return { contextId: feedbackId, artifact: state.artifact, feedback, sources: state.sources[feedbackId] ?? [], timer: this.getTimer(id) };
      }
      const peers = this.getPresence(id).filter(peer => !args.viewId || peer.context?.viewId === args.viewId);
      const pending = state.feedback.filter(item => item.status === 'pending' && feedbackVisible(item, currentActor)).map(({ creationReceipt: _receipt, ...feedback }) => feedback);
      return { artifactId: id, contexts: peers.flatMap(peer => peer.context ? [{ ...peer.context, actor: peer.actor, updatedAt: peer.updatedAt }] : []), pending, timer: this.getTimer(id) };
    });
    const state = await this.store.read(id), product = this.products.get(state.artifact.type);
    actor = this.authorizedActor(state, actor, authority);
    if (mode === 'assets') return listAssets(state, args, actor);
    // Filter at the shared boundary, including product-specific source readers and counts.
    // A LAN visitor cannot recover a private option by guessing its feedback/context ID.
    const hidden = state.feedback.filter(item => !feedbackVisible(item, actor));
    if (hidden.some(item => item.id === args.feedbackId || item.id === args.contextId)) throw new StudioError('NOT_FOUND', '反馈上下文不存在。');
    for (const item of hidden) delete state.sources[item.id];
    state.feedback = visibleFeedback(state.feedback, actor);
    if (mode === 'document' || mode === 'board') return product.project(state);
    if (mode === 'history') { const history = state.history.map(item => item.entry); return { history, batches: historyBatches(history) }; }
    if (mode === 'version') return product.result(version(state, args.versionId ?? args.revision));
    if (mode === 'diff') {
      const adjacent = args.adjacent === true;
      const selected = adjacent ? version(state, args.versionId ?? args.revision) : undefined;
      const before = selected ? state.history[state.history.indexOf(selected) - 1] : version(state, args.fromVersionId ?? args.from ?? args.versionId ?? args.revision);
      const after = selected ?? (args.toVersionId !== undefined || args.to !== undefined ? version(state, args.toVersionId ?? args.to) : state);
      if (args.ids !== undefined && (!Array.isArray(args.ids) || args.ids.length > 200 || args.ids.some(id => typeof id !== 'string'))) throw new StudioError('INVALID_ARGUMENT', '差异内容单元 ID 列表无效。');
      const requestedIds = args.ids as string[] | undefined;
      const units = before ? product.adapter.diff(before.content, after.content) : product.initialIds(after.content).map(id => ({ id, before: null, after: product.adapter.readUnit(after.content, id) }));
      return { ...(before ? product.diff(before, after) : { changes: units }), units: requestedIds ? units.filter(unit => requestedIds.includes(unit.id)) : units, fromRevision: before?.artifact.revision ?? null, toRevision: after.artifact.revision };
    }
    return product.read(state, mode, args);
  }
  private async apply(id: string, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    const result = await this.store.transaction(id, state => {
      const currentActor = this.authorizedActor(state, actor, authority);
      const adapter = this.products.get(state.artifact.type).adapter;
      if (currentActor.kind === 'agent' && !state.operations.some(operation => operation.id === args.operationId) && Array.isArray(args.operations)) {
        const editing = new Set(this.getPresence(id).filter(peer => peer.actor.id !== currentActor.id && ['owner', 'editor'].includes(peer.actor.role)).flatMap(peer => [...(peer.context?.editingIds ?? []), ...(Array.isArray(peer.context?.movingIds) ? peer.context.movingIds as string[] : [])]));
        const conflicts = new Set<string>();
        for (const operation of args.operations) {
          if (!object(operation) || typeof operation.op !== 'string' || !editing.size) continue;
          const targets = mutationTargets(state.content, { ...operation, op: operation.op }, adapter);
          for (const target of targets ?? editing) if (editing.has(target)) conflicts.add(target);
        }
        if (conflicts.size) throw new StudioError('EDIT_IN_PROGRESS', '目标内容正在其他视图中编辑，请等待编辑完成后重试。', { ids: [...conflicts] });
      }
      return applyMutation(state, { operationId: args.operationId, operations: args.operations as ContentOperation[], expectedRevision: args.expectedRevision, expectedVersions: args.expectedVersions, summary: args.summary, merge: args.merge }, currentActor, adapter);
    });
    const snapshot = result.snapshot;
    if (result.changed) this.emitBoard(snapshot, result.historyEntry.changedIds);
    return { ...this.products.get(snapshot.artifact.type).result(snapshot), historyEntry: result.historyEntry };
  }
  private async feedback(id: string, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    const action = text(args.action, 'list');
    if (action === 'preview') {
      const state = await this.store.read(id), product = this.products.get(state.artifact.type);
      actor = this.authorizedActor(state, actor, authority);
      const snapshot = previewProposal(state, args, actor, product.adapter);
      return { document: product.project(snapshot) };
    }
    if (action === 'list' || action === 'get') {
      let state = await this.store.read(id);
      actor = this.authorizedActor(state, actor, authority);
      if (state.feedback.some(item => proposalExpired(item))) state = await this.store.transaction(id, current => { this.authorizedActor(current, actor, authority); clearExpiredProposals(current); return copy(current); });
      const feedback = visibleFeedback(state.feedback, actor).filter(item => (args.status === undefined || item.status === args.status) && (args.feedbackId === undefined || item.id === args.feedbackId));
      if (action === 'get' && !feedback.length) throw new StudioError('NOT_FOUND', '反馈不存在。');
      return { feedback };
    }
    if (['suggest', 'choose', 'withdraw'].includes(action)) {
      const result = await this.store.transaction(id, state => updateProposal(state, args, this.authorizedActor(state, actor, authority), this.products.get(state.artifact.type).adapter));
      // SSE is a shared channel. Publish only a refresh notification, never private options.
      this.emit({ type: 'feedback', artifactId: id });
      if (result.changed && result.snapshot && result.historyEntry) this.emitBoard(result.snapshot, result.historyEntry.changedIds);
      const { snapshot, changed: _changed, ...response } = result;
      return { ...response, ...(snapshot ? this.products.get(snapshot.artifact.type).result(snapshot) : {}) };
    }
    const result = await this.store.transaction(id, state => updateFeedback(state, args, this.authorizedActor(state, actor, authority), this.products.get(state.artifact.type).adapter));
    this.emit({ type: 'feedback', artifactId: id }); return result;
  }
  private async share(id: string, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    const action = text(args.action, 'status');
    const current = await this.store.readProjection(id, authorizationState);
    actor = this.authorizedActor(current, actor, authority);
    const info = (state: AuthorizationState) => shareInfo(id, state.sharing, sharingAccess(state.sharing) === 'local' ? this.localOrigin : this.sharingOrigin, this.getPresence(id), this.owner, actor);
    if (action === 'status') return info(current);
    requireRole(actor, ['owner']);
    if (!['start', 'stop', 'reset', 'link', 'role', 'remove'].includes(action)) throw new StudioError('INVALID_ARGUMENT', '不支持的分享操作。');
    // Validate before opening LAN, and close a newly opened listener if the commit fails.
    assertAlive(current.artifact); let opened = false;
    try {
      if (action === 'start' && args.access !== undefined && args.access !== 'local' && args.access !== 'lan') throw new StudioError('INVALID_ARGUMENT', '访问范围应为 local 或 lan。');
      if (action === 'start' && args.access !== 'local') { const origin = await this.shareHandler?.(true); opened = true; if (origin) this.sharingOrigin = origin; }
      const committed = await this.store.transaction(id, state => {
        rememberGuestNames(state);
        const revoked = updateSharing(state.artifact, state.sharing, action, this.authorizedActor(state, actor, authority), args);
        return { info: info(state), ...revoked };
      });
      const revokedMembers = [...committed.revokedMemberIds, ...this.getPresence(id).filter(peer => committed.revokedRoles.includes(peer.actor.role as Exclude<Role, 'owner'>)).map(peer => peer.actor.id)];
      if (revokedMembers.length) this.collaboration.revokeMembers(id, revokedMembers);
      const reason = action === 'role' ? 'role-changed' : action === 'remove' ? 'removed' : action === 'reset' ? 'link-reset' : action === 'link' ? 'link-disabled' : action === 'start' && args.access === 'local' ? 'local-only' : 'sharing-closed';
      this.emit({ type: 'share', artifactId: id, enabled: committed.info.enabled, access: committed.info.access, reason, generation: committed.info.generation, revokedRoles: committed.revokedRoles, revokedMemberIds: committed.revokedMemberIds });
      if (action === 'stop' || action === 'start' && args.access === 'local') await this.shareHandler?.(false);
      return committed.info;
    } catch (error) { if (opened) await this.shareHandler?.(false); throw error; }
  }
  async shareRole(artifactId: string, token: string | undefined, memberId?: string): Promise<Exclude<Role, 'owner'> | undefined> {
    let state: Pick<AuthorizationState, 'artifact' | 'sharing'>; try { state = await this.store.readProjection(artifactId, state => ({ artifact: state.artifact, sharing: state.sharing })); } catch { return; }
    return shareRole(state.artifact, state.sharing, token, memberId);
  }
  async accessMode(artifactId: string, viaLan = false, allowMissing = false): Promise<'local' | 'lan'> {
    let state: Pick<AuthorizationState, 'artifact' | 'sharing'>;
    try { state = await this.store.readProjection(artifactId, state => ({ artifact: state.artifact, sharing: state.sharing })); }
    catch (error) { if (error instanceof StudioError && error.code === 'NOT_FOUND') { if (allowMissing) return 'local'; throw new StudioError('UNAUTHORIZED', '分享链接无效。', { reason: 'invalid-link' }); } throw error; }
    const access = sharingAccess(state.sharing);
    if (viaLan && access === 'local') throw new StudioError('UNAUTHORIZED', state.sharing.enabled ? '这块白板仅允许在所有者电脑上访问。' : '这块白板的分享已关闭。', { reason: state.sharing.enabled ? 'local-only' : 'sharing-closed' });
    return access;
  }
  async guestActor(artifactId: string, token: string | undefined, id: string, registration?: { name: unknown }, viaLan = false): Promise<Actor> {
    await this.accessMode(artifactId, viaLan);
    const resolve = (state: AuthorizationState) => {
      if (viaLan && sharingAccess(state.sharing) === 'local') throw new StudioError('UNAUTHORIZED', '这块白板仅允许在所有者电脑上访问。', { reason: state.sharing.enabled ? 'local-only' : 'sharing-closed' });
      const access = shareAccess(state.artifact, state.sharing, token, id);
      if (!access.role) throw new StudioError('UNAUTHORIZED', '你已无法访问这块白板，请向所有者索取有效链接。', { reason: access.reason });
      rememberGuestNames(state);
      const invitation = { title: state.artifact.title, role: access.role };
      let name: string | undefined;
      try { name = registration ? registerGuestName(state, id, registration.name, this.owner.name) : guestName(state, id, this.owner.name); }
      catch (error) { if (error instanceof StudioError) throw new StudioError(error.code, error.message, { invitation }); throw error; }
      if (!name) throw new StudioError('NAME_REQUIRED', '请输入你的名字后加入白板。', { invitation });
      return { id, name, kind: 'human' as const, role: access.role };
    };
    const state = await this.store.readProjection(artifactId, authorizationState), hadName = state.guestNames?.[id] !== undefined, actor = resolve(state), member = state.sharing.members?.[id];
    // Persist last-seen at most once a minute rather than writing on every cursor heartbeat.
    if (!registration && hadName && member && (member.ownerAssigned || member.credential === token) && member.name === actor.name && Date.now() - Date.parse(member.lastSeenAt) < 60_000) return actor;
    let roleChanged = false, joinedAccess = sharingAccess(state.sharing);
    const joined = await this.store.transaction(artifactId, current => {
      const previousRole = current.sharing.members?.[id]?.role;
      const next = resolve(current), joined = joinSharingMember(current.artifact, current.sharing, token, id, next.name);
      if (!joined) throw new StudioError('UNAUTHORIZED', '分享权限已变更，请重新连接。', { reason: shareAccess(current.artifact, current.sharing, token, id).reason });
      roleChanged = previousRole !== undefined && previousRole !== joined.role;
      joinedAccess = sharingAccess(current.sharing);
      return joined;
    });
    if (roleChanged) { this.collaboration.revokeMembers(artifactId, [id]); this.emit({ type: 'share', artifactId, enabled: true, access: joinedAccess, reason: 'role-changed', revokedMemberIds: [id] }); }
    return joined;
  }
  async hasShares() { return (await this.store.list()).some(state => state.sharing.enabled && sharingAccess(state.sharing) === 'lan' && !state.artifact.trashedAt); }
  async resetSharingSessions() {
    for (const saved of await this.store.list()) if (saved.sharing.enabled) {
      await this.store.transaction(saved.artifact.id, state => { rememberGuestNames(state); revokeSharing(state.sharing); });
      this.emit({ type: 'share', artifactId: saved.artifact.id, enabled: false, reason: 'sharing-closed', revokedRoles: [...SHARE_ROLES] });
    }
  }
  async putAsset(artifactId: string, data: Uint8Array, input: { filename?: string; mimeType?: string }, actor: Actor, authority?: StudioAuthority) { const state = await this.store.read(artifactId); return putAsset(this.store, artifactId, data, input, this.authorizedActor(state, actor, authority), this.products.get(state.artifact.type).validateAsset, current => this.authorizedActor(current, actor, authority)); }
  async getAsset(artifactId: string, assetId: string) { return getAsset(this.store, artifactId, assetId); }
  async getThumbnail(artifactId: string, actor: Actor = this.owner) {
    const state = await this.store.read(safeId(artifactId));
    if (state.artifact.trashedAt) requireRole(actor, ['owner']);
    const product = this.products.get(state.artifact.type);
    if (!product.thumbnail) throw new StudioError('NO_PREVIEW', '此产品未提供预览，请直接打开作品。');
    return this.thumbnails.get(artifactId, state.artifact.revision, () => product.thumbnail!(state, exportResources(this.store, artifactId)));
  }
  async updatePresence(artifactId: string, input: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    if (input.timer !== undefined) return this.store.withProjectionLock(artifactId, authorizationState, state => this.collaboration.update(artifactId, input, this.authorizedActor(state, actor, authority)));
    return this.collaboration.update(artifactId, input, actor, async () => this.authorizedActor(await this.store.readProjection(artifactId, authorizationState), actor, authority));
  }
  getPresence(artifactId: string): Presence[] { return this.collaboration.getPresence(artifactId); }
  getTimer(artifactId: string) { return this.collaboration.getTimer(artifactId); }
  cursor() { return this.collaboration.cursor(); }
  connectPeer(artifactId: string, peerId: string, peerEpoch: string | undefined, actor: Actor) { return this.collaboration.connectPeer(artifactId, peerId, peerEpoch, actor); }
  async sync(artifactId: string, options: SyncOptions, actor: Actor, authority?: StudioAuthority) {
    if (!artifactId) { requireRole(actor, ['owner']); if (authority && !authority.owner) throw new StudioError('FORBIDDEN', '访客不能订阅作品库。'); return { ...await this.collaboration.sync('', options, actor), actor, access: 'local' as const }; }
    const currentActor = this.authorizedActor(await this.store.readProjection(artifactId, authorizationState), actor, authority);
    const result = await this.collaboration.sync(artifactId, options, currentActor);
    const current = await this.store.readProjection(artifactId, authorizationState), confirmedActor = this.authorizedActor(current, actor, authority);
    return { ...result, actor: confirmedActor, access: sharingAccess(current.sharing) };
  }
  async room(artifactId: string, input: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) { return this.store.withProjectionLock(artifactId, authorizationState, state => this.collaboration.room(artifactId, input, this.authorizedActor(state, actor, authority))); }
  private async export(id: string, args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority): Promise<ExportRecord> {
    const state = await this.store.read(id); actor = this.authorizedActor(state, actor, authority); assertAlive(state.artifact); const format = text(args.format, 'json', 20).toLowerCase();
    let result;
    const { artifactId: _artifactId, format: _format, options: nestedOptions, ...flatOptions } = args;
    const options = { ...(object(nestedOptions) ? nestedOptions : {}), ...flatOptions };
    const resources = exportResources(this.store, id);
    try { result = format === 'zip' ? await exportArchive(this.store, state, actor) : await this.products.get(state.artifact.type).export(state, format, options, resources); }
    catch (error) { if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new StudioError(error.code, error.message); throw error; }
    return this.store.transaction(id, current => { this.authorizedActor(current, actor, authority); assertAlive(current.artifact); return saveExport(this.dataRoot, id, result); });
  }
  async getExport(exportId: string) { return getExport(this.dataRoot, exportId); }
  async close() { this.closing = true; await Promise.allSettled([...this.tasks]); this.collaboration.close(); this.thumbnails.clear(); }
}
