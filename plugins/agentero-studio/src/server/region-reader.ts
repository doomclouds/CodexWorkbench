import { randomBytes } from 'node:crypto';
import type { Actor, Artifact, BoardElement } from '../contracts/studio.js';
import { StudioError, StudioService } from '../core/service.js';
import { safeId } from '../core/shared/common.js';

export interface ReaderAuthority { actor: Actor; token: string; artifactId?: string; owner: boolean }
interface Grant { artifactId: string; regionId: string; viewId: string; source: ReaderAuthority; expiresAt: number; activeUntil?: number; returned?: ReaderReturn }
export interface ReaderReturn { artifactId: string; regionId: string; viewId: string; annotate: boolean }
const LIFETIME_MS = 15 * 60_000, MAX_GRANTS = 128;

/** Ephemeral capabilities never enter the normal business API's authorization path. */
export function createRegionReaders(service: StudioService, now = () => Date.now()) {
  const grants = new Map<string, Grant>();
  const sweep = () => { for (const [key, grant] of grants) if (grant.expiresAt <= now()) grants.delete(key); };
  const unsubscribe = service.subscribe('*', event => {
    if (event.type === 'purged') { for (const [key, grant] of grants) if (grant.artifactId === event.artifactId) grants.delete(key); return; }
    if (event.type !== 'share') return;
    for (const [key, grant] of grants) if (!grant.source.owner && grant.artifactId === event.artifactId && (event.enabled === false || Array.isArray(event.revokedRoles) && event.revokedRoles.includes(grant.source.actor.role) || Array.isArray(event.revokedMemberIds) && event.revokedMemberIds.includes(grant.source.actor.id))) grants.delete(key);
  });
  async function read(grant: Grant) {
    if (!grant.source.owner && await service.shareRole(grant.artifactId, grant.source.token, grant.source.actor.id) !== grant.source.actor.role) throw new StudioError('UNAUTHORIZED', '原分享权限已变更，请从白板重新打开。');
    const result = await service.execute('artifact_read', { artifactId: grant.artifactId, mode: 'objects', ids: [grant.regionId] }, grant.source.actor) as { artifact: Artifact; elements: BoardElement[] };
    if (result.artifact.trashedAt) throw new StudioError('TRASHED', '作品已移入回收站。');
    const element = result.elements?.find(value => value.id === grant.regionId && value.type === 'html');
    if (!element) throw new StudioError('NOT_FOUND', '原 HTML 区域不存在，请返回白板查看。');
    return {
      artifactId: grant.artifactId, artifactTitle: result.artifact.title, regionId: grant.regionId,
      title: element.text || 'HTML 图解', sourceRevision: element.sourceRevision ?? element.version,
      version: element.version, width: element.w, height: element.h, canAnnotate: grant.source.actor.role !== 'viewer',
      element: { id: element.id, text: element.text, html: element.html ?? '', sourceRevision: element.sourceRevision ?? element.version, version: element.version, state: element.state ?? null },
    };
  }
  async function grantFor(capability: string, artifactId: string, regionId: string) {
    sweep(); const grant = grants.get(capability);
    if (!grant) throw new StudioError('UNAUTHORIZED', '阅读链接已失效，请从白板重新打开。');
    if (grant.artifactId !== artifactId || grant.regionId !== regionId) throw new StudioError('FORBIDDEN', '阅读链接只能访问原 HTML 区域。');
    try { return { grant, content: await read(grant) }; }
    catch (error) { delete grant.activeUntil; throw error; }
  }
  return {
    async create(source: ReaderAuthority, input: Record<string, unknown>, origin: string) {
      sweep();
      const artifactId = safeId(input.artifactId), regionId = safeId(input.regionId, '区域 ID'), viewId = safeId(input.viewId, '视图 ID');
      if (!source.owner && source.artifactId !== artifactId) throw new StudioError('FORBIDDEN', '分享链接只能访问对应的作品。');
      if (grants.size >= MAX_GRANTS) throw new StudioError('BUSY', '打开的阅读页过多，请稍后重试。');
      const grant: Grant = { artifactId, regionId, viewId, source, expiresAt: now() + LIFETIME_MS };
      await read(grant);
      const capability = randomBytes(32).toString('base64url'); grants.set(capability, grant);
      return { url: `${origin}/region/${encodeURIComponent(artifactId)}/${encodeURIComponent(regionId)}#cap=${capability}`, expiresAt: grant.expiresAt };
    },
    async source(capability: string, artifactId: string, regionId: string, metadataOnly: boolean) {
      const { grant, content } = await grantFor(capability, artifactId, regionId);
      // Issuing a link does not keep the managed service alive; only an actual reader does.
      grant.activeUntil = Math.min(grant.expiresAt, now() + 45_000);
      const { element, ...metadata } = content;
      return metadataOnly ? metadata : { ...metadata, element };
    },
    async returnToBoard(capability: string, artifactId: string, regionId: string, annotate: boolean) {
      const { grant, content } = await grantFor(capability, artifactId, regionId);
      if (annotate && !content.canAnnotate) throw new StudioError('FORBIDDEN', '当前阅读权限不能创建备注。');
      grant.returned = { artifactId: grant.artifactId, regionId: grant.regionId, viewId: grant.viewId, annotate };
      return { requested: true };
    },
    async takeReturn(source: ReaderAuthority, artifactId: string, viewId: string) {
      safeId(artifactId); safeId(viewId, '视图 ID'); sweep();
      for (const grant of grants.values()) if (grant.artifactId === artifactId && grant.viewId === viewId && grant.source.token === source.token && grant.returned) {
        await read(grant); const navigation = grant.returned; delete grant.returned; return { navigation };
      }
      return {};
    },
    hasActiveReaders() { sweep(); return [...grants.values()].some(grant => (grant.activeUntil ?? 0) > now()); },
    close() { unsubscribe(); grants.clear(); },
  };
}
