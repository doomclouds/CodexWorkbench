import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STUDIO_ICON } from '../contracts/brand-icon.js';
import { PLUGIN_VERSION } from '../contracts/version.js';
import type { Connection, ToolName } from '../contracts/studio.js';
import { TOOL_NAMES } from '../contracts/studio.js';
import { APP_TOOL_NAME, type UiRequester } from '../contracts/transport.js';
import { appTransportSchema, createAppTransport } from './app-transport.js';

export interface StudioExecutionContext { clientInfo?: { name: string; version: string; title?: string } }
export interface StudioExecutor { execute(name: ToolName, args: Record<string, unknown>, context?: StudioExecutionContext): Promise<unknown>; connection(): Promise<Connection>; requestUi?: UiRequester }
const id = z.string().min(1).max(200);
const participant = z.object({ id: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(60) }).optional().describe('仅所有者的 MCP 调用可提供：同一连接中多个 Agent 使用稳定 id/name 区分协作身份；id 是不透明标识，可以使用 Agent 的任务路径，不作文件路径解释。身份由服务端按连接命名空间派生，不能用于访客提权。');
const coordinate = z.number().min(-10_000_000).max(10_000_000);
const anchor = z.object({
  coordinateSpace: z.enum(['board', 'element', 'html']).optional().describe('board: x/y/w/h 为白板世界坐标；element: x/y 为 elementIds[0] 内的 0..1 相对坐标；html: x/y/w/h 为 regionId 内部 CSS 像素。省略时沿用旧锚点含义。'),
  elementIds: z.array(id).optional().describe('已存在对象的稳定 ID；element 坐标以首个对象为基准。'),
  regionId: id.optional().describe('HTML 区域 ID；html 坐标空间必填。'),
  targetIds: z.array(z.string().max(160)).max(100).optional(),
  sourceRevision: z.number().int().positive().optional().describe('HTML 原始选区的源码版本，需要 regionId；不能用作对象 CAS 版本。'),
  quote: z.string().max(4000).optional(), excerpt: z.string().max(16000).optional(), selector: z.string().max(1200).optional(),
  x: coordinate.optional(), y: coordinate.optional(), w: coordinate.min(0).optional(), h: coordinate.min(0).optional(),
}).passthrough();
const elementPatch = z.object({
  locked: z.boolean().optional().describe('仅锁定位置、尺寸、旋转、连接几何和裁剪。锁后文字、样式、HTML 和 state 仍可更新。解锁须单独提交 changes:{locked:false}，且不能在同一事务内继续移动或删除。'),
}).passthrough();
const operation = z.object({
  op: z.string().min(1).max(64), id: id.optional(), ids: z.array(id).optional(),
  versionId: id.optional().describe('restore 的历史版本 ID；附 id 或 ids 时只恢复所选单元，保留未选择的内容、样式与当前标题。'),
  element: elementPatch.optional(), changes: elementPatch.optional(),
}).passthrough();
const schemas = {
  studio_open: z.object({ view: z.enum(['library', 'editor', 'board', 'trash']).optional(), artifactId: id.optional() }),
  artifact_list: z.object({ query: z.string().optional(), trashed: z.boolean().optional(), pinned: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional(), sort: z.string().optional() }),
  artifact_manage: z.object({ action: z.enum(['create', 'rename', 'pin', 'trash', 'restore', 'purge', 'duplicate', 'import', 'asset-import', 'asset-delete']), artifactId: id.optional(), artifactIds: z.array(id).min(1).max(100).optional().describe('purge 批量永久删除的作品 ID，1..100 个。与单个 artifactId 二选一；只允许房主删除回收站内作品，返回 deletedIds 和逐项 failures。'), type: id.optional(), title: z.string().max(200).optional(), pinned: z.boolean().optional(), archivePath: z.string().max(4096).optional(), assetPath: z.string().max(4096).optional(), assetId: id.optional() }),
  artifact_read: z.object({ artifactId: id, mode: z.string().min(1).max(64).optional(), ids: z.array(id).optional(), regionId: id.optional(), elementId: id.optional(), feedbackId: id.optional(), contextId: id.optional(), sourceRevision: z.number().int().positive().optional(), versionId: id.optional(), fromVersionId: id.optional(), toVersionId: id.optional(), adjacent: z.boolean().optional().describe('diff 时读取 versionId 的直接前后差异；首版的 before 为 null。指定 ids 可筛选返回的 units。'), viewId: id.optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200000).optional() }).passthrough(),
  artifact_apply: z.object({ artifactId: id, operationId: id.optional(), expectedRevision: z.number().int().optional(), expectedVersions: z.record(z.string(), z.number().int()).optional(), merge: z.literal('safe').optional().describe('安全合并过期 update：从服务器保留历史取可信基线，仅合并不冲突字段/文本行；同字段冲突保留原内容并返回 CONFLICT，不静默覆盖。缺省保持严格版本检查。'), operations: z.array(operation).min(1).max(200), summary: z.string().max(500).optional() }),
  artifact_feedback: z.object({ artifactId: id, action: z.enum(['list', 'get', 'create', 'reply', 'edit', 'delete', 'resolve', 'reopen', 'send', 'processing', 'suggest', 'preview', 'choose', 'withdraw']), feedbackId: id.optional(), replyId: id.optional().describe('reply 时可传稳定回复 ID，失败重试同 ID 和内容不会追加第二条；edit 时指定回复 ID，省略则编辑首消息。只能编辑自己的消息，delete 删除整个讨论且仅所有者或首作者可用。'), expectedText: z.string().max(20000).optional().describe('edit 时传打开编辑器时的原始文字；已被同身份另一视图修改则 CONFLICT，保留双方内容，不盲目覆盖。'), type: z.enum(['comment', 'request']).optional(), text: z.string().max(20000).optional(), anchor: anchor.optional(), versions: z.record(id, z.number().int().positive()).optional().describe('create 时提供全部锚点对象在选取时的 element.version；按该版本冻结原始对象/HTML。缺失、歧义或过期版本会拒绝；省略时兼容保存时快照。不同于修改用 expectedVersions。'), targetViewId: id.optional(), operationId: id.optional().describe('create/choose 的稳定操作 ID；重试保留同一 ID 与内容。create 返回原 contextId，不重复创建；改变内容或选区版本须使用新 ID。'), optionId: id.optional(), expectedRevision: z.number().int().optional(), expectedVersions: z.record(z.string(), z.number().int()).optional(), options: z.array(z.object({ id: id.optional(), label: z.string().max(60), description: z.string().max(160).optional(), operations: z.array(operation).max(60) })).min(2).max(4).optional() }),
  artifact_share: z.object({ artifactId: id, action: z.enum(['status', 'start', 'stop', 'reset', 'link', 'role', 'remove']), access: z.enum(['local', 'lan']).optional().describe('start 的访问范围：local 只允许本机角色邀请，lan 允许局域网。省略保持 lan。切换范围保留角色邀请与成员；stop 才撤销全部邀请。'), role: z.enum(['editor', 'commenter', 'viewer']).optional(), on: z.boolean().optional().describe('link 操作启用或关闭指定角色链接。'), memberId: id.optional().describe('role/remove 指定已加入成员 ID；改角色和移除会撤销该成员现有连接与阅读页。') }),
  artifact_export: z.object({ artifactId: id, format: z.enum(['json', 'html', 'svg', 'png', 'zip']), regionId: id.optional(), ids: z.array(id).optional(), scale: z.number().min(.1).max(4).optional() }),
};
const descriptions: Record<ToolName, string> = {
  studio_open: '打开 Agentero 创作作品中心或指定白板。仅导航，不隐式创建。',
  artifact_list: '按名称、固定或回收状态查找作品；分页返回摘要。',
  artifact_manage: '创建、重命名、固定、回收、恢复或复制作品。purge 由房主永久删除已在回收站的作品，artifactId 或 1..100 个 artifactIds 二选一；先校验全部参数，再逐项返回 deletedIds/failures，不删除活跃作品。import 导入用户指定的本机 ZIP；asset-import 导入用户明确指定或当前任务生成的本机媒体绝对路径，返回稳定资源引用；asset-delete 仅移除未被内容、历史或反馈引用的资源并保留内部回收副本。',
  artifact_read: '读取作品概要、对象、HTML 原始源码、冻结反馈、资产元数据或历史。默认 summary；context+feedbackId/contextId 返回冻结原生 element 与版本、HTML 来源引用；source+feedbackId+elementId/regionId 读取对应冻结对象/源码。HTML 按 offset/limit 分段，有 nextOffset 时继续；当前对象 CAS 版本从 objects 读取。assets 仅房主查询。不要把 DOM 摘录当原始源码。',
  artifact_apply: '以稳定对象 ID 批量局部修改白板。更改 HTML 使用 update.changes.html 并提供 expectedVersions；冲突后重读，不覆盖。locked 仅锁定几何，允许文字、样式、HTML 和 state 更新；移动、裁剪、删除及改变关联锁线前须独立明确解锁，同批解锁绕过会拒绝。layout preset=front/back/forward/backward 按 ids 调整对象层级。restore 指定 versionId 并形成新版本；附 id 或 ids 时只恢复所选内容单元，保留未选择的内容、样式与当前标题；仍须核对当前 revision 或全部目标版本，恢复不能绕过锁。data.mode=undo 安全撤回所选事务。',
  artifact_feedback: '创建或读取带原生对象、白板区域或 HTML 内部锚点的备注，支持回复、编辑自己的消息、删除整讨论、解决及私人建议。回复已解决讨论会重新打开；删除同时移除冻结来源，历史版本保留。create 用 versions 冻结选取时的原始对象/HTML，稳定 operationId 保证重试不重复；contextId 用于读取冻结来源。普通备注不自动授权修改。',
  artifact_share: '查询或管理局域网分享及角色链接。start 默认开启局域网；access:local 只启用本机角色邀请，复制链接不自动开放局域网。切换访问范围保留邀请和成员，切为本机时撤销原局域网连接；stop 撤销所有邀请与成员授权；link 独立启用/关闭角色链接，reset 使旧链接与对应成员授权失效；role/remove 管理已加入成员并立即撤销原连接。仅所有者可管理。',
  artifact_export: '按范围导出 JSON、HTML、SVG 或 PNG，或由房主导出包含资源、历史和反馈的 ZIP 备份；返回下载资源引用。富 HTML PNG 可能需要在白板界面导出。',
};
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function modelSource(value: unknown): Record<string, unknown> {
  const source = record(value) || {}, { html, element, ...metadata } = source, frozen = record(element);
  const { html: nestedHtml, ...elementMetadata } = frozen || {};
  const sourceHtml = typeof html === 'string' ? html : typeof nestedHtml === 'string' ? nestedHtml : undefined;
  return { ...metadata, ...(frozen ? { element: elementMetadata } : {}), ...(sourceHtml !== undefined ? { htmlLength: sourceHtml.length, readWith: 'artifact_read source + feedbackId + regionId' } : {}) };
}
/** UI keeps full documents on its private transport; model results carry bounded references. */
function modelResult(name: ToolName, args: Record<string, unknown>, value: unknown): unknown {
  const result = record(value); if (!result) return value;
  if (name === 'artifact_list' && Array.isArray(result.artifacts)) return { ...result, artifacts: result.artifacts.map(item => { const { thumbnail: _thumbnail, ...metadata } = record(item) || {}; return metadata; }) };
  if (name === 'artifact_apply' || name === 'artifact_manage') {
    const snapshot = record(result.document) || record(result.board);
    const artifact = result.artifact || snapshot?.artifact;
    if (artifact) return { artifact, ...(result.historyEntry ? { historyEntry: result.historyEntry } : {}) };
  }
  if (name === 'artifact_read') {
    if (args.mode === 'source' && typeof result.html === 'string') {
      let offset = Math.max(0, Math.min(result.html.length, Math.floor(Number(args.offset) || 0)));
      // Keep UTF-16 pagination on character boundaries, including a one-unit limit.
      if (offset > 0 && /[\uDC00-\uDFFF]/.test(result.html[offset] ?? '') && /[\uD800-\uDBFF]/.test(result.html[offset - 1])) offset--;
      let end = Math.min(result.html.length, offset + Math.min(200000, Math.max(1, Math.floor(Number(args.limit) || 64000))));
      if (end < result.html.length && /[\uD800-\uDBFF]/.test(result.html[end - 1]) && /[\uDC00-\uDFFF]/.test(result.html[end])) end += end - offset === 1 ? 1 : -1;
      const { sources: _sources, html, ...metadata } = result;
      return { ...modelSource(metadata), html: html.slice(offset, end), offset, totalLength: html.length, ...(end < html.length ? { nextOffset: end } : {}), complete: end === html.length };
    }
    if (args.mode === 'source') { const { sources: _sources, ...source } = result; return modelSource(source); }
    if (args.mode === 'context' && Array.isArray(result.sources)) return { ...result, sources: result.sources.map(modelSource) };
  }
  if (name === 'artifact_feedback' && Array.isArray(result.feedback)) {
    const id = args.feedbackId || result.contextId;
    const selected = id ? result.feedback.filter(item => record(item)?.id === id) : args.action === 'list' ? result.feedback.slice(0, 50) : result.feedback.slice(-1);
    const feedback: Record<string, unknown>[] = selected.map(value => {
      const item = record(value) || {};
      const replies = Array.isArray(item.replies) ? item.replies : [];
      const proposal = record(item.proposal);
      return { ...item, replies: replies.slice(-5), ...(replies.length > 5 ? { replyCount: replies.length, repliesTruncated: true } : {}), ...(proposal && Array.isArray(proposal.options) ? { proposal: { audience: proposal.audience, expiresAt: proposal.expiresAt, compact: true, options: proposal.options.map(value => { const option = record(value) || {}; return { id: option.id, label: option.label, description: option.description, active: option.active, targetIds: option.targetIds }; }) } } : {}) };
    });
    const compact = { feedback, ...(result.contextId ? { contextId: result.contextId } : {}), ...(result.historyEntry ? { historyEntry: result.historyEntry } : {}), ...(args.action === 'list' && result.feedback.length > 50 ? { totalCount: result.feedback.length, truncated: true, hint: '按反馈 ID 读取，或使用作品界面查看其余反馈。' } : {}) };
    return JSON.stringify(compact).length <= 240000 ? compact : { feedback: feedback.map(item => ({ id: item.id, status: item.status, text: typeof item.text === 'string' ? item.text.slice(0, 500) : '' })), truncated: true, hint: '请按反馈 ID 分别读取；完整讨论保留在作品界面。' };
  }
  if (JSON.stringify(result).length > 240000) return { artifact: result.artifact || record(result.board)?.artifact || record(result.document)?.artifact, tooLarge: true, hint: '结果超过模型载荷预算。请用 summary 查看概要，再按对象 IDs 或 source 的 offset/limit 分段读取。' };
  return result;
}
export function createStudioServer(executor: StudioExecutor, html: string) {
  const server = new McpServer({ name: 'agentero-studio', title: 'Agentero 创作', version: PLUGIN_VERSION, icons: [STUDIO_ICON] });
  const uri = 'ui://agentero-studio/app';
  for (const name of TOOL_NAMES) {
    server.registerTool(name, {
      title: name === 'studio_open' ? 'Agentero 创作' : descriptions[name].split('。')[0], description: descriptions[name], inputSchema: schemas[name].extend({ participant }),
      annotations: { readOnlyHint: ['studio_open', 'artifact_list', 'artifact_read'].includes(name), destructiveHint: name === 'artifact_manage', openWorldHint: name === 'artifact_share' },
      ...(name === 'studio_open' ? { _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } } } : {}),
    }, async (input: unknown) => {
      try {
        const args = input as Record<string, unknown>;
        const request = name === 'artifact_read' && !args.mode ? { ...args, mode: 'summary' } : args;
        const transformed = modelResult(name, request, await executor.execute(name, request, { clientInfo: server.server.getClientVersion() }));
        const data = JSON.stringify(transformed).length <= 240000 ? transformed : { artifactId: request.artifactId, tooLarge: true, hint: '请按 summary 页、对象 ID 或 source 的 offset/limit 缩小读取范围；未返回完整内容。' };
        return { content: [], structuredContent: { ok: true, data }, ...(name === 'studio_open' ? { _meta: { connection: await executor.connection() } } : {}) };
      } catch (error) {
        const failure = error as Error & { code?: string; details?: unknown };
        return { isError: true, content: [{ type: 'text' as const, text: failure.message }], structuredContent: { ok: false, error: { code: failure.code || 'STUDIO_ERROR', message: failure.message, ...(failure.details ? { details: failure.details } : {}) } } };
      }
    });
  }
  const appTransport = createAppTransport((request, signal) => {
    if (!executor.requestUi) throw Object.assign(new Error('作品界面传输不可用，请更新插件后重试。'), { code: 'UNAVAILABLE' });
    return executor.requestUi(request, signal);
  });
  server.registerTool(APP_TOOL_NAME, {
    title: '作品界面传输', description: '仅供作品界面访问当前本机作品服务；完整文档和文件字节不进入模型内容。',
    inputSchema: appTransportSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  }, async (input, extra) => {
    try { return { content: [], structuredContent: { ok: true }, _meta: { response: await appTransport.execute(input, extra.signal) } }; }
    catch (error) {
      const failure = error as Error & { code?: string };
      return { isError: true, content: [], structuredContent: { ok: false, error: { code: failure.code || 'STUDIO_TRANSPORT_ERROR', message: failure.message } } };
    }
  });
  server.registerResource('studio-ui', uri, { title: 'Agentero 创作', icons: [STUDIO_ICON], mimeType: 'text/html;profile=mcp-app' }, async () => {
    return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: html, _meta: {
      ui: { csp: { connectDomains: [], resourceDomains: ['data:', 'blob:'], frameDomains: ["'self'", 'blob:', 'data:'] }, prefersBorder: false },
      'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] },
    } }] };
  });
  const originalClose = server.close.bind(server);
  server.close = async () => { appTransport.close(); await originalClose(); };
  return server;
}
