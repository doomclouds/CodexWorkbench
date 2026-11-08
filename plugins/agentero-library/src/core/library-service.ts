import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  CliRunner, DiscoverInput, ImportPaperInput, LibraryOperation, LibraryServiceOptions, LibrarySettings,
  LibraryStatus, ListNotesInput, ListPapersInput, NativeBackend, NoteDocument, NoteInput, NoteList,
  OperationInput, Paper, PaperInput, PaperPage, PaperRead, ParsePaperInput, PdfChunk, PdfChunkInput,
  ReadPaperInput, SearchInput, SettingsPatch, UpdatePaperInput, VaultInput, WriteNoteInput,
} from '../contracts/types.js';
import { asLibraryError, LibraryError } from '../contracts/errors.js';
import { ProcessCliRunner } from '../infrastructure/cli.js';
import { atomicJson, containedPath, contentRevision, exists, expandHome, readJson, relativePath } from '../infrastructure/files.js';
import { createNativeBackend } from '../infrastructure/native-mcp.js';
import { diagnosticPdf } from '../infrastructure/pdf-probe.js';

interface Context { id: string; path: string; settings: LibrarySettings }
interface Snapshot { id: string; vaultId: string; createdAt: number; items: Paper[] }
interface OperationState { public: LibraryOperation; controller: AbortController; done: Promise<void> }
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_PDF_CHUNK = 1024 * 1024;
const activeStatuses = new Set(['queued', 'running', 'cancel_requested']);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : String(record(item).name ?? '')).filter(Boolean) : [];

export class LibraryService {
  readonly dataRoot: string;
  readonly instanceId = randomUUID();
  private readonly runner: CliRunner;
  private readonly factory: NonNullable<LibraryServiceOptions['nativeFactory']>;
  private readonly snapshotTtl: number;
  private settingsPromise?: Promise<LibrarySettings>;
  private settingsChain: Promise<unknown> = Promise.resolve();
  private native?: Promise<NativeBackend>;
  private nativeAbort?: AbortController;
  private snapshot?: Snapshot;
  private cliProbe?: { key: string; at: number; result: LibraryStatus['cli'] };
  private pdfProbe?: { key: string; at: number; result: LibraryStatus['pdfium'] };
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly operations = new Map<string, OperationState>();
  private busyWrites = 0;
  private closed = false;

  constructor(options: LibraryServiceOptions = {}) {
    this.dataRoot = resolve(expandHome(options.dataRoot ?? join(homedir(), '.codexworkbench', 'agentero-library')));
    this.runner = options.cliRunner ?? new ProcessCliRunner();
    this.factory = options.nativeFactory ?? createNativeBackend;
    this.snapshotTtl = options.snapshotTtlMs ?? 30_000;
  }

  async readSettings(): Promise<LibrarySettings> {
    this.settingsPromise ??= this.loadSettings();
    return { ...await this.settingsPromise };
  }

  private async loadSettings(): Promise<LibrarySettings> {
    const value = await readJson(join(this.dataRoot, 'config.json'));
    if (value === undefined) return { schemaVersion: 1, cliPath: 'agentero', vaultPath: '', pdfiumPath: '', allowAgentPdfText: false, vaultId: null };
    const data = record(value);
    if (data.schemaVersion !== 1 || typeof data.cliPath !== 'string' || typeof data.vaultPath !== 'string' || typeof data.pdfiumPath !== 'string' || typeof data.allowAgentPdfText !== 'boolean' || !(data.vaultId === null || typeof data.vaultId === 'string')) {
      throw new LibraryError('CONFIG_INVALID', '插件配置格式不受支持，请检查 config.json。');
    }
    return data as unknown as LibrarySettings;
  }

  async updateSettings(patch: SettingsPatch): Promise<LibrarySettings> {
    const task = this.settingsChain.then(async () => {
      this.ensureOpen();
      for (const key of Object.keys(patch)) if (!['cliPath', 'vaultPath', 'pdfiumPath', 'allowAgentPdfText'].includes(key)) throw new LibraryError('INVALID_SETTINGS', `不支持的配置项：${key}`);
      const current = await this.readSettings();
      const next = { ...current };
      for (const key of ['cliPath', 'vaultPath', 'pdfiumPath'] as const) if (patch[key] !== undefined) {
        if (typeof patch[key] !== 'string') throw new LibraryError('INVALID_SETTINGS', '路径配置必须是字符串。');
        next[key] = expandHome(patch[key]);
      }
      if (!next.cliPath) next.cliPath = 'agentero';
      if (patch.allowAgentPdfText !== undefined) {
        if (typeof patch.allowAgentPdfText !== 'boolean') throw new LibraryError('INVALID_SETTINGS', '正文读取开关必须是布尔值。');
        next.allowAgentPdfText = patch.allowAgentPdfText;
      }
      if (next.vaultPath) next.vaultPath = await this.validateVault(next.vaultPath);
      if (next.pdfiumPath) {
        next.pdfiumPath = resolve(next.pdfiumPath);
        if (await exists(next.pdfiumPath) && (await stat(next.pdfiumPath)).isFile()) next.pdfiumPath = dirname(next.pdfiumPath);
      }
      const changed = next.vaultPath !== current.vaultPath;
      if ((changed || next.cliPath !== current.cliPath || next.pdfiumPath !== current.pdfiumPath || next.allowAgentPdfText !== current.allowAgentPdfText) && (this.busyWrites || this.activeOperationCount())) {
        throw new LibraryError('VAULT_BUSY', '存在运行中的任务或保存操作，请完成或取消后再修改连接。');
      }
      next.vaultId = changed ? (next.vaultPath ? randomUUID() : null) : (next.vaultPath ? current.vaultId ?? randomUUID() : null);
      await atomicJson(join(this.dataRoot, 'config.json'), next);
      await this.closeNative();
      this.settingsPromise = Promise.resolve(next);
      this.snapshot = undefined;
      this.cliProbe = undefined;
      this.pdfProbe = undefined;
      return { ...next };
    });
    this.settingsChain = task.catch(() => undefined);
    return task;
  }

