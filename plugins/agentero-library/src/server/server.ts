import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { LibraryService } from '../core/library-service.js';
import { PLUGIN_VERSION } from '../contracts/version.js';
import { pickNativePath, cancelNativePicker, closeNativePickers } from '../infrastructure/native-picker.js';
import { TranslationProvider } from '../infrastructure/translation-provider.js';

const URI = `ui://agentero-library/app/v${PLUGIN_VERSION}`;
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
  const translation = new TranslationProvider(service.dataRoot);
  const server = new McpServer({ name: 'agentero-library', version: PLUGIN_VERSION, title: '文献库' }, {
    capabilities: { experimental: { 'openai/settings': { readTool: 'settings_read', updateTool: 'settings_update' } } },
  });
  function tool(name: string, description: string, shape: z.ZodRawShape, run: (input: any, signal?: AbortSignal) => Promise<unknown>, readOnly = true, appOnly = false, destructive = !readOnly) {
    server.registerTool(name, {
      title: description.split('。')[0], description, inputSchema: z.object(shape).strict(), outputSchema: businessResult,
      annotations: { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: ['paper_import', 'paper_download', 'translate_text'].includes(name) },
      _meta: { ui: { visibility: appOnly ? ['app'] : ['model', 'app'] } },
    }, async (input, extra) => {
      try { return { content: [{ type: 'text', text: `${name} 已完成。` }], structuredContent: { ok: true, data: await run(input, extra.signal) } }; }
      catch (error) { return failure(error); }
    });
  }
  function privatePayload(name: string, description: string, shape: z.ZodRawShape, metaKey: string, run: (input: any, signal?: AbortSignal) => Promise<any>, readOnly = true, appOnly = true) {
    server.registerTool(name, { title: description.split('。')[0], description, inputSchema: z.object(shape).strict(), outputSchema: businessResult,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly }, _meta: { ui: { visibility: appOnly ? ['app'] : ['model', 'app'] } },
    }, async (input, extra) => {
      try {
        const value = await run(input, extra.signal);
        const data = metaKey === 'picker' ? { cancelled: value.cancelled, count: value.paths.length }
          : metaKey === 'layout' ? { regionCount: value.regions?.length ?? 0 }
          : metaKey === 'marks' ? { ...value, items: value.items.slice(0, 100), truncated: value.items.length > 100 }
          : Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'base64' && key !== 'content'));
        return { content: [], structuredContent: { ok: true, data }, _meta: { [metaKey]: value } };
      } catch (error) { return failure(error); }
    });
  }

  tool('library_status', '检查文献插件的 CLI、Vault 与分项能力。缺少依赖时也可调用。', {}, () => service.status());
  tool('library_diagnose', '用户明确点击检测后验证后台 PDF 原生解析；普通状态刷新不会执行导入或解析。', {}, () => service.status({ diagnosePdf: true }), false, true, false);
  tool('paper_list', '列出文献摘要并分页。首次或显式刷新后从 Agentero CLI 获取完整列表快照。', { ...vault, query: z.string().max(1000).optional(), tag: z.array(key).max(100).optional(), unread: z.boolean().optional(), sortBy: z.enum(['title', 'authors', 'year', 'tags', 'date']).optional(), sortDir: z.enum(['asc', 'desc']).optional(), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().max(8192).optional(), refresh: z.boolean().optional() }, (input) => service.listPapers(input));
  tool('paper_get', '读取单篇论文元数据与可用资源，不返回 PDF 字节。', paper, (input) => service.getPaper(input));
  tool('paper_open_external', '用户点击后在系统 PDF 查看器中打开当前知识库的原文，不自动启动。', paper, (input) => service.openPaperExternally(input), false, true, false);
  tool('library_search', '搜索本地元数据、笔记或已有正文。关键词匹配，不是语义检索；正文范围需要开启 Agent 正文访问。', { ...vault, query: z.string().min(1).max(1000), scope: z.enum(['all', 'metadata', 'notes', 'body']).optional(), limit: z.number().int().min(1).max(200).optional(), year: z.number().int().optional(), publication: key.optional(), doi: key.optional(), isRead: z.boolean().optional() }, (input) => service.search(input));
  tool('paper_import', '导入用户明确指定的标识符或本地 PDF，返回后台任务；导入与解析结果分开。', { ...vault, text: key.optional(), filePath: key.optional(), filePaths: z.array(key).min(1).max(100).optional(), parent: key.optional(), noRecognize: z.boolean().optional() }, (input) => service.importPaper(input), false);
  tool('paper_parse', '按明确处理任务解析已有 PDF；写入派生正文，不保证产生版面 layout。不得因普通问答自动解析。', { ...paper, force: z.boolean().optional() }, (input) => service.parsePaper(input), false);
  tool('paper_read', '读取有界正文或已有页级证据。页码为 PDF 物理页 1-based；无版面数据时不虚构页码。', { ...paper, source: z.enum(['auto', 'pdf', 'layout', 'markdown']).optional(), pages: z.array(z.number().int().min(1)).max(5).optional(), page: z.number().int().min(1).optional(), startLine: z.number().int().min(1).optional(), startOffset: z.number().int().min(0).optional(), maxChars: z.number().int().min(1).max(20_000).optional() }, (input) => service.readPaper(input));
  tool('paper_update', '明确修改一种论文属性：阅读状态、标签或元数据；普通问答不自动更新。', { ...paper, isRead: z.boolean().optional(), tags: z.array(key).max(200).optional(), title: key.optional(), authors: z.array(key).max(100).optional(), date: z.string().max(100).optional(), doi: z.string().max(1000).optional(), arxivId: z.string().max(1000).optional(), publication: z.string().max(1000).optional() }, (input) => service.updatePaper(input), false);
  tool('note_list', '列出 notes 下的一层笔记目录；结果有上游截断限制。', { ...vault, path: key.optional(), limit: z.number().int().min(1).max(500).optional() }, (input) => service.listNotes(input));
  tool('note_read', '读取独立笔记或论文 NOTES，返回内容和修订指纹；缺失与空文件分开。', note, (input) => service.readNote(input));
  tool('note_write', '按明确保存任务写笔记。必须带上读取修订号，冲突保留草稿；不保证外部进程 CAS。新路径 revision 为 null，mode 仅 replace/append。', { ...note, content: z.string().max(2_000_000), revision: z.string().nullable(), mode: z.enum(['replace', 'append']).optional() }, (input) => service.writeNote(input), false);
  tool('operation_get', '查询本插件拥有的导入或解析任务及分阶段结果。', operation, (input) => service.getOperation(input));
  tool('operation_cancel', '申请取消本插件拥有的任务；进程实际退出前仍为取消申请，已写内容不自动回滚。', operation, (input) => service.cancelOperation(input), false);
  tool('vault_create', '在用户明确指定的位置创建文献库；不覆盖已有非空目录。', { path: key }, (input) => service.createVault(input), false, true);

  const markKind = z.enum(['highlight', 'underline', 'ask', 'translate', 'visual']);
  const markColor = z.enum(['yellow', 'green', 'blue', 'pink', 'purple']);
  const rect = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive(), h: z.number().positive() }).strict();
  privatePayload('mark_list', '读取论文的标注与备注。模型结果最多100条，可用query/page/kind收窄；App获得完整标注。', { ...paper, query: z.string().max(1000).optional(), page: z.number().int().positive().optional(), kind: markKind.optional() }, 'marks', input => service.listMarks(input), true, false);
  privatePayload('mark_add', '按明确操作保存精确选区标注或备注。坐标为未旋转PDF裁剪页、左上原点的pt，页码1-based。', { ...paper, revision: key, kind: markKind, page: z.number().int().positive(), rects: z.array(rect).min(1).max(1000), pageSize: z.object({ width: z.number().positive(), height: z.number().positive() }), quote: z.string().max(20000), color: markColor.optional(), comment: z.string().max(20000).optional(), question: z.string().max(20000).optional(), result: z.string().max(20000).optional(), asset: z.object({ mediaType: z.literal('image/png'), data: z.string().max(6000000) }).optional() }, 'marks', input => service.addMark(input), false, false);
  privatePayload('mark_update', '更新标注颜色、备注、译文或追加回复。必须携带最新revision，冲突时重新读取。', { ...paper, revision: key, id: key, comment: z.string().max(20000).optional(), color: markColor.optional(), result: z.string().max(20000).optional(), reply: z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20000) }).optional() }, 'marks', input => service.updateMark(input), false, false);
  privatePayload('mark_delete', '删除用户明确选定的一条标注，使用最新revision避免静默覆盖其他修改。', { ...paper, revision: key, id: key }, 'marks', input => service.deleteMark(input), false, false);
  privatePayload('mark_asset_read', '仅供App读取标注已有的区域截图。', { ...paper, id: key }, 'asset', input => service.readMarkAsset(input));
  privatePayload('paper_layout', '仅供App获取当前论文的已有版面，用于逐段保版面翻译。缺失时保留可用原文。', paper, 'layout', input => service.readLayout(input));
  privatePayload('paper_markdown', '仅供App预览论文已有PAPER.md，不向模型提供未授权正文。', paper, 'document', input => service.readPaperMarkdown(input));
  tool('reader_state_get', '读取当前文献的阅读位置与显示偏好。', paper, input => service.readReaderState(input), true, true);
  tool('reader_state_set', '保存当前文献的阅读位置与显示偏好，不修改论文正文。', { ...paper, state: z.record(z.string(), z.unknown()) }, input => service.writeReaderState(input), false, true);
  const bookmarkNode: z.ZodType<any> = z.lazy(() => z.object({ title: z.string().max(2000), origin: z.string().nullable(), originalTitle: z.string().max(2000).optional(), pageIndex: z.number().int().nonnegative().optional(), children: z.array(bookmarkNode).max(2000) }).strict());
  tool('pdf_bookmarks_write', '将用户编辑的目录书签写回PDF，保留原有链接目的地；必须携带PDF revision。', { ...paper, revision: key, nodes: z.array(bookmarkNode).max(2000) }, input => service.writePdfBookmarks(input), false);
  privatePayload('paper_export', '导出带标注PDF、标注Markdown或JSON。二进制仅交给App；filePath为用户明确选择的保存位置。', { ...paper, format: z.enum(['pdf', 'markdown', 'json']), includeMarks: z.boolean().optional(), filePath: key.optional(), revision: key.optional() }, 'export', input => service.exportPaper(input), false, false);
  tool('translate_text', '翻译用户明确选择的文字或页内段落。使用已配置的CLI或兼容模型服务，不使用Codex登录态。', { ...vault, text: z.string().min(1).max(12000), to: z.string().max(40).optional(), from: z.string().max(40).optional(), provider: z.string().max(100).optional() }, async (input, signal) => {
    await service.validateScope(input);
    const settings = await translation.read();
    const request = { ...input, to: input.to || settings.targetLanguage };
    return settings.provider === 'openai' ? translation.translate(request, signal) : service.translateText(request, signal);
  });
  tool('translation_settings_read', '读取翻译配置，只返回密钥是否存在，不回显密钥。', {}, () => translation.read(), true, true);
  tool('translation_settings_update', '保存本机翻译服务配置，只有用户主动翻译才会调用该服务。', { set: z.object({ provider: z.enum(['cli', 'openai']).optional(), baseUrl: z.string().max(2048).optional(), model: z.string().max(2048).optional(), targetLanguage: z.string().max(40).optional(), apiKey: z.string().max(8192).optional(), clearApiKey: z.boolean().optional() }).strict() }, input => translation.update(input.set), false, true);
  tool('note_rename', '重命名独立Markdown笔记并保留链接，需读取revision；目标已存在时不覆盖。', { ...vault, path: key, newPath: key, revision: key }, input => service.renameNote(input), false);
  tool('note_links', '读取笔记的内部链接与反向引用，并报告扫描限制。', note, input => service.noteLinks(input));
  privatePayload('note_asset_read', '仅供App读取笔记范围内的图片附件。', { ...vault, notePath: key, assetPath: key }, 'asset', input => service.readNoteAsset(input));
  privatePayload('note_asset_import', '按用户选择为笔记导入本机图片，正文保存相对Markdown路径。', { ...vault, notePath: key, filePath: key.optional(), base64: z.string().max(12 * 1024 * 1024).optional(), fileName: key, mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']) }, 'asset', input => service.importNoteAsset(input), false);
  tool('paper_tag', '按用户操作增删标签；颜色使用上游name:blue等已知颜色ID格式。', { ...paper, op: z.enum(['add', 'rm']), tag: key }, input => service.changeTag(input), false);
  tool('paper_delete', '将用户明确指定的论文移入Vault回收站，首版不提供永久删除。', paper, input => service.deletePaper(input), false);
  tool('paper_download', '为已入库的文献补下载可用PDF／TeX资源，返回实际资源结果。', paper, input => service.downloadPaper(input), false);
  tool('bibliography_import', '导入用户指定的BibTeX文本或本机文件，结果按实际上游返回。', { ...vault, text: z.string().max(2 * 1024 * 1024).optional(), filePath: key.optional() }, input => service.importBibliography(input), false);
  privatePayload('bibliography_export', '导出文献库BibTeX到用户选择的位置，App可获得文本，模型只获得文件摘要。', { ...vault, filePath: key.optional() }, 'export', input => service.exportBibliography(input), false, false);
  const pickerRequestId = z.string().uuid();
  privatePayload('file_picker', '打开系统文件、文件夹或保存位置选择器，取消不会修改配置。requestId为当前App生成的唯一UUID。', { requestId: pickerRequestId, mode: z.enum(['open-file', 'open-directory', 'save-file']), title: z.string().max(160).optional(), defaultPath: z.string().max(4096).optional(), multiple: z.boolean().optional(), filters: z.array(z.object({ name: z.string().max(80), extensions: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_+-]{0,19}$/)).min(1).max(20) })).max(12).optional() }, 'picker', ({ requestId, ...input }, signal) => pickNativePath(input, { signal, requestId }), true);
  tool('file_picker_cancel', '取消当前App拥有的系统选择器。返回前等待该请求的对话进程退出；提前取消会阻止5分钟内的延迟请求打开，不写用户文件。', { requestId: pickerRequestId }, input => cancelNativePicker(input.requestId), true, true);

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
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: ['blob:', 'data:'] }, prefersBorder: false }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } },
  }] }));
  const originalClose = server.close.bind(server);
  let closing: Promise<void> | undefined;
  server.close = () => closing ??= (async () => { await translation.close(); await closeNativePickers(); await originalClose(); })();
  return server;
}
