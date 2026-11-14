import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STUDIO_ICON } from '../contracts/brand-icon.js';
import { PLUGIN_VERSION } from '../contracts/version.js';
import type { Connection, ToolName } from '../contracts/studio.js';
import { TOOL_NAMES } from '../contracts/studio.js';
import { APP_TOOL_NAME, type UiRequester } from '../contracts/transport.js';
import { appTransportSchema, createAppTransport } from './app-transport.js';

export interface StudioExecutor { execute(name: ToolName, args: Record<string, unknown>): Promise<unknown>; connection(): Promise<Connection>; requestUi?: UiRequester }
const id = z.string().min(1).max(200);
const loose = z.record(z.string(), z.unknown());
const schemas = {
  studio_open: z.object({ view: z.enum(['library', 'editor', 'board', 'trash']).optional(), artifactId: id.optional() }),
  artifact_list: z.object({ query: z.string().optional(), trashed: z.boolean().optional(), pinned: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional(), sort: z.string().optional() }),
  artifact_manage: z.object({ action: z.enum(['create', 'rename', 'pin', 'trash', 'restore', 'duplicate', 'import', 'asset-import', 'asset-delete']), artifactId: id.optional(), type: id.optional(), title: z.string().max(200).optional(), pinned: z.boolean().optional(), archivePath: z.string().max(4096).optional(), assetPath: z.string().max(4096).optional(), assetId: id.optional() }),
  artifact_read: z.object({ artifactId: id, mode: z.string().min(1).max(64).optional(), ids: z.array(id).optional(), regionId: id.optional(), feedbackId: id.optional(), versionId: id.optional(), fromVersionId: id.optional(), toVersionId: id.optional(), viewId: id.optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200000).optional() }).passthrough(),
  artifact_apply: z.object({ artifactId: id, operationId: id.optional(), expectedRevision: z.number().int().optional(), expectedVersions: z.record(z.string(), z.number().int()).optional(), operations: z.array(z.object({ op: z.string().min(1).max(64) }).passthrough()).min(1).max(200), summary: z.string().max(500).optional() }),
  artifact_feedback: z.object({ artifactId: id, action: z.enum(['list', 'get', 'create', 'reply', 'resolve', 'reopen', 'send', 'processing', 'suggest', 'preview', 'choose', 'withdraw']), feedbackId: id.optional(), type: z.enum(['comment', 'request']).optional(), text: z.string().max(20000).optional(), anchor: loose.optional(), targetViewId: id.optional(), operationId: id.optional(), optionId: id.optional(), expectedRevision: z.number().int().optional(), expectedVersions: z.record(z.string(), z.number().int()).optional(), options: z.array(z.object({ id: id.optional(), label: z.string().max(60), description: z.string().max(160).optional(), operations: z.array(loose).max(60) })).min(2).max(4).optional() }),
  artifact_share: z.object({ artifactId: id, action: z.enum(['status', 'start', 'stop', 'reset']), role: z.enum(['editor', 'commenter', 'viewer']).optional() }),
  artifact_export: z.object({ artifactId: id, format: z.enum(['json', 'html', 'svg', 'png', 'zip']), regionId: id.optional(), ids: z.array(id).optional(), scale: z.number().min(.1).max(4).optional() }),
};
const descriptions: Record<ToolName, string> = {
  studio_open: '打开 Agentero 创作作品中心或指定白板。仅导航，不隐式创建。',
  artifact_list: '按名称、固定或回收状态查找作品；分页返回摘要。',
  artifact_manage: '创建、重命名、固定、回收、恢复或复制作品。import 导入用户指定的本机 ZIP；asset-import 导入用户明确指定或当前任务生成的本机媒体绝对路径，返回稳定资源引用；asset-delete 仅移除未被内容、历史或反馈引用的资源并保留内部回收副本。',
  artifact_read: '读取作品概要、对象、HTML 原始源码、冻结反馈、资产元数据或历史。默认 summary；source 按 offset/limit 分段，有 nextOffset 时继续；feedbackId 读取批注时的原始源。assets 仅房主查询。不要把 DOM 摘录当原始源码。',
  artifact_apply: '以稳定对象 ID 批量局部修改白板。更改 HTML 使用 update.changes.html 并提供 expectedVersions；冲突后重读，不覆盖。restore 形成新版本，data.mode=undo 安全撤回所选事务。',
  artifact_feedback: '创建或读取带对象/HTML元素锚点的批注及Agent请求，回复和解决。反馈保留发送时源码快照；普通评论不自动授权修改。',
  artifact_share: '查询或管理局域网分享及角色链接。start 开启本机局域网访问；stop/reset 撤销现有链接和连接。',
  artifact_export: '按范围导出 JSON、HTML、SVG 或 PNG，或由房主导出包含资源、历史和反馈的 ZIP 备份；返回下载资源引用。富 HTML PNG 可能需要在白板界面导出。',
};
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
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
      return { ...metadata, html: html.slice(offset, end), offset, totalLength: html.length, ...(end < html.length ? { nextOffset: end } : {}), complete: end === html.length };
    }
    if (args.mode === 'context' && Array.isArray(result.sources)) return { ...result, sources: result.sources.map(source => { const item = record(source) || {}; const { html, ...metadata } = item; return { ...metadata, ...(typeof html === 'string' ? { htmlLength: html.length, readWith: 'artifact_read source + feedbackId + regionId' } : {}) }; }) };
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
      title: name === 'studio_open' ? 'Agentero 创作' : descriptions[name].split('。')[0], description: descriptions[name], inputSchema: schemas[name],
      annotations: { readOnlyHint: ['studio_open', 'artifact_list', 'artifact_read'].includes(name), destructiveHint: false, openWorldHint: name === 'artifact_share' },
      ...(name === 'studio_open' ? { _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } } } : {}),
    }, async (input: unknown) => {
      try {
        const args = input as Record<string, unknown>;
        const request = name === 'artifact_read' && !args.mode ? { ...args, mode: 'summary' } : args;
        const transformed = modelResult(name, request, await executor.execute(name, request));
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