  private ensureOpen() { if (this.closed) throw new LibraryError('SERVICE_CLOSED', '插件服务已关闭。'); }
  private activeOperationCount() { return [...this.operations.values()].filter(item => activeStatuses.has(item.public.status)).length; }

  private async validateVault(input: string): Promise<string> {
    const path = resolve(expandHome(input));
    if (!(await exists(path)) || !(await stat(path)).isDirectory() || !(await exists(join(path, '.agentero', 'catalog.sqlite'))) || !(await exists(join(path, 'papers')))) {
      throw new LibraryError('VAULT_INVALID', '该目录不是已有 Agentero Vault，请选择已有知识库或明确创建新库。');
    }
    return realpath(path);
  }

  private async context(input: VaultInput): Promise<Context> {
    this.ensureOpen();
    const settings = await this.readSettings();
    if (!settings.vaultId || !settings.vaultPath) throw new LibraryError('VAULT_NOT_CONFIGURED', '请先在设置中连接或创建知识库。');
    if (input.vaultId !== settings.vaultId) throw new LibraryError('VAULT_CHANGED', '知识库已切换，请重新载入当前视图。');
    return { id: settings.vaultId, path: await this.validateVault(settings.vaultPath), settings };
  }

  private async cli(settings: LibrarySettings, args: string[], signal?: AbortSignal, timeoutMs = 30_000): Promise<unknown> {
    const result = await this.runner.run({ cliPath: settings.cliPath, args, dataRoot: this.dataRoot, pdfiumPath: settings.pdfiumPath, signal, timeoutMs });
    if (result.cancelled && result.code !== 0) throw new LibraryError('OPERATION_CANCELLED', '任务已停止；已写入的文件不会自动回滚。');
    if (result.timedOut) throw new LibraryError('UPSTREAM_TIMEOUT', 'Agentero 操作超时，请先核实知识库内容再重试。');
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(result.stdout)); } catch { throw new LibraryError('UPSTREAM_INVALID', 'CLI 没有返回有效 JSON。', false, { diagnostic: result.stderr.slice(-1500) }); }
    if (result.code !== 0 || envelope.ok !== true) {
      const error = record(envelope.error);
      const message = String(error.message ?? result.stderr ?? 'CLI 操作失败。');
      if (/pdfium|libraryunavailable|pdf engine/i.test(message)) throw new LibraryError('PDF_ENGINE_UNAVAILABLE', 'PDF 原生引擎不可用，请配置 PDFium。');
      throw new LibraryError('UPSTREAM_FAILED', message.slice(0, 2000), false, { upstreamCode: error.code });
    }
    return envelope.data;
  }

  private async probeCli(settings: LibrarySettings): Promise<LibraryStatus['cli']> {
    if (this.cliProbe?.key === settings.cliPath && Date.now() - this.cliProbe.at < 10_000) return this.cliProbe.result;
    let result: LibraryStatus['cli'];
    try {
      const versionResult = await this.runner.run({ cliPath: settings.cliPath, args: ['--version'], dataRoot: this.dataRoot, timeoutMs: 5000 });
      const version = `${versionResult.stdout}\n${versionResult.stderr}`.match(/\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/)?.[1] ?? null;
      if (versionResult.code !== 0 || !version) throw new LibraryError('CLI_NOT_FOUND', 'Agentero CLI 无法运行，请检查可执行文件路径。');
      const supported = version === '0.15.2';
      if (supported) {
        const description = record(await this.cli(settings, ['--json', 'describe', 'paper.list']));
        if (description.id !== 'paper.list') throw new LibraryError('CLI_UNSUPPORTED', 'CLI 缺少文献列表的机器契约。');
      }
      result = { available: true, supported, path: settings.cliPath, version, ...(!supported ? { error: '首版已验证 Agentero 0.15.2，请使用该版本。' } : {}) };
    } catch (error) { result = { available: false, supported: false, path: settings.cliPath, version: null, error: asLibraryError(error).message }; }
    this.cliProbe = { key: settings.cliPath, at: Date.now(), result };
    return result;
  }

  private async requireCli(settings: LibrarySettings): Promise<void> {
    const cli = await this.probeCli(settings);
    if (!cli.available) throw new LibraryError('CLI_NOT_FOUND', cli.error ?? '未找到 Agentero CLI。');
    if (!cli.supported) throw new LibraryError('CLI_UNSUPPORTED', cli.error ?? 'CLI 版本不受支持。');
  }

  private async probePdf(settings: LibrarySettings): Promise<LibraryStatus['pdfium']> {
    const key = `${settings.cliPath}\0${settings.pdfiumPath}`;
    if (this.pdfProbe?.key === key && Date.now() - this.pdfProbe.at < 60_000) return this.pdfProbe.result;
    let result: LibraryStatus['pdfium'];
    try {
      const directory = join(this.dataRoot, 'cache', 'diagnostics', createHash('sha256').update(key).digest('hex').slice(0, 16));
      const vault = join(directory, 'vault');
      await mkdir(directory, { recursive: true });
      if (!(await exists(join(vault, '.agentero', 'catalog.sqlite')))) await this.cli(settings, ['--json', 'vault', 'create', vault]);
      const pdf = join(directory, 'codex-workbench-probe.pdf');
      await writeFile(pdf, diagnosticPdf());
      const imported = record(await this.cli(settings, ['--json', '--vault', vault, 'import', 'pdf', pdf, '--no-recognize']));
      const papers = Array.isArray(imported.papers) ? imported.papers : [];
      const path = String(record(papers[0]).path ?? 'papers/codex-workbench-probe');
      await this.cli(settings, ['--json', '--vault', vault, 'paper', 'parse', path, '--force'], undefined, 30_000);
      result = { configured: !!settings.pdfiumPath, available: true, path: settings.pdfiumPath, diagnostic: '已使用隔离 PDF 验证原生解析。' };
    } catch (error) { result = { configured: !!settings.pdfiumPath, available: false, path: settings.pdfiumPath, diagnostic: asLibraryError(error).message }; }
    this.pdfProbe = { key, at: Date.now(), result };
    return result;
  }

  async status(): Promise<LibraryStatus> {
    this.ensureOpen();
    const settings = await this.readSettings();
    const cli = await this.probeCli(settings);
    let valid = false;
    let vaultError: string | undefined;
    if (settings.vaultPath) try { await this.validateVault(settings.vaultPath); valid = !!settings.vaultId; } catch (error) { vaultError = asLibraryError(error).message; }
    const pdfium = cli.supported ? await this.probePdf(settings) : { configured: !!settings.pdfiumPath, available: false, path: settings.pdfiumPath, diagnostic: '请先配置可用 CLI。' };
    const ready = cli.available && cli.supported && valid;
    return {
      ready, instanceId: this.instanceId, dataRoot: this.dataRoot, defaultVaultPath: join(this.dataRoot, 'vault'), cli,
      vault: { configured: !!settings.vaultId, valid, vaultId: settings.vaultId, path: settings.vaultPath, name: settings.vaultPath ? basename(settings.vaultPath) : '', ...(vaultError ? { error: vaultError } : {}) },
      capabilities: { metadata: ready, notes: ready, pdfRead: ready, pdfText: ready && settings.allowAgentPdfText && pdfium.available, pdfParse: ready && pdfium.available, layout: ready },
      capabilityScope: 'service-support',
      pdfium, allowAgentPdfText: settings.allowAgentPdfText, activeOperations: this.activeOperationCount(), recoveryDrafts: await this.recoveryDraftCount(),
    };
  }

  async createVault(input: { path: string }): Promise<LibrarySettings> {
    this.ensureOpen();
    if (typeof input.path !== 'string' || !input.path.trim()) throw new LibraryError('INVALID_PATH', '请明确指定新知识库目录。');
    const settings = await this.readSettings();
    await this.requireCli(settings);
    const path = resolve(expandHome(input.path));
    if (await exists(path) && (!(await stat(path)).isDirectory() || (await readdir(path)).length > 0)) throw new LibraryError('VAULT_EXISTS', '目标目录不是空目录，请连接已有库或选择新的空目录。');
    await this.cli(settings, ['--json', 'vault', 'create', path]);
    return this.updateSettings({ vaultPath: path });
  }

  private async backend(context: Context): Promise<NativeBackend> {
    this.ensureOpen();
    await this.requireCli(context.settings);
    this.ensureOpen();
    if ((await this.readSettings()).vaultId !== context.id) throw new LibraryError('VAULT_CHANGED', '知识库已切换，请重新载入。');
    if (!this.native) {
      this.nativeAbort = new AbortController();
      const pending = this.factory({ settings: context.settings, dataRoot: this.dataRoot, vaultPath: context.path, signal: this.nativeAbort.signal }).catch(error => { if (this.native === pending) this.native = undefined; throw error; });
      this.native = pending;
    }
    return this.native;
  }

  private async call(context: Context, name: string, args: Record<string, unknown>) {
    const backend = await this.backend(context);
    try { return await backend.call(name, { ...args, vault: context.path }); }
    catch (error) {
      if (error instanceof LibraryError && error.code === 'UPSTREAM_CLOSED') {
        const slot = this.native;
        if (slot && await slot.catch(() => undefined) === backend && this.native === slot) await this.closeNative();
      }
      throw error;
    }
  }

  private normalizePaper(value: unknown): Paper {
    const item = record(value);
    return {
      ...item, id: String(item.id ?? ''), path: String(item.path ?? '').replaceAll('\\', '/'), title: String(item.title ?? ''),
      authors: strings(item.authors), tags: strings(item.tags), isRead: Boolean(item.isRead ?? item.is_read),
      ...(item.arxiv_id ? { arxivId: String(item.arxiv_id) } : {}),
    } as Paper;
  }

  private async paperPath(context: Context, input: string): Promise<string> {
    const path = relativePath(input);
    if (!path.startsWith('papers/')) throw new LibraryError('INVALID_PATH', '论文引用必须是 papers/ 下的论文目录。');
    const actual = await containedPath(context.path, path);
    if (!(await stat(actual)).isDirectory()) throw new LibraryError('INVALID_PATH', '论文引用不是目录。');
    return path;
  }

  async listPapers(input: ListPapersInput): Promise<PaperPage> {
    const context = await this.context(input);
    if (input.sortBy && !['title', 'year', 'date'].includes(input.sortBy)) throw new LibraryError('INVALID_SORT', '仅支持按标题、年份或日期排序。');
    await this.requireCli(context.settings);
    if (input.refresh || !this.snapshot || this.snapshot.vaultId !== context.id || Date.now() - this.snapshot.createdAt > this.snapshotTtl) {
      const data = await this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'list', '--fields', 'authors,year,date,tags,is_read,publication,doi']);
      if (!Array.isArray(data)) throw new LibraryError('UPSTREAM_INVALID', 'CLI 文献列表格式无效。');
      this.snapshot = { id: randomUUID(), vaultId: context.id, createdAt: Date.now(), items: data.map(value => this.normalizePaper(value)) };
    }
    const snapshot = this.snapshot;
    const fingerprint = createHash('sha256').update(JSON.stringify([input.query ?? '', input.tag ?? [], input.unread ?? false, input.sortBy ?? 'title', input.sortDir ?? 'asc'])).digest('hex');
    let offset = 0;
    if (input.cursor) {
      let cursor;
      try { cursor = record(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); } catch { throw new LibraryError('CURSOR_EXPIRED', '列表游标无效，请重新读取第一页。', true); }
      if (cursor.snapshot !== snapshot.id || cursor.vault !== context.id || cursor.query !== fingerprint || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0) throw new LibraryError('CURSOR_EXPIRED', '文献快照或筛选已变化，请重新读取第一页。', true);
      offset = Number(cursor.offset);
    }
    const query = (input.query ?? '').trim().toLocaleLowerCase();
    let items = snapshot.items.filter(paper => (!query || [paper.title, paper.id, paper.path, ...paper.authors, ...paper.tags].some(text => text.toLocaleLowerCase().includes(query))) && (!input.unread || !paper.isRead) && (!input.tag?.length || input.tag.every(tag => paper.tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase()))));
    const key = input.sortBy ?? 'title';
    const direction = input.sortDir === 'desc' ? -1 : 1;
    items = items.toSorted((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true }) * direction || a.path.localeCompare(b.path));
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 50)));
    const nextOffset = offset + limit;
    return { vaultId: context.id, snapshotId: snapshot.id, items: items.slice(offset, nextOffset), total: items.length, nextCursor: nextOffset < items.length ? Buffer.from(JSON.stringify({ snapshot: snapshot.id, vault: context.id, query: fingerprint, offset: nextOffset })).toString('base64url') : null, complete: true };
  }

  async getPaper(input: PaperInput): Promise<Record<string, unknown>> {
    const context = await this.context(input);
    const path = await this.paperPath(context, input.paperPath);
    const [metadata, paths] = await Promise.all([this.call(context, 'paper_get', { ref: path }), this.call(context, 'paper_paths', { ref: path })]);
    const hasPdf = (await readdir(await containedPath(context.path, path))).some(name => name.toLowerCase().endsWith('.pdf'));
    const hasMarkdown = await exists(await containedPath(context.path, `${path}/PAPER.md`, true));
    const hasLayout = await exists(await containedPath(context.path, `${path}/source/layout.json`, true));
    return { vaultId: context.id, ...this.normalizePaper(metadata), paths: paths.paths, hasPdf, hasMarkdown, hasLayout };
  }

  async search(input: SearchInput): Promise<Record<string, unknown>> {
    const context = await this.context(input);
    const scope = input.scope ?? 'all';
    if (!['all', 'metadata', 'notes', 'body'].includes(scope)) throw new LibraryError('INVALID_SCOPE', '搜索范围无效。');
    if (scope === 'body' && !context.settings.allowAgentPdfText) throw new LibraryError('TEXT_ACCESS_DISABLED', '请先允许 Agent 读取论文正文。');
    const query = String(input.query ?? '').trim();
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 60)));
    if (!query) return { vaultId: context.id, hits: [], truncated: false };
    if (query.length > 1000) throw new LibraryError('INVALID_QUERY', '搜索词过长，请缩小问题范围。');
    const hits: Record<string, unknown>[] = [];
    if (scope === 'metadata' || scope === 'all') {
      await this.listPapers({ vaultId: context.id });
      const terms = query.toLocaleLowerCase().split(/\s+/);
      for (const paper of this.snapshot?.items ?? []) {
        const text = [paper.title, paper.id, paper.path, paper.doi ?? '', paper.publication ?? '', ...paper.authors, ...paper.tags].join(' ').toLocaleLowerCase();
        if (!terms.every(term => text.includes(term))) continue;
        if (input.year !== undefined && paper.year !== input.year) continue;
        if (input.isRead !== undefined && paper.isRead !== input.isRead) continue;
        if (input.publication && !String(paper.publication ?? '').toLowerCase().includes(input.publication.toLowerCase())) continue;
        if (input.doi && !String(paper.doi ?? '').toLowerCase().includes(input.doi.toLowerCase())) continue;
        hits.push({ path: paper.path, paperPath: paper.path, title: paper.title, snippet: paper.title, source: 'metadata' });
      }
    }
    let upstreamTruncated = false;
    let scopePostFiltered = false;
    if (scope !== 'metadata') {
      const output = await this.call(context, 'vault_search', { query, limit: 200, ...(input.year !== undefined ? { year: input.year } : {}), ...(input.publication ? { publication: input.publication } : {}), ...(input.doi ? { doi: input.doi } : {}), ...(input.isRead !== undefined ? { isRead: input.isRead } : {}) });
      upstreamTruncated = output.truncated === true;
      for (const raw of Array.isArray(output.hits) ? output.hits : []) {
        const hit = record(raw);
        const path = typeof hit.path === 'string' ? relativePath(hit.path) : '';
        const body = /(?:^|\/)PAPER\.md$/i.test(path);
        const note = path.startsWith('notes/') || /^papers\/.+\/NOTES\.md$/.test(path);
        const allowed = body ? context.settings.allowAgentPdfText && scope !== 'notes' : note && scope !== 'body';
        if (!allowed) { scopePostFiltered = true; continue; }
        hits.push({ ...hit, source: body ? 'body' : 'notes' });
      }
    }
    return {
      vaultId: context.id, hits: hits.slice(0, limit), truncated: upstreamTruncated || hits.length > limit,
      diagnostics: { scopePostFiltered, upstreamTruncated, scanMayBeIncomplete: scope !== 'metadata', maxDepth: 16, maxFiles: 20_000, maxFileBytes: MAX_NOTE_BYTES, semantics: 'keyword-and', bodyExcluded: !context.settings.allowAgentPdfText },
    };
  }

  async discover(input: DiscoverInput): Promise<Record<string, unknown>> {
    const context = await this.context(input);
    if (!input.keywords?.some(value => value.trim()) && !input.categories?.some(value => value.trim())) throw new LibraryError('INVALID_QUERY', '请至少提供一个关键词或 arXiv 分类。');
    return { vaultId: context.id, ...await this.call(context, 'discover_arxiv', { keywords: input.keywords ?? [], categories: input.categories ?? [], ...(input.since ? { since: input.since } : {}), ...(input.until ? { until: input.until } : {}), ...(input.top !== undefined ? { top: input.top } : {}), ...(input.maxCandidates !== undefined ? { maxCandidates: input.maxCandidates } : {}), dedup: input.dedup ?? true }) };
  }

  private startOperation(context: Context, type: 'import' | 'parse', run: (signal: AbortSignal) => Promise<unknown>, paperPath?: string): LibraryOperation {
    const operationId = `${this.instanceId}:${randomUUID()}`;
    const now = new Date().toISOString();
    const operation: LibraryOperation = { operationId, instanceId: this.instanceId, vaultId: context.id, type, status: 'queued', stage: 'queued', createdAt: now, updatedAt: now, ...(paperPath ? { paperPath } : {}) };
    const controller = new AbortController();
    const done = Promise.resolve().then(async () => {
      if (controller.signal.aborted) { operation.status = 'cancelled'; operation.stage = 'cancelled'; return; }
      operation.status = 'running'; operation.stage = type;
      try { operation.result = await run(controller.signal); operation.status = 'succeeded'; operation.stage = 'complete'; }
      catch (error) {
        const failure = asLibraryError(error);
        operation.status = failure.code === 'OPERATION_CANCELLED' ? 'cancelled' : 'failed';
        operation.stage = operation.status;
        operation.error = { code: failure.code, message: failure.message, retryable: failure.retryable };
      } finally { operation.updatedAt = new Date().toISOString(); this.snapshot = undefined; }
    });
    this.operations.set(operationId, { public: operation, controller, done });
    return structuredClone(operation);
  }

  async importPaper(input: ImportPaperInput): Promise<LibraryOperation> {
    const context = await this.context(input);
    await this.requireCli(context.settings);
    if (!!input.text?.trim() === !!input.filePath?.trim()) throw new LibraryError('INVALID_IMPORT', '请提供论文标识符或本地 PDF 路径中的一个。');
    const parent = relativePath(input.parent ?? 'papers');
    if (parent !== 'papers' && !parent.startsWith('papers/')) throw new LibraryError('INVALID_PATH', '导入目录必须位于 papers/。');
    let file: string | undefined;
    if (input.filePath) {
      file = resolve(expandHome(input.filePath));
      if (!file.toLowerCase().endsWith('.pdf') || !(await stat(file)).isFile()) throw new LibraryError('INVALID_IMPORT', '请选择已有的本地 PDF 文件。');
    }
    const localFile = file;
    return this.startOperation(context, 'import', async signal => {
      const args = ['--json', '--vault', context.path, 'import', localFile ? 'pdf' : 'id', localFile ?? input.text!.trim(), '--parent', parent];
      if (localFile && (input.noRecognize ?? true)) args.push('--no-recognize');
      const result = await this.cli(context.settings, args, signal, 300_000);
      return { data: result, ...(localFile && (input.noRecognize ?? true) ? { metadataSource: 'filename', warning: '本次跳过元数据识别，可后续完善。' } : {}) };
    });
  }

  async parsePaper(input: ParsePaperInput): Promise<LibraryOperation> {
    const context = await this.context(input);
    const path = await this.paperPath(context, input.paperPath);
    await this.requireCli(context.settings);
    return this.startOperation(context, 'parse', signal => this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'parse', path, ...(input.force ? ['--force'] : [])], signal, 300_000), path);
  }

  async updatePaper(input: UpdatePaperInput): Promise<Record<string, unknown>> {
    const context = await this.context(input);
    const path = await this.paperPath(context, input.paperPath);
    const metadata: Record<string, unknown> = {};
    for (const field of ['title', 'authors', 'date', 'doi', 'arxivId', 'publication'] as const) if (input[field] !== undefined) metadata[field] = input[field];
    if (!Object.keys(metadata).length && input.tags === undefined && input.isRead === undefined) throw new LibraryError('INVALID_UPDATE', '没有需要更新的文献字段。');
    const groups = Number(Object.keys(metadata).length > 0) + Number(input.tags !== undefined) + Number(input.isRead !== undefined);
    if (groups > 1) throw new LibraryError('INVALID_UPDATE', '一次请求只能修改元数据、标签或阅读状态中的一组，请分别提交。');
    try {
      const output = Object.keys(metadata).length ? await this.call(context, 'paper_set_meta', { ref: path, ...metadata })
        : input.tags !== undefined ? await this.call(context, 'paper_tag_set', { ref: path, tags: input.tags })
          : await this.call(context, 'paper_set_read', { ref: path, isRead: input.isRead });
      return { vaultId: context.id, ...this.normalizePaper(output) };
    } finally { this.snapshot = undefined; }
  }

  async getOperation(input: OperationInput): Promise<LibraryOperation> {
    const state = this.operations.get(input.operationId);
    if (!state || !input.operationId.startsWith(`${this.instanceId}:`) || (input.instanceId && input.instanceId !== this.instanceId)) throw new LibraryError('OPERATION_NOT_FOUND', '该任务不属于当前服务实例，可能已随服务退出而结束。');
    if (input.vaultId && input.vaultId !== state.public.vaultId) throw new LibraryError('VAULT_CHANGED', '任务所属知识库与引用不一致。');
    return structuredClone(state.public);
  }

  async cancelOperation(input: OperationInput): Promise<LibraryOperation> {
    await this.getOperation(input);
    const state = this.operations.get(input.operationId)!;
    if (activeStatuses.has(state.public.status)) { state.public.status = 'cancel_requested'; state.public.stage = 'stopping'; state.public.updatedAt = new Date().toISOString(); state.controller.abort(); }
    return structuredClone(state.public);
  }

  async readPaper(input: ReadPaperInput): Promise<PaperRead> {
    const context = await this.context(input);
    if (!context.settings.allowAgentPdfText) throw new LibraryError('TEXT_ACCESS_DISABLED', '请先允许 Agent 读取论文正文。');
    const path = await this.paperPath(context, input.paperPath);
    const budget = Math.min(20_000, Math.max(1, Math.trunc(input.maxChars ?? 20_000)));
    const source = input.source ?? 'auto';
    if (!['auto', 'pdf', 'layout', 'markdown'].includes(source)) throw new LibraryError('INVALID_SOURCE', '正文来源无效。');
    if (source === 'layout') {
      const page = input.page ?? input.pages?.[0] ?? 1;
      if (!Number.isInteger(page) || page < 1) throw new LibraryError('INVALID_PAGE', 'PDF 页码从 1 开始。');
      if (!(await exists(await containedPath(context.path, `${path}/source/layout.json`, true)))) throw new LibraryError('PARSE_REQUIRED', '该论文尚无版面数据；普通正文解析不会生成完整 layout。');
      const data = await this.call(context, 'page_read', { ref: path, page });
      const regions = Array.isArray(data.textRegions) ? data.textRegions : [];
      const full = regions.map(item => String(record(item).text ?? '')).join('\n');
      // Body text is returned once. The upstream page may be arbitrarily large;
      // never bypass the budget by copying regions with their text into pages.
      return { vaultId: context.id, paperPath: path, source: 'layout', content: full.slice(0, budget), pages: [{ page, regionCount: Number(data.regionCount ?? regions.length) }], pageCount: Number(data.pageCount ?? 0), truncated: full.length > budget };
    }
    if (source === 'pdf' || source === 'auto') {
      const pages = input.pages ?? [input.page ?? 1];
      if (!pages.length || pages.length > 5 || pages.some(page => !Number.isInteger(page) || page < 1)) throw new LibraryError('INVALID_PAGE', '每次读取 1–5 个物理页，页码从 1 开始。');
      try {
        const data = await this.call(context, 'paper_text_get', { ref: path, pages, maxChars: Math.max(1, Math.floor(budget / pages.length)) });
        const output = Array.isArray(data.pages) ? data.pages.map(record) : [];
        const full = output.map(item => String(item.text ?? '')).join('\n');
        const truncated = full.length > budget || output.some(item => Number(item.charCount ?? 0) > String(item.text ?? '').length);
        return { vaultId: context.id, paperPath: path, source: 'pdf', content: full.slice(0, budget), pages: output.map(item => ({ page: item.page, charCount: item.charCount })), pageCount: Number(data.pageCount ?? 0), truncated };
      } catch (error) { if (source === 'pdf') throw error; }
    }
    const bodyPath = `${path}/PAPER.md`;
    if (!(await exists(await containedPath(context.path, bodyPath, true)))) throw new LibraryError('PARSE_REQUIRED', '没有可读的已有正文，请配置原生引擎或明确运行正文解析。');
    const data = await this.call(context, 'file_read', { path: bodyPath });
    const lines = String(data.content ?? '').split('\n');
    const startLine = Math.max(1, Math.trunc(input.startLine ?? 1));
    const startOffset = Math.max(0, Math.trunc(input.startOffset ?? 0));
    let content = '';
    let index = startLine - 1;
    let offset = startOffset;
    while (index < lines.length && content.length < budget) {
      const line = lines[index];
      if (offset > line.length) throw new LibraryError('INVALID_RANGE', '正文偏移已超出当前行，请重新读取。');
      const separator = content ? '\n' : '';
      const remaining = budget - content.length - separator.length;
      if (remaining < 1 && line.length > offset) break;
      const part = line.slice(offset, offset + Math.max(0, remaining));
      content += separator + part;
      offset += part.length;
      if (offset < line.length) break;
      index += 1; offset = 0;
    }
    return { vaultId: context.id, paperPath: path, source: 'markdown', content, startLine, nextLine: index < lines.length ? index + 1 : null, nextOffset: index < lines.length ? offset : null, truncated: index < lines.length };
  }

  async readPdfChunk(input: PdfChunkInput): Promise<PdfChunk> {
    const context = await this.context(input);
    const paperPath = await this.paperPath(context, input.paperPath);
    const directory = await containedPath(context.path, paperPath);
    const names = await readdir(directory);
    const preferred = `${basename(paperPath)}.pdf`;
    const filename = names.includes(preferred) ? preferred : names.filter(name => name.toLowerCase().endsWith('.pdf')).sort()[0];
    if (!filename) throw new LibraryError('PDF_MISSING', '论文目录中没有本地 PDF。');
    const path = await containedPath(context.path, `${paperPath}/${filename}`);
    const handle = await open(path, 'r');
    try {
      const before = await handle.stat();
      const revision = `pdf:${createHash('sha256').update(JSON.stringify([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs])).digest('hex')}`;
      const offset = input.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > before.size) throw new LibraryError('INVALID_RANGE', 'PDF 读取偏移无效。');
      if (offset > 0 && !input.revision) throw new LibraryError('PDF_REVISION_REQUIRED', '后续 PDF 分块必须携带首块的 revision。');
      if (input.revision && input.revision !== revision) throw new LibraryError('PDF_CHANGED', 'PDF 已在读取期间发生变化，请重新打开。', true);
      const requested = input.length ?? MAX_PDF_CHUNK;
      if (!Number.isSafeInteger(requested) || requested < 1) throw new LibraryError('INVALID_RANGE', 'PDF 分块长度无效。');
      const length = Math.min(MAX_PDF_CHUNK, requested, before.size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new LibraryError('PDF_CHANGED', 'PDF 已在读取期间发生变化，请重新打开。', true);
      return { base64: buffer.subarray(0, bytesRead).toString('base64'), offset, nextOffset: offset + bytesRead, totalBytes: before.size, eof: offset + bytesRead >= before.size, revision };
    } finally { await handle.close(); }
  }

  async listNotes(input: ListNotesInput): Promise<NoteList> {
    const context = await this.context(input);
    const path = relativePath(input.path ?? 'notes');
    if (path !== 'notes' && !path.startsWith('notes/')) throw new LibraryError('INVALID_PATH', '独立笔记目录必须位于 notes/。');
    await containedPath(context.path, path);
    const data = await this.call(context, 'file_list', { path, limit: Math.min(500, Math.max(1, input.limit ?? 200)) });
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return { vaultId: context.id, path, items: entries.map(record).filter(item => item.kind === 'directory' || String(item.path).toLowerCase().endsWith('.md')).map(item => ({ path: String(item.path), name: String(item.name), kind: item.kind === 'directory' ? 'directory' : 'file' })), truncated: data.truncated === true };
  }

  private async noteLocation(context: Context, input: NoteInput): Promise<{ path: string; paperPath?: string }> {
    let path: string;
    let paperPath: string | undefined;
    if (input.paperPath) { paperPath = await this.paperPath(context, input.paperPath); path = `${paperPath}/NOTES.md`; }
    else {
      path = relativePath(input.path ?? '');
      if (path.startsWith('papers/') && path.endsWith('/NOTES.md')) paperPath = await this.paperPath(context, path.slice(0, -'/NOTES.md'.length));
      else if (!path.startsWith('notes/') || !path.toLowerCase().endsWith('.md')) throw new LibraryError('INVALID_PATH', '仅支持 notes/ 下的 Markdown 或论文 NOTES.md。');
    }
    if (input.path && relativePath(input.path) !== path) throw new LibraryError('INVALID_PATH', '笔记路径与论文引用不一致。');
    await containedPath(context.path, path, true);
    return { path, ...(paperPath ? { paperPath } : {}) };
  }

  private async readLocatedNote(context: Context, location: { path: string; paperPath?: string }): Promise<NoteDocument> {
    const actual = await containedPath(context.path, location.path, true);
    if (!(await exists(actual))) return { vaultId: context.id, ...location, content: '', revision: null, exists: false };
    if ((await stat(actual)).size > MAX_NOTE_BYTES) throw new LibraryError('NOTE_TOO_LARGE', '笔记超过 2 MiB，请缩小文件。');
    const data = location.paperPath ? await this.call(context, 'paper_notes_get', { ref: location.paperPath }) : await this.call(context, 'file_read', { path: location.path });
    if (typeof data.content !== 'string') throw new LibraryError('UPSTREAM_INVALID', '上游笔记内容格式无效。');
    return { vaultId: context.id, ...location, content: data.content, revision: contentRevision(data.content), exists: true };
  }

  async readNote(input: NoteInput): Promise<NoteDocument> {
    const context = await this.context(input);
    return this.readLocatedNote(context, await this.noteLocation(context, input));
  }

  async writeNote(input: WriteNoteInput): Promise<NoteDocument & { saved: true; recoveryId: string }> {
    const context = await this.context(input);
    if (!Object.hasOwn(input, 'revision') || !(input.revision === null || typeof input.revision === 'string')) throw new LibraryError('REVISION_REQUIRED', '请先读取笔记，再带上 revision 保存。');
    if (input.mode && input.mode !== 'replace' && input.mode !== 'append') throw new LibraryError('INVALID_MODE', '保存模式仅支持 replace 或 append。');
    if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > MAX_NOTE_BYTES) throw new LibraryError('NOTE_TOO_LARGE', '笔记内容必须是 2 MiB 以内的文本。');
    const location = await this.noteLocation(context, input);
    const key = `${context.id}:${location.path}`;
    const recoveryId = `${this.instanceId}-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    const attemptId = randomUUID();
    const draftPath = join(this.dataRoot, 'state', 'drafts', `${recoveryId}.draft.json`);
    await atomicJson(draftPath, { instanceId: this.instanceId, attemptId, vaultId: context.id, ...location, revision: input.revision, mode: input.mode ?? 'replace', content: input.content, createdAt: new Date().toISOString() });
    this.busyWrites += 1;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const current = await this.readLocatedNote(context, location);
      if (current.revision !== input.revision) throw new LibraryError('NOTE_CONFLICT', '笔记已被其他操作修改；草稿已保留，请重新读取后比较。', false, { currentRevision: current.revision, recoveryId });
      await atomicJson(join(this.dataRoot, 'state', 'drafts', `${recoveryId}-before.json`), { vaultId: context.id, ...location, revision: current.revision, content: current.content, exists: current.exists });
      try {
        if (location.paperPath) await this.call(context, 'paper_notes_write', { ref: location.paperPath, content: input.content, mode: input.mode ?? 'replace' });
        else await this.call(context, 'file_write', { path: location.path, content: input.content, mode: input.mode ?? 'replace' });
        const saved = await this.readLocatedNote(context, location);
        const remaining = record(await readJson(draftPath).catch(() => undefined));
        if (remaining.attemptId === attemptId) await rm(draftPath, { force: true }).catch(() => undefined);
        return { ...saved, saved: true as const, recoveryId };
      } catch (error) { throw error; }
    });
    this.queues.set(key, task);
    try { return await task; } finally { this.busyWrites -= 1; if (this.queues.get(key) === task) this.queues.delete(key); }
  }

  private async closeNative(): Promise<void> {
    const native = this.native;
    this.native = undefined;
    this.nativeAbort?.abort();
    this.nativeAbort = undefined;
    if (native) await native.then(backend => backend.close()).catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const operation of this.operations.values()) if (activeStatuses.has(operation.public.status)) operation.controller.abort();
    await this.closeNative();
    await this.runner.close?.();
    await Promise.allSettled([...this.operations.values()].map(operation => operation.done));
    await Promise.allSettled([...this.queues.values()]);
  }

  private async recoveryDraftCount(): Promise<number> {
    try { return (await readdir(join(this.dataRoot, 'state', 'drafts'))).filter(name => /^[a-f0-9-]+-[a-f0-9]{24}\.draft\.json$/.test(name)).length; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  }
}
