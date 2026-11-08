import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { LibraryService } from '../core/library-service.js';

const URI = 'ui://agentero-library/app/v0.1.0';
const key = z.string().min(1).max(4096);
const vault = { vaultId: key };
const paper = { ...vault, paperPath: key };
const note = { ...vault, path: key.optional(), paperPath: key.optional() };
const operation = { operationId: key, instanceId: key.optional(), vaultId: key.optional() };
const patch = z.object({ cliPath: z.string().max(4096).optional(), vaultPath: z.string().max(4096).optional(), pdfiumPath: z.string().max(4096).optional(), allowAgentPdfText: z.boolean().optional() }).strict();
const errorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });
const businessResult = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: errorSchema.optional() });

function failure(error: unknown) {
  const value = error as { code?: string; message?: string; retryable?: boolean };
  const detail = { code: value?.code ?? 'UPSTREAM_FAILED', message: value?.message ?? '操作失败。', retryable: value?.retryable ?? false };
  return { isError: true, content: [{ type: 'text' as const, text: detail.message }], structuredContent: { ok: false, error: detail } };
}

export function createLibraryServer(service: LibraryService, options: { html?: string } = {}) {
  const server = new McpServer({ name: 'agentero-library', version: '0.1.0', title: '文献库' }, {
    capabilities: { experimental: { 'openai/settings': { readTool: 'settings_read', updateTool: 'settings_update' } } },
  });
  function tool(name: string, description: string, shape: z.ZodRawShape, run: (input: any) => Promise<unknown>, readOnly = true, appOnly = false) {
    server.registerTool(name, {
      title: description.split('。')[0], description, inputSchema: z.object(shape).strict(), outputSchema: businessResult,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: ['paper_discover', 'paper_import'].includes(name) },
      _meta: { ui: { visibility: appOnly ? ['app'] : ['model', 'app'] } },
    }, async (input) => {
      try { return { content: [{ type: 'text', text: `${name} 已完成。` }], structuredContent: { ok: true, data: await run(input) } }; }
      catch (error) { return failure(error); }
    });
  }

  tool('library_status', '检查文献插件的 CLI、Vault 与分项能力。缺少依赖时也可调用。', {}, () => service.status());
  tool('paper_list', '列出文献摘要并分页。首次或显式刷新后从 Agentero CLI 获取完整列表快照。', { ...vault, query: z.string().max(1000).optional(), tag: z.array(key).max(100).optional(), unread: z.boolean().optional(), sortBy: z.enum(['title', 'year', 'date']).optional(), sortDir: z.enum(['asc', 'desc']).optional(), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().max(8192).optional(), refresh: z.boolean().optional() }, (input) => service.listPapers(input));
  tool('paper_get', '读取单篇论文元数据与可用资源，不返回 PDF 字节。', paper, (input) => service.getPaper(input));
  tool('library_search', '搜索本地元数据、笔记或已有正文。关键词匹配，不是语义检索；正文范围需要开启 Agent 正文访问。', { ...vault, query: z.string().min(1).max(1000), scope: z.enum(['all', 'metadata', 'notes', 'body']).optional(), limit: z.number().int().min(1).max(200).optional(), year: z.number().int().optional(), publication: key.optional(), doi: key.optional(), isRead: z.boolean().optional() }, (input) => service.search(input));
  tool('paper_discover', '在线发现 arXiv 论文，返回候选来源；不会自动导入。', { ...vault, keywords: z.array(key).max(20).optional(), categories: z.array(key).max(20).optional(), since: z.string().optional(), until: z.string().optional(), top: z.number().int().min(1).max(100).optional(), maxCandidates: z.number().int().min(1).max(200).optional(), dedup: z.boolean().optional() }, (input) => service.discover(input));
  tool('paper_import', '导入用户明确指定的标识符或本地 PDF，返回后台任务；导入与解析结果分开。', { ...vault, text: key.optional(), filePath: key.optional(), parent: key.optional(), noRecognize: z.boolean().optional() }, (input) => service.importPaper(input), false);
  tool('paper_parse', '按明确处理任务解析已有 PDF；写入派生正文，不保证产生版面 layout。不得因普通问答自动解析。', { ...paper, force: z.boolean().optional() }, (input) => service.parsePaper(input), false);
  tool('paper_read', '读取有界正文或已有页级证据。页码为 PDF 物理页 1-based；无版面数据时不虚构页码。', { ...paper, source: z.enum(['auto', 'pdf', 'layout', 'markdown']).optional(), pages: z.array(z.number().int().min(1)).max(5).optional(), page: z.number().int().min(1).optional(), startLine: z.number().int().min(1).optional(), startOffset: z.number().int().min(0).optional(), maxChars: z.number().int().min(1).max(20_000).optional() }, (input) => service.readPaper(input));
  tool('paper_update', '明确修改一种论文属性：阅读状态、标签或元数据；普通问答不自动更新。', { ...paper, isRead: z.boolean().optional(), tags: z.array(key).max(200).optional(), title: key.optional(), authors: z.array(key).max(100).optional(), date: z.string().max(100).optional(), doi: z.string().max(1000).optional(), arxivId: z.string().max(1000).optional(), publication: z.string().max(1000).optional() }, (input) => service.updatePaper(input), false);
  tool('note_list', '列出 notes 下的一层笔记目录；结果有上游截断限制。', { ...vault, path: key.optional(), limit: z.number().int().min(1).max(500).optional() }, (input) => service.listNotes(input));
  tool('note_read', '读取独立笔记或论文 NOTES，返回内容和修订指纹；缺失与空文件分开。', note, (input) => service.readNote(input));
  tool('note_write', '按明确保存任务写笔记。必须带上读取修订号，冲突保留草稿；不保证外部进程 CAS。新路径 revision 为 null，mode 仅 replace/append。', { ...note, content: z.string().max(2_000_000), revision: z.string().nullable(), mode: z.enum(['replace', 'append']).optional() }, (input) => service.writeNote(input), false);
  tool('operation_get', '查询本插件拥有的导入或解析任务及分阶段结果。', operation, (input) => service.getOperation(input));
  tool('operation_cancel', '申请取消本插件拥有的任务；进程实际退出前仍为取消申请，已写内容不自动回滚。', operation, (input) => service.cancelOperation(input), false);
  tool('vault_create', '在用户明确指定的位置创建文献库；不覆盖已有非空目录。', { path: key }, (input) => service.createVault(input), false, true);

  const fields = {
    cliPath: { type: 'string', title: 'Agentero CLI 路径', description: '自行安装的 agentero 可执行文件；留空时从 PATH 查找。' },
    vaultPath: { type: 'string', title: '文献库路径', description: '选择已有 Agentero Vault；创建新库请打开配置与诊断。' },
    pdfiumPath: { type: 'string', title: 'PDFium 路径', description: '可选，原生 PDF 解析需要；不影响浏览器阅读与笔记。' },
    allowAgentPdfText: { type: 'boolean', title: '允许 Agent 读取 PDF 正文', description: '控制正文抽取、版面文本及正文搜索；不影响主动发送的选区。' },
  };
  const layout = [{ kind: 'group', title: '本地文献库', items: [...Object.keys(fields).map((property) => ({ kind: 'property', property })), { kind: 'tool', tool: 'settings_open' }] }];
  const values = (settings: Record<string, unknown>) => Object.fromEntries(Object.keys(fields).map((name) => [name, settings[name]]));
  server.registerTool('settings_read', {
    title: '读取文献库设置', inputSchema: z.object({}), outputSchema: z.object({ schema: z.record(z.string(), z.unknown()), values: z.record(z.string(), z.unknown()), layout: z.array(z.unknown()) }),
    annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['app'] } },
  }, async () => {
    try {
      const settings = await service.readSettings();
      return { content: [], structuredContent: { schema: { type: 'object', properties: fields }, values: values({ ...settings }), layout }, _meta: { settings } };
    } catch (error) { return failure(error); }
  });
  server.registerTool('settings_update', {
    title: '保存文献库设置', inputSchema: z.object({ set: patch }).strict(), outputSchema: z.object({ values: z.record(z.string(), z.unknown()) }),
    annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { ui: { visibility: ['app'] } },
  }, async ({ set }) => {
    try { const settings = await service.updateSettings(set); return { content: [], structuredContent: { values: values({ ...settings }) }, _meta: { settings } }; }
    catch (error) { return failure(error); }
  });

  for (const [name, title, appOnly] of [['library_open', '打开文献库', false], ['settings_open', '配置与诊断', true]] as const) {
    server.registerTool(name, {
      title, description: title,
      inputSchema: z.object({ view: z.enum(['library', 'reading', 'notes', 'settings']).optional(), paperPath: key.optional(), vaultId: key.optional() }).strict(),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: URI, visibility: appOnly ? ['app'] : ['model', 'app'] }, 'openai/ui': name === 'library_open' ? { entrypoints: [{ type: 'thread' }] } : {} },
    }, async (input) => ({ content: [], structuredContent: { ok: true, data: { ...input, view: name === 'settings_open' ? 'settings' : input.view ?? 'library' } } }));
  }
  server.registerTool('pdf_read_chunk', {
    title: '读取 PDF 分块', description: '仅供 App 读取所选文献的 PDF；字节不会进入模型内容。',
    inputSchema: z.object({ ...paper, offset: z.number().int().min(0).optional(), length: z.number().int().min(1).max(1024 * 1024).optional(), revision: key.optional() }).strict(),
    annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['app'] } },
  }, async (input) => {
    try { const chunk = await service.readPdfChunk(input); return { content: [], structuredContent: { ok: true, data: { offset: chunk.offset, nextOffset: chunk.nextOffset, totalBytes: chunk.totalBytes, eof: chunk.eof } }, _meta: { pdfChunk: chunk } }; }
    catch (error) { return failure(error); }
  });
  server.registerResource('agentero-library-ui', URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({ contents: [{
    uri: URI, mimeType: RESOURCE_MIME_TYPE,
    text: options.html ?? await readFile(fileURLToPath(new URL('./app.html', import.meta.url)), 'utf8'),
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } },
  }] }));
  return server;
}
