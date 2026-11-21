import {
  STUDIO_TOOLS,
  LOCAL_ACTOR,
  TOOL_NAMES,
  type Actor,
  type AgentTaskBinding,
  type Board,
  type Presence,
  type Role,
  type StudioEvent,
  type StudioUnitEvent,
  type ToolName,
} from '../contracts/studio.js';
import { copy, safeId, StudioError, StudioStore, type ArtifactState } from './store.js';
import { assertAlive, object, requireRole, text } from './shared/common.js';
import {
  assertWorkspaceMutation,
  taskBinding,
  workspaceReadRelated,
} from './shared/agent-workspaces.js';
import type { WhiteboardContent } from './products/whiteboard.js';
import { createArtifact, listArtifacts, manageArtifact } from './shared/artifacts.js';
import { readLegacyArtifact, trashLegacyArtifact } from './shared/legacy-artifacts.js';
import {
  applyMutation,
  historyBatches,
  initializeVersionClocks,
  mutationTargets,
  version,
} from './shared/history.js';
import { updateFeedback } from './shared/feedback.js';
import {
  clearExpiredProposals,
  feedbackVisible,
  previewProposal,
  proposalExpired,
  updateProposal,
  visibleFeedback,
} from './shared/proposals.js';
import {
  SHARE_ROLES,
  shareInfo,
  shareRole,
  shareAccess,
  sharingAccess,
  guestName,
  registerGuestName,
  rememberGuestNames,
  joinSharingMember,
  updateSharing,
  revokeSharing,
} from './shared/sharing.js';
import { studioProducts } from './products/index.js';
import type { ProductRegistry } from './shared/products.js';
import type { ContentOperation, Snapshot } from './shared/model.js';
import { StudioCollaboration, type SyncOptions } from './shared/collaboration.js';
import {
  duplicateAssets,
  importAsset,
  deleteAsset,
  listAssets,
  putAsset,
  getAsset,
  saveExport,
  getExport,
  exportResources,
  purgeExports,
} from './shared/files.js';
import { ThumbnailCache } from './shared/thumbnails.js';
import {
  exportArchive,
  importArchive as importArtifactArchive,
  readArchiveInput,
} from './shared/archive.js';
import { userInfo } from 'node:os';
import { debuglog } from 'node:util';
import { jsonEqual } from './shared/safe-merge.js';
import { createHash } from 'node:crypto';
import {
  boundedModelRequest,
  boundedModelResult,
  MODEL_MAX_IDS,
  MODEL_MAX_ITEMS,
  modelDataBudget,
  modelDataFits,
  modelElement,
  modelFeedbackItem,
  modelPage,
  modelPageResult,
  modelResponseParts,
  modelSource,
  modelSourcePage,
  modelUnit,
} from './shared/model-read.js';
import { queryWhiteboard, type WhiteboardQueryOptions } from './products/whiteboard-query.js';
import type { CaptureRect, SavedRegionCapture } from './products/scoped-capture.js';

export { StudioError } from './store.js';
export type { ExportRecord } from './shared/files.js';

export interface StudioAuthority {
  owner: boolean;
  actorId: string;
  credential?: string;
  grantId?: string;
  viaLan: boolean;
}
type AuthorizationState = Pick<ArtifactState, 'artifact' | 'sharing' | 'guestNames'>;
type ReadProduct = ReturnType<ProductRegistry['get']>;

const debug = debuglog('agentero-studio');
const authorizationState = (state: Readonly<ArtifactState>): AuthorizationState => ({
  artifact: state.artifact,
  sharing: state.sharing,
  guestNames: state.guestNames,
});

function requestedUnitIds(input: unknown): input is string[] {
  return Array.isArray(input) && input.length <= 200 && input.every((id) => typeof id === 'string');
}

function findRevision(
  state: Readonly<ArtifactState>,
  revision: unknown,
): Snapshot<unknown> | undefined {
  if (state.artifact.revision === revision) {
    return state;
  }

  return state.history.find((saved) => saved.artifact.revision === revision);
}

function ownerActor(name?: string): Actor {
  if (name === undefined) {
    try {
      name = userInfo().username;
    } catch (error) {
      debug(
        'Cannot read the local owner name (%s).',
        error instanceof Error ? error.name : typeof error,
      );
      name = 'You';
    }
  }

  return { ...LOCAL_ACTOR, name: text(name, 'You', 200).trim() || 'You' };
}

function boardUnitVersion(unit: StudioUnitEvent): unknown {
  if (unit.patch) {
    return unit.patch.version;
  }
  if (unit.after === null) {
    return 0;
  }

  return object(unit.after) ? unit.after.version : undefined;
}

function proposalReceiptExists(
  state: Pick<ArtifactState, 'feedback'>,
  args: Record<string, unknown>,
) {
  return state.feedback.some(
    (item) =>
      item.id === args.feedbackId &&
      item.proposal?.receipts.some((receipt) => receipt.id === args.operationId),
  );
}

function proposalWritesContent(
  action: unknown,
  args: Record<string, unknown>,
  active: boolean | undefined,
) {
  if (action === 'choose') {
    return true;
  }

  return action === 'withdraw' && args.optionId !== undefined && active;
}

function sharingChangeReason(action: string, localStart: boolean): string {
  switch (action) {
    case 'restore':
      return 'access-restored';
    case 'role':
      return 'role-changed';
    case 'remove':
    case 'forget':
      return 'removed';
    case 'reset':
      return 'link-reset';
    case 'link':
      return 'link-disabled';
    default:
      return localStart ? 'local-only' : 'sharing-closed';
  }
}

function activityReadTargets(result: unknown): string[] {
  if (!object(result)) {
    return [];
  }

  const targets = new Set<string>();
  for (const key of ['elements', 'items', 'units']) {
    if (!Array.isArray(result[key])) {
      continue;
    }

    for (const item of result[key]) {
      if (object(item) && typeof item.id === 'string') {
        targets.add(item.id);
      }
    }
  }

  if (typeof result.regionId === 'string') {
    targets.add(result.regionId);
  }
  if (typeof result.elementId === 'string') {
    targets.add(result.elementId);
  }
  if (object(result.element) && typeof result.element.id === 'string') {
    targets.add(result.element.id);
  }

  return [...targets];
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
  constructor(options: { dataRoot?: string; products?: ProductRegistry; ownerName?: string } = {}) {
    this.products = options.products ?? studioProducts();
    this.store = new StudioStore(options.dataRoot, this.products, (state) =>
      initializeVersionClocks(state, this.products.get(state.artifact.type).adapter),
    );
    this.owner = ownerActor(options.ownerName);
    this.collaboration = new StudioCollaboration({ dataRoot: this.store.root });
  }
  get dataRoot() {
    return this.store.root;
  }
  configureSharing(handler: (enabled: boolean) => Promise<string | undefined>) {
    this.shareHandler = handler;
  }
  configureLocalOrigin(origin: string) {
    this.localOrigin = origin;
  }
  subscribe(artifactId: string, listener: (event: StudioEvent) => void): () => void {
    return this.collaboration.subscribe(artifactId, listener);
  }
  private emit(event: StudioEvent) {
    this.collaboration.emit(event);
  }
  private boardUnits(
    snapshot: Snapshot<unknown>,
    changedIds: string[],
    before?: unknown,
  ): StudioUnitEvent[] {
    const adapter = this.products.get(snapshot.artifact.type).adapter;
    const ids = new Set(changedIds);
    const whiteboard = snapshot.artifact.type === 'whiteboard';
    const shouldCheckOrder = before !== undefined && whiteboard && !ids.has('$order');
    if (
      shouldCheckOrder &&
      !jsonEqual(adapter.readUnit(before, '$order'), adapter.readUnit(snapshot.content, '$order'))
    ) {
      ids.add('$order');
    }

    return [...ids].map((id) => {
      const after = adapter.readUnit(snapshot.content, id) ?? null;
      const previous = before === undefined ? null : adapter.readUnit(before, id);
      const full = { id, after: copy(after) };
      const canPatch = whiteboard && !id.startsWith('$');
      if (!canPatch || !object(previous) || !object(after)) {
        return full;
      }

      const sameUnit = previous.id === id && after.id === id && previous.type === after.type;
      const versioned =
        Number.isSafeInteger(previous.version) && Number.isSafeInteger(after.version);

      if (!sameUnit || !versioned) {
        return full;
      }

      const changes: Record<string, unknown> = {};
      const removedKeys: string[] = [];
      for (const key of new Set([...Object.keys(previous), ...Object.keys(after)])) {
        if (['id', 'type', 'version'].includes(key) || jsonEqual(previous[key], after[key])) {
          continue;
        }

        if (after[key] === undefined) {
          removedKeys.push(key);
        } else {
          changes[key] = copy(after[key]);
        }
      }

      const compact = {
        id,
        patch: {
          baseVersion: Number(previous.version),
          version: Number(after.version),
          changes,
          removedKeys,
        },
      };

      return Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full))
        ? compact
        : full;
    });
  }
  private emitBoard(
    snapshot: Snapshot<unknown>,
    changedIds: string[],
    units = this.boardUnits(snapshot, changedIds),
    operationId?: string,
    actorId?: string,
  ) {
    const unitVersions = Object.fromEntries(
      units.flatMap((unit) => {
        if (unit.id.startsWith('$')) {
          return [];
        }

        const version = boardUnitVersion(unit);

        return Number.isSafeInteger(version) ? [[unit.id, Number(version)]] : [];
      }),
    );
    this.emit({
      type: 'board',
      artifactId: snapshot.artifact.id,
      revision: snapshot.artifact.revision,
      ...(operationId ? { operationId, actorId } : {}),
      changedIds: [...new Set([...changedIds, ...units.map((unit) => unit.id)])],
      unitVersions,
      artifact: copy(snapshot.artifact),
      ...(Buffer.byteLength(JSON.stringify(units)) <= 128 * 1024
        ? { units }
        : { invalidation: true }),
    });
  }
  private authorizedActor(
    state: AuthorizationState,
    actor: Actor,
    authority?: StudioAuthority,
  ): Actor {
    if (!authority) {
      return actor;
    }
    if (authority.actorId !== actor.id) {
      throw new StudioError('FORBIDDEN', '请求身份与授权上下文不一致。');
    }
    if (authority.viaLan && sharingAccess(state.sharing) !== 'lan') {
      throw new StudioError('UNAUTHORIZED', '这块白板当前不允许局域网访问。', {
        reason: state.sharing.enabled ? 'local-only' : 'sharing-closed',
      });
    }
    if (authority.owner) {
      return actor.kind === 'human' && actor.id === this.owner.id ? copy(this.owner) : actor;
    }

    const access = shareAccess(state.artifact, state.sharing, authority.credential, actor.id);
    if (!access.role) {
      throw new StudioError('UNAUTHORIZED', '分享权限已失效。', { reason: access.reason });
    }
    if (state.sharing.members?.[actor.id]?.grantId !== authority.grantId) {
      throw new StudioError('UNAUTHORIZED', '访问权限已更新，请重新打开白板。', {
        reason: 'invalid-link',
      });
    }

    const name = guestName(state, actor.id, this.owner.name);
    if (!name) {
      throw new StudioError('NAME_REQUIRED', '请输入你的名字后加入白板。');
    }

    return { id: actor.id, name, kind: 'human', role: access.role };
  }
  async execute(
    name: ToolName,
    args: Record<string, unknown> = {},
    actor: Actor = this.owner,
    authority?: StudioAuthority,
  ): Promise<any> {
    if (this.closing) {
      throw new StudioError('CLOSED', 'Studio 服务已经关闭。');
    }
    if (!TOOL_NAMES.includes(name)) {
      throw new StudioError('UNKNOWN_TOOL', '不支持的 Studio 操作。');
    }
    if (!object(args)) {
      throw new StudioError('INVALID_ARGUMENT', '操作参数必须是对象。');
    }

    const request = actor.kind === 'agent' ? boundedModelRequest(name, args) : args;
    const task = this.perform(name, request, copy(actor), authority);
    this.tasks.add(task);
    try {
      const result = await task;
      if (actor.kind !== 'agent') {
        return result;
      }

      const { data, image } = modelResponseParts(name, request, result);
      const response = boundedModelResult(name, request, data);

      return image && object(response) ? { ...response, image } : response;
    } finally {
      this.tasks.delete(task);
    }
  }
  private async perform(
    name: ToolName,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ): Promise<any> {
    const binding = name === STUDIO_TOOLS.activity ? undefined : taskBinding(args);
    const isManagement = name === STUDIO_TOOLS.manage;
    const createsArtifact =
      isManagement && ['create', 'import'].includes(text(args.action, 'create'));
    const isAgentRequest = actor.kind === 'agent' && args.artifactId !== undefined;
    const managesLegacy =
      isAgentRequest && isManagement && ['trash', 'purge'].includes(text(args.action));
    const legacy =
      managesLegacy && (await readLegacyArtifact(this.dataRoot, safeId(args.artifactId)));
    const trackActivity = isAgentRequest && name !== STUDIO_TOOLS.activity && !createsArtifact;
    let activity: ReturnType<StudioService['beginAgentActivity']> | undefined;
    if (trackActivity && !legacy) {
      const id = safeId(args.artifactId);
      const projected = await this.store.readProjection(id, (state) =>
        this.agentActivityProjection(state, name, args),
      );
      activity = this.beginAgentActivity(id, name, args, actor, authority, binding, projected);
    }

    try {
      const result = await this.dispatch(name, args, actor, authority);
      const refreshWorkspace =
        actor.kind === 'agent' && name === STUDIO_TOOLS.read && !activity?.replay;

      if (refreshWorkspace && binding) {
        const targetIds = activityReadTargets(result);
        const id = safeId(args.artifactId);
        const current = await this.store.readProjection(id, (state) => ({
          authorization: authorizationState(state),
          type: state.artifact.type,
          content: state.content,
        }));
        const currentActor = this.authorizedActor(current.authorization, actor, authority);
        if (current.type === 'whiteboard') {
          this.refreshAgentWorkspace(
            id,
            currentActor,
            binding,
            current.content as WhiteboardContent,
            targetIds,
          );
        }
      }

      return result;
    } finally {
      activity?.finish?.();
    }
  }
  private agentActivityProjection(
    state: Readonly<ArtifactState>,
    name: ToolName,
    args: Record<string, unknown>,
  ) {
    const product = this.products.get(state.artifact.type);
    const appliesContent = name === STUDIO_TOOLS.apply;
    const updatesFeedback = name === STUDIO_TOOLS.feedback;
    const ids =
      appliesContent && Array.isArray(args.operations)
        ? [
            ...new Set(
              args.operations.flatMap((operation) => {
                if (!object(operation) || typeof operation.op !== 'string') {
                  return [];
                }

                return (
                  mutationTargets(
                    state.content,
                    operation as unknown as ContentOperation,
                    product.adapter,
                  ) ?? product.initialIds(state.content)
                );
              }),
            ),
          ]
        : [];
    const replayedOperation =
      appliesContent && state.operations.some((operation) => operation.id === args.operationId);
    const replayedProposal =
      updatesFeedback &&
      ['choose', 'withdraw'].includes(text(args.action, '')) &&
      proposalReceiptExists(state, args);
    const option = updatesFeedback
      ? state.feedback
          .find((item) => item.id === args.feedbackId)
          ?.proposal?.options.find((item) => item.id === args.optionId)
      : undefined;
    const writesProposal =
      updatesFeedback && proposalWritesContent(args.action, args, option?.active);
    const requiresTask = state.artifact.type === 'whiteboard' && (appliesContent || writesProposal);

    return {
      authorization: authorizationState(state),
      ids,
      replay: replayedOperation || replayedProposal,
      requiresTask,
    };
  }
  private beginAgentActivity(
    id: string,
    name: ToolName,
    args: Record<string, unknown>,
    actor: Actor,
    authority: StudioAuthority | undefined,
    binding: AgentTaskBinding | undefined,
    projected: ReturnType<StudioService['agentActivityProjection']>,
  ) {
    const currentActor = this.authorizedActor(projected.authorization, actor, authority);
    if (projected.replay) {
      return { replay: true };
    }

    if (projected.requiresTask && !binding) {
      taskBinding(args, true);
    }
    if (binding) {
      this.collaboration.assertTask(id, currentActor, binding);
    }

    const changesArtifact = name === STUDIO_TOOLS.apply || name === STUDIO_TOOLS.manage;
    const changesSharing = name === STUDIO_TOOLS.share && args.action !== 'status';
    const changesFeedback =
      name === STUDIO_TOOLS.feedback &&
      !['list', 'get', 'preview'].includes(text(args.action, 'list'));
    const writing = changesArtifact || changesSharing || changesFeedback;
    const { ids } = projected;

    return {
      replay: false,
      finish: this.collaboration.beginActivity(id, currentActor, {
        status: writing ? 'writing' : 'reading',
        editingIds: writing ? ids : [],
        selectedIds: Array.isArray(args.ids)
          ? args.ids.filter((id): id is string => typeof id === 'string').slice(0, 200)
          : ids,
        ...(binding ? { binding } : {}),
      }),
    };
  }
  private refreshAgentWorkspace(
    id: string,
    actor: Actor,
    binding: AgentTaskBinding,
    content: WhiteboardContent,
    targetIds: string[],
  ) {
    let task;
    try {
      task = this.collaboration.assertTask(id, actor, binding);
    } catch (error) {
      if (error instanceof StudioError && error.code === 'TASK_STALE') {
        return;
      }

      throw error;
    }

    if (workspaceReadRelated(task.scope, content.elements, targetIds)) {
      this.collaboration.touchTask(id, actor, binding);
    }
  }
  private async dispatch(
    name: ToolName,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ): Promise<any> {
    if (name === STUDIO_TOOLS.open) {
      if (args.artifactId) {
        await this.store.readProjection(safeId(args.artifactId), (state) => state.artifact);
      }

      return {
        view: args.view ?? (args.artifactId ? 'editor' : 'library'),
        products: this.products.catalog(),
        ...(args.artifactId ? { artifactId: args.artifactId } : {}),
      };
    }
    if (name === STUDIO_TOOLS.list) {
      const catalog = await this.store.catalog();
      if (actor.kind === 'agent') {
        const stamp = createHash('sha256')
          .update(
            JSON.stringify(
              catalog.map((artifact) => [
                artifact.id,
                artifact.revision,
                artifact.updatedAt,
                artifact.trashedAt,
                artifact.pinned,
              ]),
            ),
          )
          .digest('base64url');
        const page = modelPage(args, 'catalog', stamp);
        const { artifacts, nextCursor } = listArtifacts(
          catalog,
          { ...args, cursor: String(page.offset) },
          actor,
        );

        return modelPageResult(
          args,
          page,
          { artifacts, nextOffset: nextCursor === undefined ? undefined : Number(nextCursor) },
          'artifacts',
          name,
        );
      }

      const result = listArtifacts(catalog, args, actor);

      return {
        ...result,
        artifacts: result.artifacts.map((artifact) =>
          artifact.storageStatus === 'unsupported'
            ? artifact
            : {
                ...artifact,
                thumbnail: `/api/thumbnails/${artifact.id}?revision=${artifact.revision}`,
              },
        ),
      };
    }
    if (name === STUDIO_TOOLS.manage) {
      return this.manage(args, actor, authority);
    }

    const id = safeId(args.artifactId);
    if (name === STUDIO_TOOLS.read) {
      return this.read(id, args, actor, authority);
    }
    if (name === STUDIO_TOOLS.activity) {
      return this.activity(id, args, actor, authority);
    }
    if (name === STUDIO_TOOLS.apply) {
      return this.apply(id, args, actor, authority);
    }
    if (name === STUDIO_TOOLS.feedback) {
      return this.feedback(id, args, actor, authority);
    }
    if (name === STUDIO_TOOLS.share) {
      return this.share(id, args, actor, authority);
    }
    if (name === STUDIO_TOOLS.export) {
      return this.export(id, args, actor, authority);
    }

    throw new StudioError('UNKNOWN_TOOL', '不支持的 Studio 操作。');
  }
  private async manage(args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    requireRole(actor, ['owner']);
    const action = text(args.action, 'create');
    if (action === 'purge') {
      return this.purge(args, actor, authority);
    }
    if (action === 'import') {
      return this.importArchive(await readArchiveInput(args), actor, args.title);
    }

    if (action === 'create' || action === 'duplicate') {
      const base =
        action === 'duplicate'
          ? await this.store.readProjection(safeId(args.artifactId), (state) => ({
              artifact: state.artifact,
              content: state.content,
              assets: state.assets,
            }))
          : undefined;
      const product = this.products.get(base?.artifact.type ?? text(args.type, 'whiteboard'));
      const title = text(
        args.title,
        base ? `${base.artifact.title} 副本` : product.defaultTitle,
        200,
      );
      const content = product.create(args, base?.content);
      product.adapter.validate(content);
      const state = createArtifact(
        product.adapter.type,
        title,
        content,
        actor,
        action === 'create' ? '创建作品' : '复制作品',
        product.initialIds(content),
      );
      initializeVersionClocks(state, product.adapter);
      const id = state.artifact.id;
      if (base) {
        product.rewriteAssetReferences?.(state.content, base.artifact.id, id);
        state.assets = copy(base.assets);
        state.history[0]!.content = copy(state.content);
        await duplicateAssets(this.store, base.artifact.id, id);
      }

      await this.store.write(state);
      this.emit({ type: 'artifact', artifactId: id, artifact: copy(state.artifact) });

      return { artifact: copy(state.artifact), ...product.result(state) };
    }

    const id = safeId(args.artifactId);
    if (action === 'trash' && (await readLegacyArtifact(this.dataRoot, id))) {
      this.authorizeLegacyManagement(actor, authority);
      const artifact = await trashLegacyArtifact(this.dataRoot, id, args.expectedRevision);
      this.collaboration.forget(id);
      this.thumbnails.delete(id);
      this.emit({ type: 'artifact', artifactId: id, artifact });

      return { artifact };
    }
    if (action === 'asset-import') {
      const artifact = await this.store.readProjection(id, (state) => state.artifact);
      assertAlive(artifact);

      return {
        asset: await importAsset(
          this.store,
          id,
          args.assetPath,
          actor,
          this.products.get(artifact.type).validateAsset,
          (current) => this.authorizedActor(current, actor, authority),
        ),
      };
    }
    if (action === 'asset-delete') {
      return deleteAsset(this.store, id, args.assetId, actor, (current) =>
        this.authorizedActor(current, actor, authority),
      );
    }

    const result = await this.store.transaction(id, (state) => {
      const currentActor = this.authorizedActor(state, actor, authority);
      manageArtifact(state, action, args, currentActor);

      return {
        artifact: copy(state.artifact),
        ...this.products.get(state.artifact.type).result(state),
      };
    });
    this.emit({ type: 'artifact', artifactId: id, artifact: result.artifact });
    if (action === 'trash') {
      this.emit({
        type: 'share',
        artifactId: id,
        enabled: false,
        reason: 'sharing-closed',
        revokedRoles: [...SHARE_ROLES],
      });
      await this.shareHandler?.(false);
    }

    return result;
  }
  private async purge(args: Record<string, unknown>, actor: Actor, authority?: StudioAuthority) {
    const multiple = args.artifactIds !== undefined;
    const hasSingle = args.artifactId !== undefined;
    const validBatch =
      Array.isArray(args.artifactIds) &&
      args.artifactIds.length > 0 &&
      args.artifactIds.length <= 100;

    if (multiple === hasSingle || (multiple && !validBatch)) {
      throw new StudioError(
        'INVALID_ARGUMENT',
        '请提供单个作品 ID，或 1 到 100 个作品 ID 的列表，两者不能同时提供。',
      );
    }

    const ids = [
      ...new Set(
        (multiple ? (args.artifactIds as unknown[]) : [args.artifactId]).map((id) => safeId(id)),
      ),
    ];
    const deletedIds: string[] = [];
    const failures: { artifactId: string; code: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.store.purge(id, async () => {
          if (await readLegacyArtifact(this.dataRoot, id)) {
            this.authorizeLegacyManagement(actor, authority);
          } else {
            this.authorizedActor(await this.store.read(id), actor, authority);
          }

          await purgeExports(this.dataRoot, id);
        });
      } catch (error) {
        failures.push({
          artifactId: id,
          code: error instanceof StudioError ? error.code : 'PURGE_FAILED',
          message:
            error instanceof StudioError
              ? error.message
              : `永久删除未完成，可能已移除部分所属资源；请检查存储状态后重试。${error instanceof Error ? ` ${error.message}` : ''}`,
        });
        continue;
      }

      deletedIds.push(id);
      this.collaboration.forget(id);
      this.thumbnails.delete(id);
      this.emit({
        type: 'share',
        artifactId: id,
        enabled: false,
        reason: 'sharing-closed',
        revokedRoles: [...SHARE_ROLES],
      });
      this.emit({ type: 'purged', artifactId: id });
    }

    return { deletedIds, failures };
  }
  private authorizeLegacyManagement(actor: Actor, authority?: StudioAuthority): void {
    requireRole(actor, ['owner']);
    if (!authority) {
      return;
    }
    if (!authority.owner || authority.actorId !== actor.id || authority.viaLan) {
      throw new StudioError('FORBIDDEN', '仅本机房主可以回收不受支持的旧版作品。');
    }
  }
  async importArchive(data: Uint8Array, actor: Actor = this.owner, title?: unknown) {
    if (this.closing) {
      throw new StudioError('CLOSED', 'Studio 服务已经关闭。');
    }

    const task = (async () => {
      const state = await importArtifactArchive(this.store, this.products, data, actor, title);
      this.emit({
        type: 'artifact',
        artifactId: state.artifact.id,
        artifact: copy(state.artifact),
      });

      return {
        artifact: copy(state.artifact),
        ...this.products.get(state.artifact.type).result(state),
      };
    })();
    this.tasks.add(task);
    try {
      return await task;
    } finally {
      this.tasks.delete(task);
    }
  }
  private async read(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    const mode = text(args.mode, 'document');
    const model = actor.kind === 'agent';
    if (mode === 'layout-preview' || mode === 'layout-cancel') {
      throw new StudioError('INVALID_ARGUMENT', '自动布局功能已移除。');
    }
    if (mode === 'units') {
      return this.store.readProjection(id, (current) => {
        this.authorizedActor(current, actor, authority);
        if (!requestedUnitIds(args.ids) || !args.ids.length) {
          throw new StudioError('INVALID_ARGUMENT', '请提供 1 到 200 个内容单元 ID。');
        }
        if (!Number.isSafeInteger(args.atRevision) || Number(args.atRevision) < 0) {
          throw new StudioError('INVALID_ARGUMENT', '精确补读需要有效的作品版本。');
        }

        const snapshot = findRevision(current, args.atRevision);
        if (!snapshot) {
          throw new StudioError(
            'VERSION_NOT_FOUND',
            '该同步版本已不在保留历史中，请重新读取作品。',
          );
        }

        const adapter = this.products.get(current.artifact.type).adapter;
        const units = [...new Set(args.ids)].map((unitId) => ({
          id: unitId,
          after: copy(adapter.readUnit(snapshot.content, unitId) ?? null),
        }));

        return { artifact: copy(snapshot.artifact), units: model ? units.map(modelUnit) : units };
      });
    }

    if (mode === 'source' && args.contextId !== undefined && args.feedbackId === undefined) {
      args = { ...args, feedbackId: safeId(args.contextId, '反馈 ID') };
    }
    if (mode === 'assets') {
      requireRole(actor, ['owner']);
    }
    if (mode === 'context') {
      return this.store.readProjection(id, (state) => {
        const currentActor = this.authorizedActor(state, actor, authority);
        if (args.feedbackId || args.contextId) {
          const feedbackId = safeId(args.feedbackId ?? args.contextId, '反馈 ID');
          const found = state.feedback.find(
            (item) => item.id === feedbackId && feedbackVisible(item, currentActor),
          );

          if (!found) {
            throw new StudioError('NOT_FOUND', '反馈上下文不存在。');
          }

          const { creationReceipt: _receipt, ...feedback } = found;
          const sources = state.sources[feedbackId] ?? [];
          const metadata = {
            contextId: feedbackId,
            artifact: state.artifact,
            feedback,
            timer: this.getTimer(id),
          };

          if (!model) {
            return { ...metadata, sources };
          }

          const page = modelPage(args, id, state.artifact.revision);
          const end = page.offset + page.limit;

          return modelPageResult(
            args,
            page,
            {
              ...metadata,
              feedback: modelFeedbackItem(feedback),
              sources: sources.slice(page.offset, end).map(modelSource),
              totalCount: sources.length,
              ...(end < sources.length ? { nextOffset: end } : {}),
            },
            'sources',
          );
        }

        const peers = this.getPresence(id).filter(
          (peer) => !args.viewId || peer.context?.viewId === args.viewId,
        );
        const pending = state.feedback
          .filter((item) => item.status === 'pending' && feedbackVisible(item, currentActor))
          .map(({ creationReceipt: _receipt, ...feedback }) => feedback);
        const contexts = peers.flatMap((peer) =>
          peer.context ? [{ ...peer.context, actor: peer.actor, updatedAt: peer.updatedAt }] : [],
        );

        if (model) {
          return {
            artifactId: id,
            contexts: contexts.slice(0, MODEL_MAX_ITEMS).map((context) => ({
              artifactId: context.artifactId,
              viewId: context.viewId,
              actor: context.actor,
              updatedAt: context.updatedAt,
              viewport: context.viewport,
              selectedIds: context.selectedIds.slice(0, MODEL_MAX_IDS),
              selectedCount: context.selectedIds.length,
            })),
            pendingCount: pending.length,
            timer: this.getTimer(id),
          };
        }

        return { artifactId: id, contexts, pending, timer: this.getTimer(id) };
      });
    }

    return this.store.readProjection(id, (current) => {
      const product = this.products.get(current.artifact.type);
      const currentActor = this.authorizedActor(current, actor, authority);
      if (mode === 'assets') {
        if (!model) {
          return listAssets(current, args, currentActor);
        }

        const stamp = createHash('sha256')
          .update(JSON.stringify([current.artifact.revision, Object.keys(current.assets)]))
          .digest('base64url');
        const page = modelPage(args, id, stamp);

        return modelPageResult(
          args,
          page,
          listAssets(current, { ...args, offset: page.offset }, currentActor),
          'assets',
        );
      }

      const state = this.readableArtifact(current, currentActor, args, mode, model);
      if (mode === 'document' || mode === 'board') {
        return product.project(state);
      }
      if (mode === 'history') {
        return this.readHistory(state, id, args, model);
      }
      if (mode === 'version') {
        return product.result(version(state, args.versionId ?? args.revision));
      }
      if (mode === 'diff') {
        return this.readDiff(state, product, args, model);
      }
      if (!model) {
        return product.read(state, mode, args);
      }

      return this.readModelContent(id, state, product, mode, args);
    });
  }
  private readableArtifact(
    current: Readonly<ArtifactState>,
    actor: Actor,
    args: Record<string, unknown>,
    mode: string,
    model: boolean,
  ): ArtifactState {
    const hidden = current.feedback.filter((item) => !feedbackVisible(item, actor));
    if (hidden.some((item) => item.id === args.feedbackId || item.id === args.contextId)) {
      throw new StudioError('NOT_FOUND', '反馈上下文不存在。');
    }

    const sources = { ...current.sources };
    for (const item of hidden) {
      delete sources[item.id];
    }

    const scoped = { ...current, sources, feedback: visibleFeedback(current.feedback, actor) };
    const revisionedMode = [
      'summary',
      'objects',
      'blocks',
      'tasks',
      'source',
      'search',
      'region',
    ].includes(mode);

    if (!model || args.atRevision === undefined || !revisionedMode) {
      return scoped;
    }

    const snapshot = findRevision(current, args.atRevision);
    if (!snapshot) {
      throw new StudioError('VERSION_NOT_FOUND', '该读取修订已不在保留历史中，请指定可用版本。');
    }

    return {
      ...scoped,
      artifact: snapshot.artifact,
      content: snapshot.content,
      ...(mode === 'source'
        ? {
            history: scoped.history.filter(
              (saved) => saved.artifact.revision <= snapshot.artifact.revision,
            ),
          }
        : {}),
    };
  }
  private readHistory(
    state: Readonly<ArtifactState>,
    id: string,
    args: Record<string, unknown>,
    model: boolean,
  ) {
    if (!model) {
      const history = state.history.map((item) => item.entry);

      return { history, batches: historyBatches(history) };
    }

    const page = modelPage(args, id, state.artifact.revision);
    const end = Math.max(0, state.history.length - page.offset);
    const start = Math.max(0, end - page.limit);
    const selection = state.history
      .slice(start, end)
      .reverse()
      .map(({ entry }) => ({
        ...entry,
        ...(entry.changedIds.length > MODEL_MAX_IDS
          ? {
              changedIds: entry.changedIds.slice(0, MODEL_MAX_IDS),
              changedCount: entry.changedIds.length,
            }
          : {}),
      }));
    const result = modelPageResult(
      args,
      page,
      {
        artifact: state.artifact,
        history: selection,
        totalCount: state.history.length,
        ...(start > 0 ? { nextOffset: page.offset + selection.length } : {}),
      },
      'history',
    );
    const history = selection.slice(0, (result.history as unknown[]).length).reverse();
    const grouped = { ...result, history, batches: historyBatches(history) };

    return modelDataFits(grouped, modelDataBudget(STUDIO_TOOLS.read, args))
      ? grouped
      : { ...result, history };
  }
  private diffSnapshots(state: Readonly<ArtifactState>, args: Record<string, unknown>) {
    if (args.adjacent === true) {
      const after = version(state, args.versionId ?? args.revision);

      return { before: state.history[state.history.indexOf(after) - 1], after };
    }

    const before = version(
      state,
      args.fromVersionId ?? args.from ?? args.versionId ?? args.revision,
    );
    const after =
      args.toVersionId !== undefined || args.to !== undefined
        ? version(state, args.toVersionId ?? args.to)
        : state;

    return { before, after };
  }
  private readDiff(
    state: Readonly<ArtifactState>,
    product: ReadProduct,
    args: Record<string, unknown>,
    model: boolean,
  ) {
    const { before, after } = this.diffSnapshots(state, args);
    const requestedIds = args.ids;
    if (requestedIds !== undefined && !requestedUnitIds(requestedIds)) {
      throw new StudioError('INVALID_ARGUMENT', '差异内容单元 ID 列表无效。');
    }

    const fromRevision = before?.artifact.revision ?? null;
    const toRevision = after.artifact.revision;
    if (model && requestedIds) {
      const units = [...new Set(requestedIds)].flatMap((unitId) => {
        const previous = before ? (product.adapter.readUnit(before.content, unitId) ?? null) : null;
        const current = product.adapter.readUnit(after.content, unitId) ?? null;

        return jsonEqual(previous, current)
          ? []
          : [modelUnit({ id: unitId, before: previous, after: current })];
      });

      return { units, fromRevision, toRevision };
    }

    const units = before
      ? product.adapter.diff(before.content, after.content)
      : product.initialIds(after.content).map((id) => ({
          id,
          before: null,
          after: product.adapter.readUnit(after.content, id),
        }));

    return {
      ...(before ? product.diff(before, after) : { changes: units }),
      units: requestedIds ? units.filter((unit) => requestedIds.includes(unit.id)) : units,
      fromRevision,
      toRevision,
    };
  }
  private readModelContent(
    id: string,
    state: Readonly<ArtifactState>,
    product: ReadProduct,
    mode: string,
    args: Record<string, unknown>,
  ) {
    if (mode === 'source') {
      const page = modelPage(args, id, state.artifact.revision);
      const element =
        state.artifact.type === 'whiteboard' &&
        !args.feedbackId &&
        (state.content as WhiteboardContent).elements.find(
          (item) => item.id === (args.elementId ?? args.regionId),
        );
      const result =
        element && element.type !== 'document' && typeof element.html !== 'string'
          ? {
              artifactId: id,
              elementId: element.id,
              version: element.version,
              json: JSON.stringify(element),
            }
          : product.read(state, mode, args);

      return modelSourcePage(result as Record<string, unknown>, page);
    }
    if (mode === 'objects') {
      const result = product.read(state, mode, args) as Record<string, unknown>;

      return {
        ...result,
        elements: Array.isArray(result.elements) ? result.elements.map(modelElement) : [],
        ...(Array.isArray(result.units) ? { units: result.units.map(modelUnit) } : {}),
      };
    }
    if (mode === 'search' || mode === 'region') {
      if (state.artifact.type !== 'whiteboard') {
        throw new StudioError('INVALID_ARGUMENT', '当前作品不支持白板范围查询。');
      }

      const page = modelPage(args, id, state.artifact.revision);
      const { query, rect, type, parentId, ids } = args as WhiteboardQueryOptions;
      const result = queryWhiteboard(
        {
          artifact: state.artifact as Board['artifact'],
          elements: (state.content as WhiteboardContent).elements,
        },
        {
          query: mode === 'search' ? query : undefined,
          rect,
          type,
          parentId,
          ids,
          offset: page.offset,
          limit: page.limit,
          maxBytes: modelDataBudget(STUDIO_TOOLS.read, args) - 512,
        },
      );

      return modelPageResult(args, page, { ...result }, 'items');
    }
    if (mode === 'summary' || mode === 'blocks' || mode === 'tasks') {
      const page = modelPage(args, id, state.artifact.revision);
      const result = product.read(state, mode, { ...args, offset: page.offset }) as Record<
        string,
        unknown
      >;

      return modelPageResult(args, page, result, mode === 'blocks' ? 'blocks' : 'items');
    }

    return product.read(state, mode, args);
  }
  private async apply(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    if (
      actor.kind === 'agent' &&
      typeof args.operationId === 'string' &&
      (await this.store.readProjection(id, (state) =>
        state.operations.some((operation) => operation.id === args.operationId),
      ))
    ) {
      const replay = await this.store.withSnapshotLock(id, (state) => {
        const currentActor = this.authorizedActor(state, actor, authority);
        if (!state.operations.some((operation) => operation.id === args.operationId)) {
          return;
        }

        const mutation = applyMutation(
          copy(state),
          {
            operationId: args.operationId,
            operations: args.operations as ContentOperation[],
            expectedRevision: args.expectedRevision,
            expectedVersions: args.expectedVersions,
            summary: args.summary,
            merge: args.merge,
          },
          currentActor,
          this.products.get(state.artifact.type).adapter,
        );

        return {
          ...this.products.get(state.artifact.type).result(mutation.snapshot),
          historyEntry: mutation.historyEntry,
        };
      });

      if (replay) {
        return replay;
      }
    }

    const result = await this.store.transaction(id, (state) => {
      const currentActor = this.authorizedActor(state, actor, authority);
      const adapter = this.products.get(state.artifact.type).adapter;
      const duplicate = state.operations.some((operation) => operation.id === args.operationId);
      const binding =
        currentActor.kind === 'agent' && state.artifact.type === 'whiteboard' && !duplicate
          ? taskBinding(args, true)!
          : undefined;
      const task = binding && this.collaboration.assertTask(id, currentActor, binding);
      if (currentActor.kind === 'agent' && !duplicate && Array.isArray(args.operations)) {
        this.assertNoEditsInProgress(id, currentActor, state.content, args.operations, adapter);
      }

      const before = state.content;
      const mutation = applyMutation(
        state,
        {
          operationId: args.operationId,
          operations: args.operations as ContentOperation[],
          expectedRevision: args.expectedRevision,
          expectedVersions: args.expectedVersions,
          summary: args.summary,
          merge: args.merge,
        },
        currentActor,
        adapter,
      );

      if (mutation.changed && task && binding) {
        this.collaboration.assertTask(id, currentActor, binding);
        assertWorkspaceMutation(
          before as WhiteboardContent,
          state.content as WhiteboardContent,
          args.operations as Record<string, unknown>[],
          task,
          currentActor.id,
          this.collaboration.workspaces(id, { actorId: currentActor.id, binding }),
        );
      }

      return {
        ...mutation,
        binding,
        actor: currentActor,
        eventOperationId: state.operations.find(
          (operation) => operation.historyId === mutation.historyEntry.id,
        )?.id,
        eventUnits: mutation.changed
          ? this.boardUnits(mutation.snapshot, mutation.historyEntry.changedIds, before)
          : [],
      };
    });
    const snapshot = result.snapshot;
    if (result.changed && result.binding) {
      this.collaboration.touchTask(id, result.actor, result.binding, true);
    }
    if (result.changed) {
      this.emitBoard(
        snapshot,
        result.historyEntry.changedIds,
        result.eventUnits,
        result.eventOperationId,
        result.historyEntry.actor.id,
      );
    }

    return {
      ...this.products.get(snapshot.artifact.type).result(snapshot),
      historyEntry: result.historyEntry,
    };
  }
  private assertNoEditsInProgress(
    id: string,
    actor: Actor,
    content: unknown,
    operations: unknown[],
    adapter: ReadProduct['adapter'],
  ) {
    const editing = new Set(
      this.getPresence(id)
        .filter(
          (peer) => peer.actor.id !== actor.id && ['owner', 'editor'].includes(peer.actor.role),
        )
        .flatMap((peer) => [
          ...(peer.context?.editingIds ?? []),
          ...(peer.context?.savingIds ?? []),
          ...(Array.isArray(peer.context?.movingIds) ? (peer.context.movingIds as string[]) : []),
        ]),
    );

    if (!editing.size) {
      return;
    }

    const conflicts = new Set<string>();
    for (const operation of operations) {
      if (!object(operation) || typeof operation.op !== 'string') {
        continue;
      }

      const targets = mutationTargets(content, { ...operation, op: operation.op }, adapter);
      for (const target of targets ?? editing) {
        if (editing.has(target)) {
          conflicts.add(target);
        }
      }
    }

    if (conflicts.size) {
      throw new StudioError(
        'EDIT_IN_PROGRESS',
        '目标内容正在其他视图中编辑或保存，请等待完成后重试。',
        { ids: [...conflicts] },
      );
    }
  }
  private async feedback(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    const action = text(args.action, 'list');
    if (action === 'preview') {
      const state = await this.store.read(id);
      const product = this.products.get(state.artifact.type);
      actor = this.authorizedActor(state, actor, authority);
      const snapshot = previewProposal(state, args, actor, product.adapter);

      return { document: product.project(snapshot) };
    }
    if (action === 'list' || action === 'get') {
      let state = await this.store.readProjection(id, (current) => ({
        ...authorizationState(current),
        feedback: current.feedback,
      }));
      actor = this.authorizedActor(state, actor, authority);
      if (state.feedback.some((item) => proposalExpired(item))) {
        state = await this.store.transaction(id, (current) => {
          this.authorizedActor(current, actor, authority);
          clearExpiredProposals(current);

          return copy({ ...authorizationState(current), feedback: current.feedback });
        });
      }

      const feedback = visibleFeedback(state.feedback, actor).filter(
        (item) =>
          (args.status === undefined || item.status === args.status) &&
          (args.feedbackId === undefined || item.id === args.feedbackId),
      );

      if (action === 'get' && !feedback.length) {
        throw new StudioError('NOT_FOUND', '反馈不存在。');
      }

      if (actor.kind === 'agent' && action === 'list') {
        const stamp = createHash('sha256')
          .update(
            JSON.stringify([
              state.artifact.revision,
              feedback.map((item) => [item.id, item.updatedAt, item.status]),
            ]),
          )
          .digest('base64url');
        const page = modelPage(args, id, stamp);
        const end = page.offset + page.limit;

        return modelPageResult(
          args,
          page,
          {
            feedback: feedback.slice(page.offset, end).map(modelFeedbackItem),
            totalCount: feedback.length,
            ...(end < feedback.length ? { nextOffset: end } : {}),
          },
          'feedback',
          STUDIO_TOOLS.feedback,
        );
      }

      return { feedback };
    }
    if (['suggest', 'choose', 'withdraw'].includes(action)) {
      return this.changeProposal(id, args, actor, authority, action);
    }

    const result = await this.store.transaction(id, (state) =>
      updateFeedback(
        state,
        args,
        this.authorizedActor(state, actor, authority),
        this.products.get(state.artifact.type).adapter,
      ),
    );
    this.emit({ type: 'feedback', artifactId: id });

    return result;
  }
  private async changeProposal(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority: StudioAuthority | undefined,
    action: string,
  ) {
    const supportsRetry =
      actor.kind === 'agent' &&
      ['choose', 'withdraw'].includes(action) &&
      typeof args.operationId === 'string';

    if (
      supportsRetry &&
      (await this.store.readProjection(id, (state) => proposalReceiptExists(state, args)))
    ) {
      const replay = await this.store.withSnapshotLock(id, (state) => {
        const currentActor = this.authorizedActor(state, actor, authority);
        if (!proposalReceiptExists(state, args)) {
          return;
        }

        const next = updateProposal(
          copy(state),
          args,
          currentActor,
          this.products.get(state.artifact.type).adapter,
        );
        const { snapshot, changed: _changed, ...response } = next;

        return {
          ...response,
          ...(snapshot ? this.products.get(snapshot.artifact.type).result(snapshot) : {}),
        };
      });

      if (replay) {
        return replay;
      }
    }

    const result = await this.store.transaction(id, (state) => {
      const currentActor = this.authorizedActor(state, actor, authority);
      const duplicate = proposalReceiptExists(state, args);
      const proposal = state.feedback.find((item) => item.id === args.feedbackId)?.proposal;
      const option = proposal?.options.find((item) => item.id === args.optionId);
      const proposalOperations =
        proposal?.options
          .filter((item) => item.active || item.id === args.optionId)
          .flatMap((item) => item.operations) ?? [];
      const writesContent = proposalWritesContent(action, args, option?.active);
      const needsWorkspace = currentActor.kind === 'agent' && state.artifact.type === 'whiteboard';
      const binding =
        needsWorkspace && writesContent && !duplicate ? taskBinding(args, true)! : undefined;
      const task = binding && this.collaboration.assertTask(id, currentActor, binding);
      const before = state.content;
      const next = updateProposal(
        state,
        args,
        currentActor,
        this.products.get(state.artifact.type).adapter,
      );

      if (next.changed && task && binding) {
        this.collaboration.assertTask(id, currentActor, binding);
        const other = this.collaboration.workspaces(id, { actorId: currentActor.id, binding });
        assertWorkspaceMutation(
          before as WhiteboardContent,
          state.content as WhiteboardContent,
          proposalOperations,
          task,
          currentActor.id,
          other,
        );
      }

      return {
        ...next,
        binding,
        actor: currentActor,
        eventUnits:
          next.changed && next.snapshot && next.historyEntry
            ? this.boardUnits(next.snapshot, next.historyEntry.changedIds, before)
            : [],
      };
    });

    if (result.changed && result.binding) {
      this.collaboration.touchTask(id, result.actor, result.binding, true);
    }

    this.emit({ type: 'feedback', artifactId: id });
    if (result.changed && result.snapshot && result.historyEntry) {
      this.emitBoard(result.snapshot, result.historyEntry.changedIds, result.eventUnits);
    }

    const {
      snapshot,
      changed: _changed,
      eventUnits: _eventUnits,
      binding: _binding,
      actor: _actor,
      ...response
    } = result;

    return {
      ...response,
      ...(snapshot ? this.products.get(snapshot.artifact.type).result(snapshot) : {}),
    };
  }
  private async activity(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    const execute = (state: AuthorizationState & Pick<ArtifactState, 'content'>) => {
      const current = this.authorizedActor(state, actor, authority);
      requireRole(current, ['owner']);
      assertAlive(state.artifact);
      if (args.action === 'release' ? current.kind !== 'human' : current.kind !== 'agent') {
        throw new StudioError(
          'FORBIDDEN',
          args.action === 'release'
            ? '只有房主本人可以结束其他 Agent 的工作。'
            : '工作区域声明仅供 Agent 使用。',
        );
      }
      if (state.artifact.type !== 'whiteboard') {
        throw new StudioError('INVALID_ARGUMENT', '该作品不支持白板工作区域。');
      }

      if (object(args.scope) && args.scope.ids !== undefined) {
        const ids = args.scope.ids;
        if (!requestedUnitIds(ids) || !ids.length || ids.some((value) => value.startsWith('$'))) {
          throw new StudioError('INVALID_ARGUMENT', '工作区域需要 1 到 200 个对象 ID。');
        }

        const adapter = this.products.get(state.artifact.type).adapter;
        for (const target of ids) {
          if (adapter.readUnit(state.content, safeId(target, '对象 ID')) == null) {
            throw new StudioError('NOT_FOUND', '工作区域中的对象不存在。', { id: target });
          }
        }
      }

      return this.collaboration.activity(
        id,
        args,
        current,
        (state.content as WhiteboardContent).elements,
      );
    };

    if (args.action === 'begin' || args.action === 'update') {
      return this.store.withProjectionLock(
        id,
        (state) => ({ ...authorizationState(state), content: state.content }),
        execute,
      );
    }

    const result = await this.store.readProjection(id, (state) => execute(state));
    if (args.action === 'end' || args.action === 'release') {
      await this.store.withProjectionLock(id, authorizationState, (state) => {
        requireRole(this.authorizedActor(state, actor, authority), ['owner']);
      });
    }

    return result;
  }
  private async share(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    const action = text(args.action, 'status');
    const current = await this.store.readProjection(id, authorizationState);
    actor = this.authorizedActor(current, actor, authority);
    const info = (state: AuthorizationState) =>
      shareInfo(
        id,
        state.sharing,
        sharingAccess(state.sharing) === 'local' ? this.localOrigin : this.sharingOrigin,
        this.getPresence(id),
        this.owner,
        actor,
      );

    if (action === 'status') {
      return info(current);
    }

    requireRole(actor, ['owner']);
    if (
      !['start', 'stop', 'reset', 'link', 'role', 'remove', 'restore', 'forget'].includes(action)
    ) {
      throw new StudioError('INVALID_ARGUMENT', '不支持的分享操作。');
    }

    assertAlive(current.artifact);
    let opened = false;
    const starting = action === 'start';
    try {
      const requestedAccess = starting ? args.access : undefined;
      if (
        requestedAccess !== undefined &&
        requestedAccess !== 'local' &&
        requestedAccess !== 'lan'
      ) {
        throw new StudioError('INVALID_ARGUMENT', '访问范围应为 local 或 lan。');
      }

      const localStart = starting && requestedAccess === 'local';
      if (starting && !localStart) {
        const origin = await this.shareHandler?.(true);
        opened = true;
        if (origin) {
          this.sharingOrigin = origin;
        }
      }

      const committed = await this.store.transaction(id, (state) => {
        rememberGuestNames(state);
        const revoked = updateSharing(
          state.artifact,
          state.sharing,
          action,
          this.authorizedActor(state, actor, authority),
          args,
        );

        if (action === 'forget') {
          delete state.guestNames?.[safeId(args.memberId, '成员 ID')];
        }

        return { info: info(state), ...revoked };
      });
      const revokedMembers = [
        ...committed.revokedMemberIds,
        ...this.getPresence(id)
          .filter((peer) =>
            committed.revokedRoles.includes(peer.actor.role as Exclude<Role, 'owner'>),
          )
          .map((peer) => peer.actor.id),
      ];

      if (revokedMembers.length) {
        this.collaboration.revokeMembers(id, revokedMembers);
      }

      const reason = sharingChangeReason(action, localStart);
      this.emit({
        type: 'share',
        artifactId: id,
        enabled: committed.info.enabled,
        access: committed.info.access,
        reason,
        generation: committed.info.generation,
        revokedRoles: committed.revokedRoles,
        revokedMemberIds: committed.revokedMemberIds,
      });

      if (action === 'stop' || localStart) {
        await this.shareHandler?.(false);
      }

      return committed.info;
    } catch (error) {
      if (opened) {
        await this.shareHandler?.(false);
      }

      throw error;
    }
  }
  async shareRole(
    artifactId: string,
    token: string | undefined,
    memberId?: string,
  ): Promise<Exclude<Role, 'owner'> | undefined> {
    let state: Pick<AuthorizationState, 'artifact' | 'sharing'>;
    try {
      state = await this.store.readProjection(artifactId, (state) => ({
        artifact: state.artifact,
        sharing: state.sharing,
      }));
    } catch (error) {
      debug(
        'Access denied after a share role lookup failed (%s).',
        error instanceof StudioError ? error.code : 'read failed',
      );

      return;
    }

    return shareRole(state.artifact, state.sharing, token, memberId);
  }
  async accessMode(
    artifactId: string,
    viaLan = false,
    allowMissing = false,
  ): Promise<'local' | 'lan'> {
    let state: Pick<AuthorizationState, 'artifact' | 'sharing'>;
    try {
      state = await this.store.readProjection(artifactId, (state) => ({
        artifact: state.artifact,
        sharing: state.sharing,
      }));
    } catch (error) {
      const permitsLegacy = allowMissing && !viaLan;
      if (permitsLegacy && error instanceof StudioError && error.code === 'UNSUPPORTED_STORAGE') {
        return 'local';
      }

      if (error instanceof StudioError && error.code === 'NOT_FOUND') {
        if (allowMissing) {
          return 'local';
        }

        throw new StudioError(
          'UNAUTHORIZED',
          '分享链接无效。',
          { reason: 'invalid-link' },
          { cause: error },
        );
      }

      throw error;
    }

    const access = sharingAccess(state.sharing);
    if (viaLan && access === 'local') {
      throw new StudioError(
        'UNAUTHORIZED',
        state.sharing.enabled ? '这块白板仅允许在所有者电脑上访问。' : '这块白板的分享已关闭。',
        { reason: state.sharing.enabled ? 'local-only' : 'sharing-closed' },
      );
    }

    return access;
  }
  async guestSession(
    artifactId: string,
    token: string | undefined,
    id: string,
    registration?: { name: unknown },
    viaLan = false,
  ): Promise<{ actor: Actor; grantId?: string }> {
    await this.accessMode(artifactId, viaLan);
    const resolve = (state: AuthorizationState) => {
      if (viaLan && sharingAccess(state.sharing) === 'local') {
        throw new StudioError('UNAUTHORIZED', '这块白板仅允许在所有者电脑上访问。', {
          reason: state.sharing.enabled ? 'local-only' : 'sharing-closed',
        });
      }

      const access = shareAccess(state.artifact, state.sharing, token, id);
      if (!access.role) {
        throw new StudioError('UNAUTHORIZED', '你已无法访问这块白板，请向所有者索取有效链接。', {
          reason: access.reason,
        });
      }

      rememberGuestNames(state);
      const invitation = { title: state.artifact.title, role: access.role };
      let name: string | undefined;
      try {
        name = registration
          ? registerGuestName(state, id, registration.name, this.owner.name)
          : guestName(state, id, this.owner.name);
      } catch (error) {
        if (error instanceof StudioError) {
          throw new StudioError(error.code, error.message, { invitation }, { cause: error });
        }

        throw error;
      }

      if (!name) {
        throw new StudioError('NAME_REQUIRED', '请输入你的名字后加入白板。', { invitation });
      }

      return { id, name, kind: 'human' as const, role: access.role };
    };

    const state = await this.store.readProjection(artifactId, authorizationState);
    const hadName = state.guestNames?.[id] !== undefined;
    const actor = resolve(state);
    const member = state.sharing.members?.[id];

    if (!registration && hadName && member) {
      const existingCredential = !token || member.ownerAssigned || member.credential === token;
      const sameName = member.name === actor.name;
      if (existingCredential && sameName && Date.now() - Date.parse(member.lastSeenAt) < 60_000) {
        return { actor, grantId: member.grantId };
      }
    }

    let roleChanged = false;
    let joinedAccess = sharingAccess(state.sharing);
    const joined = await this.store.transaction(artifactId, (current) => {
      const previousRole = current.sharing.members?.[id]?.role;
      const next = resolve(current);
      const joined = joinSharingMember(current.artifact, current.sharing, token, id, next.name);
      if (!joined) {
        throw new StudioError('UNAUTHORIZED', '分享权限已变更，请重新连接。', {
          reason: shareAccess(current.artifact, current.sharing, token, id).reason,
        });
      }

      roleChanged = previousRole !== undefined && previousRole !== joined.role;
      joinedAccess = sharingAccess(current.sharing);

      return { actor: joined, grantId: current.sharing.members![id]!.grantId };
    });

    if (roleChanged) {
      this.collaboration.revokeMembers(artifactId, [id]);
      this.emit({
        type: 'share',
        artifactId,
        enabled: true,
        access: joinedAccess,
        reason: 'role-changed',
        revokedMemberIds: [id],
      });
    }

    return joined;
  }
  async hasShares() {
    for (const artifact of await this.store.catalog()) {
      if (artifact.storageStatus !== 'unsupported' && !artifact.trashedAt) {
        if (
          await this.store.readProjection(
            artifact.id,
            (state) => state.sharing.enabled && sharingAccess(state.sharing) === 'lan',
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }
  async resetSharingSessions() {
    for (const artifact of await this.store.catalog()) {
      if (
        artifact.storageStatus !== 'unsupported' &&
        (await this.store.readProjection(artifact.id, (state) => state.sharing.enabled))
      ) {
        await this.store.transaction(artifact.id, (state) => {
          rememberGuestNames(state);
          revokeSharing(state.sharing);
        });
        this.emit({
          type: 'share',
          artifactId: artifact.id,
          enabled: false,
          reason: 'sharing-closed',
          revokedRoles: [...SHARE_ROLES],
        });
      }
    }
  }
  async putAsset(
    artifactId: string,
    data: Uint8Array,
    input: { filename?: string; mimeType?: string },
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    const state = await this.store.readProjection(artifactId, authorizationState);

    return putAsset(
      this.store,
      artifactId,
      data,
      input,
      this.authorizedActor(state, actor, authority),
      this.products.get(state.artifact.type).validateAsset,
      (current) => this.authorizedActor(current, actor, authority),
    );
  }
  async getAsset(artifactId: string, assetId: string) {
    return getAsset(this.store, artifactId, assetId);
  }
  async getThumbnail(artifactId: string, actor: Actor = this.owner) {
    const state = await this.store.readProjection(safeId(artifactId), (state) => ({
      artifact: state.artifact,
      content: state.content,
    }));

    if (state.artifact.trashedAt) {
      requireRole(actor, ['owner']);
    }

    const product = this.products.get(state.artifact.type);
    if (!product.thumbnail) {
      throw new StudioError('NO_PREVIEW', '此产品未提供预览，请直接打开作品。');
    }

    return this.thumbnails.get(artifactId, state.artifact.revision, () =>
      product.thumbnail!(state, exportResources(this.store, artifactId)),
    );
  }
  async updatePresence(
    artifactId: string,
    input: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    if (input.timer !== undefined) {
      return this.store.withProjectionLock(artifactId, authorizationState, (state) =>
        this.collaboration.update(artifactId, input, this.authorizedActor(state, actor, authority)),
      );
    }

    return this.collaboration.update(artifactId, input, actor, async () =>
      this.authorizedActor(
        await this.store.readProjection(artifactId, authorizationState),
        actor,
        authority,
      ),
    );
  }
  getPresence(artifactId: string): Presence[] {
    return this.collaboration.getPresence(artifactId);
  }
  getTimer(artifactId: string) {
    return this.collaboration.getTimer(artifactId);
  }
  cursor() {
    return this.collaboration.cursor();
  }
  connectPeer(artifactId: string, peerId: string, peerEpoch: string | undefined, actor: Actor) {
    return this.collaboration.connectPeer(artifactId, peerId, peerEpoch, actor);
  }
  async sync(artifactId: string, options: SyncOptions, actor: Actor, authority?: StudioAuthority) {
    if (!artifactId) {
      requireRole(actor, ['owner']);
      if (authority && !authority.owner) {
        throw new StudioError('FORBIDDEN', '访客不能订阅作品库。');
      }

      return {
        ...(await this.collaboration.sync('', options, actor)),
        actor,
        access: 'local' as const,
      };
    }

    const currentActor = this.authorizedActor(
      await this.store.readProjection(artifactId, authorizationState),
      actor,
      authority,
    );
    const result = await this.collaboration.sync(artifactId, options, currentActor);
    const current = await this.store.readProjection(artifactId, authorizationState);
    const confirmedActor = this.authorizedActor(current, actor, authority);

    return { ...result, actor: confirmedActor, access: sharingAccess(current.sharing) };
  }
  async room(
    artifactId: string,
    input: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    return this.store.withProjectionLock(artifactId, authorizationState, (state) =>
      this.collaboration.room(artifactId, input, this.authorizedActor(state, actor, authority)),
    );
  }
  private async export(
    id: string,
    args: Record<string, unknown>,
    actor: Actor,
    authority?: StudioAuthority,
  ) {
    const format = text(args.format, 'json', 20).toLowerCase();
    let result;
    let capture: SavedRegionCapture | undefined;
    const {
      artifactId: _artifactId,
      format: _format,
      options: nestedOptions,
      ...flatOptions
    } = args;
    const options = { ...(object(nestedOptions) ? nestedOptions : {}), ...flatOptions };
    const resources = exportResources(this.store, id);
    try {
      if (format === 'zip') {
        const state = await this.store.read(id);
        actor = this.authorizedActor(state, actor, authority);
        assertAlive(state.artifact);
        result = await exportArchive(this.store, state, actor);
      } else {
        const snapshot = await this.store.readProjection(id, (state) => {
          actor = this.authorizedActor(state, actor, authority);
          assertAlive(state.artifact);
          if (args.atRevision === undefined || args.atRevision === state.artifact.revision) {
            return { artifact: state.artifact, content: state.content };
          }
          if (!Number.isSafeInteger(args.atRevision) || Number(args.atRevision) < 0) {
            throw new StudioError('INVALID_ARGUMENT', '请指定有效的作品修订。');
          }

          const saved = state.history.find((item) => item.artifact.revision === args.atRevision);
          if (!saved) {
            throw new StudioError(
              'VERSION_NOT_FOUND',
              '该导出修订已不在保留历史中，请指定可用版本。',
            );
          }

          return { artifact: saved.artifact, content: saved.content };
        });

        if (
          actor.kind === 'agent' &&
          args.rect !== undefined &&
          snapshot.artifact.type !== 'whiteboard'
        ) {
          throw new StudioError('INVALID_ARGUMENT', '当前作品不支持矩形范围导出。');
        }

        if (actor.kind === 'agent' && format === 'png' && snapshot.artifact.type === 'whiteboard') {
          const { captureSavedRegion } = await import('./products/scoped-capture.js');
          const board = {
            artifact: snapshot.artifact as Board['artifact'],
            ...(snapshot.content as WhiteboardContent),
          };
          const target = object(args.rect)
            ? { rect: args.rect as unknown as CaptureRect }
            : { ids: (args.ids ?? [args.regionId]) as string[] };
          capture = await captureSavedRegion(board, target, resources.assetDataUri);
          result = capture;
        } else {
          result = await this.products
            .get(snapshot.artifact.type)
            .export(snapshot, format, options, resources);
        }
        if (
          actor.kind === 'agent' &&
          Buffer.byteLength(result.data, result.encoding === 'base64' ? 'base64' : 'utf8') >
            1024 * 1024
        ) {
          throw new StudioError(
            'LIMIT_EXCEEDED',
            '局部导出超过 1 MiB，请缩小范围或从作品界面导出。',
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        throw new StudioError(error.code, error.message, undefined, { cause: error });
      }

      throw error;
    }

    return this.store.withProjectionLock(id, authorizationState, async (current) => {
      this.authorizedActor(current, actor, authority);
      assertAlive(current.artifact);
      const saved = await saveExport(this.dataRoot, id, result);
      if (!capture) {
        return saved;
      }

      const { source, revision, bounds, width, height, ids } = capture;

      return {
        ...saved,
        source,
        revision,
        bounds,
        width,
        height,
        ids,
        ...(args.includeImage === false
          ? {}
          : { image: { mimeType: capture.mimeType, data: capture.data } }),
      };
    });
  }
  async getExport(exportId: string) {
    return getExport(this.dataRoot, exportId);
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.tasks]);
    this.collaboration.close();
    this.thumbnails.clear();
  }
}
