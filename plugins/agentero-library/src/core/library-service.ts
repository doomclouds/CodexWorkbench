import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, resolve } from 'node:path';
import type { AddMarkInput, BibliographyInput, ChangeTagInput, DeleteMarkInput, ExportBibliographyInput, ExportPaperInput, ExportResult, MarkListInput, NoteAssetImportInput, NoteAssetReadInput, NoteLinksInput, RenameNoteInput, TranslateInput, UpdateMarkInput, WriteBookmarksInput } from '../contracts/reader.js';
import type {
  CliRunner, DiscoverInput, ImportPaperInput, LibraryOperation, LibraryServiceOptions, LibrarySettings,
  LibraryStatus, ListNotesInput, ListPapersInput, NativeBackend, NoteDocument, NoteInput, NoteList,
  OperationInput, Paper, PaperInput, PaperPage, PaperRead, ParsePaperInput, PdfChunk, PdfChunkInput,
  ReadPaperInput, SearchInput, SettingsPatch, StatusOptions, UpdatePaperInput, VaultInput, WriteNoteInput,
} from '../contracts/types.js';
import { asLibraryError, LibraryError } from '../contracts/errors.js';
import { ProcessCliRunner } from '../infrastructure/cli.js';
import { atomicJson, containedPath, contentRevision, exists, expandHome, readJson, relativePath } from '../infrastructure/files.js';
import { createNativeBackend } from '../infrastructure/native-mcp.js';
import { diagnosticPdf } from '../infrastructure/pdf-probe.js';
import { pdfDiagnosticKey, readPdfDiagnostic, writePdfDiagnostic, type PdfDiagnosticIdentity } from '../infrastructure/pdf-diagnostic-cache.js';
import { requestExternalPdfOpen } from '../infrastructure/external-pdf.js';
import { MarksStore } from '../infrastructure/marks.js';
import { annotatedPdf, editBookmarks } from '../infrastructure/pdf-edit.js';

interface Context { id: string; path: string; settings: LibrarySettings }
interface Snapshot { id: string; vaultId: string; createdAt: number; items: Paper[] }
interface OperationState { public: LibraryOperation; controller: AbortController; done: Promise<void> }
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_PDF_CHUNK = 1024 * 1024;
const activeStatuses = new Set(['queued', 'running', 'cancel_requested']);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : String(record(item).name ?? '')).filter(Boolean) : [];
const settingsKey = (settings: LibrarySettings) => JSON.stringify([settings.schemaVersion, settings.cliPath, settings.vaultPath, settings.pdfiumPath, settings.allowAgentPdfText, settings.vaultId]);

export class LibraryService {
  readonly dataRoot: string;
  readonly instanceId = randomUUID();
  private readonly runner: CliRunner;
  private readonly factory: NonNullable<LibraryServiceOptions['nativeFactory']>;
  private readonly snapshotTtl: number;
  private settingsSnapshot?: LibrarySettings;
  private settingsReads: Promise<void> = Promise.resolve();
  private settingsGeneration = 0;
  private settingsChain: Promise<unknown> = Promise.resolve();
  private native?: Promise<NativeBackend>;
  private nativeAbort?: AbortController;
  private snapshot?: Snapshot;
  private cliProbe?: { key: string; at: number; result: LibraryStatus['cli'] };
  private pdfDiagnosis?: { key: string; controller: AbortController; pending: Promise<LibraryStatus['pdfium']> };
  private readonly externalPdfOpener: (path: string) => Promise<void>;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly operations = new Map<string, OperationState>();
  private busyWrites = 0;
  private closed = false;

  constructor(options: LibraryServiceOptions = {}) {
    this.dataRoot = resolve(expandHome(options.dataRoot ?? join(homedir(), '.codexworkbench', 'agentero-library')));
    this.runner = options.cliRunner ?? new ProcessCliRunner();
    this.factory = options.nativeFactory ?? createNativeBackend;
    this.snapshotTtl = options.snapshotTtlMs ?? 30_000;
    this.externalPdfOpener = options.externalPdfOpener ?? requestExternalPdfOpen;
  }

  async readSettings(): Promise<LibrarySettings> {
    // Codex may launch separate MCP processes for plugin settings and Threads.
    // Read the atomically replaced file instead of memoizing the first value.
    const reading = this.settingsReads.then(async () => {
      const next = await this.loadSettings();
      const changed = this.settingsSnapshot && settingsKey(this.settingsSnapshot) !== settingsKey(next);
      this.settingsSnapshot = next;
      if (changed) {
        this.settingsGeneration += 1;
        this.snapshot = undefined;
        this.cliProbe = undefined;
        // Running CLI operations own their captured Vault/settings. Only the
        // cached native connection belongs to this current configuration.
        await this.closeNative();
      }
      return { ...next };
    });
    this.settingsReads = reading.then(() => undefined, () => undefined);
    return reading;
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
      // This catches changes observed before our atomic replace. It is an
      // optimistic check, not a cross-process CAS or configuration lock.
      if (settingsKey(await this.loadSettings()) !== settingsKey(current)) {
        await this.readSettings();
        throw new LibraryError('SETTINGS_CHANGED', '配置已被其他实例修改，请重新读取后再保存。', true);
      }
      await atomicJson(join(this.dataRoot, 'config.json'), next);
      const saved = await this.readSettings();
      if (settingsKey(saved) !== settingsKey(next)) throw new LibraryError('SETTINGS_CHANGED', '保存期间配置又被其他实例修改，请重新载入当前值。', true);
      return saved;
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
  async validateScope(input: VaultInput): Promise<void> { await this.context(input); }

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

  private async probeCli(settings: LibrarySettings, refresh = false): Promise<LibraryStatus['cli']> {
    const generation = this.settingsGeneration;
    if (!refresh && this.cliProbe?.key === settings.cliPath && Date.now() - this.cliProbe.at < 10_000) return this.cliProbe.result;
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
    if (generation === this.settingsGeneration && this.settingsSnapshot && settingsKey(settings) === settingsKey(this.settingsSnapshot)) this.cliProbe = { key: settings.cliPath, at: Date.now(), result };
    return result;
  }

  private async requireCli(settings: LibrarySettings): Promise<void> {
    const cli = await this.probeCli(settings);
    if (!cli.available) throw new LibraryError('CLI_NOT_FOUND', cli.error ?? '未找到 Agentero CLI。');
    if (!cli.supported) throw new LibraryError('CLI_UNSUPPORTED', cli.error ?? 'CLI 版本不受支持。');
  }

  private async probePdf(settings: LibrarySettings, identity: PdfDiagnosticIdentity): Promise<LibraryStatus['pdfium']> {
    const key = pdfDiagnosticKey(identity);
    if (this.pdfDiagnosis?.key === key) return this.pdfDiagnosis.pending;
    const controller = new AbortController();
    const pending = (async () => {
      let result: LibraryStatus['pdfium'];
      try {
        // Different MCP processes use separate fixture Vaults. They share only
        // the completed diagnostic record, never a catalog or running parser.
        const directory = join(this.dataRoot, 'cache', 'diagnostics', `${key.slice(0, 16)}-${this.instanceId}`);
        const vault = join(directory, 'vault');
        await mkdir(directory, { recursive: true });
        if (!(await exists(join(vault, '.agentero', 'catalog.sqlite')))) await this.cli(settings, ['--json', 'vault', 'create', vault], controller.signal);
        const pdf = join(directory, 'codex-workbench-probe.pdf');
        await writeFile(pdf, diagnosticPdf());
        const imported = record(await this.cli(settings, ['--json', '--vault', vault, 'import', 'pdf', pdf, '--no-recognize'], controller.signal));
        const papers = Array.isArray(imported.papers) ? imported.papers : [];
        const path = String(record(papers[0]).path ?? 'papers/codex-workbench-probe');
        await this.cli(settings, ['--json', '--vault', vault, 'paper', 'parse', path, '--force'], controller.signal, 30_000);
        result = { configured: !!settings.pdfiumPath, available: true, state: 'available', path: settings.pdfiumPath, diagnostic: '已使用隔离 PDF 验证原生解析。', checkedAt: new Date().toISOString() };
      } catch (error) {
        if (controller.signal.aborted || this.closed) throw new LibraryError('OPERATION_CANCELLED', 'PDF 诊断已停止。');
        result = { configured: !!settings.pdfiumPath, available: false, state: 'unavailable', path: settings.pdfiumPath, diagnostic: asLibraryError(error).message, checkedAt: new Date().toISOString() };
      }
      const current = await this.readSettings();
      if (!this.closed && current.cliPath === identity.cliPath && current.pdfiumPath === identity.pdfiumPath) await writePdfDiagnostic(this.dataRoot, identity, result);
      return result;
    })();
    this.pdfDiagnosis = { key, controller, pending };
    try { return await pending; } finally { if (this.pdfDiagnosis?.pending === pending) this.pdfDiagnosis = undefined; }
  }

  async status(options: StatusOptions = {}): Promise<LibraryStatus> {
    this.ensureOpen();
    const settings = await this.readSettings();
    const cli = await this.probeCli(settings, options.diagnosePdf === true);
    let valid = false;
    let vaultError: string | undefined;
    if (settings.vaultPath) try { await this.validateVault(settings.vaultPath); valid = !!settings.vaultId; } catch (error) { vaultError = asLibraryError(error).message; }
    const identity = { cliPath: settings.cliPath, pdfiumPath: settings.pdfiumPath, cliVersion: cli.version ?? '' };
    const unknown: LibraryStatus['pdfium'] = { configured: !!settings.pdfiumPath, available: null, state: 'unknown', path: settings.pdfiumPath, diagnostic: cli.supported ? '尚未检测当前配置的 PDF 原生能力；可在设置中明确运行诊断。' : '请先配置可用 CLI，再运行 PDF 诊断。' };
    const pdfium = cli.supported && cli.version ? options.diagnosePdf === true ? await this.probePdf(settings, identity) : await readPdfDiagnostic(this.dataRoot, identity) ?? unknown : unknown;
    if (settingsKey(settings) !== settingsKey(await this.readSettings())) throw new LibraryError('SETTINGS_CHANGED', '读取状态期间配置已改变，请刷新当前状态。', true);
    const ready = cli.available && cli.supported && valid;
    return {
      ready, instanceId: this.instanceId, dataRoot: this.dataRoot, defaultVaultPath: join(this.dataRoot, 'vault'), cli,
      vault: { configured: !!settings.vaultId, valid, vaultId: settings.vaultId, path: settings.vaultPath, name: settings.vaultPath ? basename(settings.vaultPath) : '', ...(vaultError ? { error: vaultError } : {}) },
      capabilities: { metadata: ready, notes: ready, pdfRead: ready, pdfText: ready && settings.allowAgentPdfText && pdfium.available === true, pdfParse: ready && pdfium.available === true, layout: ready },
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
    this.assertCurrentContext(context, await this.readSettings());
    if (!this.native) {
      this.nativeAbort = new AbortController();
      const pending = this.factory({ settings: context.settings, dataRoot: this.dataRoot, vaultPath: context.path, signal: this.nativeAbort.signal }).catch(error => { if (this.native === pending) this.native = undefined; throw error; });
      this.native = pending;
    }
    return this.native;
  }

  private async call(context: Context, name: string, args: Record<string, unknown>) {
    const backend = await this.backend(context);
    try {
      this.assertCurrentContext(context, await this.readSettings());
      const output = await backend.call(name, { ...args, vault: context.path });
      this.assertCurrentContext(context, await this.readSettings());
      return output;
    }
    catch (error) {
      if (error instanceof LibraryError && error.code === 'UPSTREAM_CLOSED') {
        const slot = this.native;
        if (slot && await slot.catch(() => undefined) === backend && this.native === slot) await this.closeNative();
      }
      throw error;
    }
  }

  private assertCurrentContext(context: Context, settings: LibrarySettings): void {
    // Another serialized reader may already have adopted newer disk values
    // while this caller was resuming from an older read promise.
    settings = this.settingsSnapshot ?? settings;
    if (settings.vaultId !== context.id || settings.vaultPath !== context.settings.vaultPath) throw new LibraryError('VAULT_CHANGED', '知识库已切换，请重新载入当前视图。');
    if (settingsKey(settings) !== settingsKey(context.settings)) throw new LibraryError('SETTINGS_CHANGED', '连接或正文设置已改变，请重新读取后再操作。', true);
  }

  private normalizePaper(value: unknown): Paper {
    const item = record(value);
    return {
      ...item, id: String(item.id ?? ''), path: String(item.path ?? '').replaceAll('\\', '/'), title: String(item.title ?? ''),
      authors: strings(item.authors), tags: strings(item.tags), tagDetails: Array.isArray(item.tags) ? item.tags.map(tag => typeof tag === 'string' ? { name: tag } : { name: String(record(tag).name ?? ''), ...(typeof record(tag).color === 'string' ? { color: String(record(tag).color) } : {}) }).filter(tag => tag.name) : [], isRead: Boolean(item.isRead ?? item.is_read),
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
    if (input.sortBy && !['title', 'year', 'date', 'authors', 'tags'].includes(input.sortBy)) throw new LibraryError('INVALID_SORT', '不支持该排序列。');
    await this.requireCli(context.settings);
    if (input.refresh || !this.snapshot || this.snapshot.vaultId !== context.id || Date.now() - this.snapshot.createdAt > this.snapshotTtl) {
      const data = await this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'list', '--fields', 'authors,year,date,tags,is_read,publication,doi']);
      if (!Array.isArray(data)) throw new LibraryError('UPSTREAM_INVALID', 'CLI 文献列表格式无效。');
      this.assertCurrentContext(context, await this.readSettings());
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
    let items = snapshot.items.filter(paper => (!query || [paper.title, paper.id, paper.path, String(paper.year ?? ''), paper.date ?? '', ...paper.authors, ...paper.tags].some(text => text.toLocaleLowerCase().includes(query))) && (!input.unread || !paper.isRead) && (!input.tag?.length || input.tag.every(tag => paper.tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase()))));
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
    await this.requireCli(context.settings);
    const [metadata, paths, detail] = await Promise.all([
      this.call(context, 'paper_get', { ref: path }), this.call(context, 'paper_paths', { ref: path }),
      this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'get', path]),
    ]);
    this.assertCurrentContext(context, await this.readSettings());
    // Native MCP flattens PaperTag to names. A targeted CLI record preserves
    // colors without loading a full library or reusing a stale list snapshot.
    const taggedPaper = record(record(detail).paper);
    if (taggedPaper.path !== path || !Array.isArray(taggedPaper.tags)) throw new LibraryError('UPSTREAM_INVALID', 'CLI 单篇文献标签格式无效。');
    const tags = this.normalizePaper(taggedPaper);
    const hasPdf = (await readdir(await containedPath(context.path, path))).some(name => name.toLowerCase().endsWith('.pdf'));
    const hasMarkdown = await exists(await containedPath(context.path, `${path}/PAPER.md`, true));
    const hasLayout = await exists(await containedPath(context.path, `${path}/source/layout.json`, true));
    return { vaultId: context.id, ...this.normalizePaper(metadata), tags: tags.tags, tagDetails: tags.tagDetails, paths: paths.paths, hasPdf, hasMarkdown, hasLayout };
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

  private startOperation(context: Context, type: LibraryOperation['type'], run: (signal: AbortSignal) => Promise<unknown>, paperPath?: string): LibraryOperation {
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
    const modes = Number(input.text !== undefined) + Number(input.filePath !== undefined) + Number(input.filePaths !== undefined);
    if (modes !== 1 || input.text !== undefined && (typeof input.text !== 'string' || !input.text.trim())) throw new LibraryError('INVALID_IMPORT', '请提供标识符、单个 PDF 路径或 PDF 路径数组中的一种。');
    const requestedFiles = input.filePaths ?? (input.filePath !== undefined ? [input.filePath] : []);
    if (!Array.isArray(requestedFiles) || input.filePaths !== undefined && (requestedFiles.length < 1 || requestedFiles.length > 100) || requestedFiles.some(file => typeof file !== 'string' || !file.trim() || file.length > 4096)) throw new LibraryError('INVALID_IMPORT', '一次导入请选择 1 至 100 个有效 PDF 路径。');
    const parent = relativePath(input.parent ?? 'papers');
    if (parent !== 'papers' && !parent.startsWith('papers/')) throw new LibraryError('INVALID_PATH', '导入目录必须位于 papers/。');
    const localFiles: string[] = [];
    for (const requested of requestedFiles) {
      const file = resolve(expandHome(requested));
      if (!file.toLowerCase().endsWith('.pdf') || !(await stat(file)).isFile()) throw new LibraryError('INVALID_IMPORT', '请选择已有的本地 PDF 文件。');
      if (!localFiles.some(existing => process.platform === 'win32' ? existing.toLowerCase() === file.toLowerCase() : existing === file)) localFiles.push(file);
    }
    return this.startOperation(context, 'import', async signal => {
      const args = ['--json', '--vault', context.path, 'import', localFiles.length ? 'pdf' : 'id', '--parent', parent];
      if (localFiles.length && (input.noRecognize ?? true)) args.push('--no-recognize');
      args.push('--', ...(localFiles.length ? localFiles : [input.text!.trim()]));
      const result = await this.cli(context.settings, args, signal, 300_000);
      return { data: result, ...(localFiles.length && (input.noRecognize ?? true) ? { metadataSource: 'filename', warning: '本次跳过元数据识别，可后续完善。' } : {}) };
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
    const key = `${context.id}:${location.paperPath ?? location.path}`;
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

  private async exclusive<T>(context: Context, resource: string, run: () => Promise<T>): Promise<T> {
    const key = `${context.id}:${resource}`;
    this.busyWrites += 1;
    const task = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      this.ensureOpen(); this.assertCurrentContext(context, await this.readSettings());
      return run();
    });
    this.queues.set(key, task);
    try { return await task; } finally { this.busyWrites -= 1; if (this.queues.get(key) === task) this.queues.delete(key); }
  }

  private async markStore(input: PaperInput) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath);
    return { context, store: new MarksStore(context.path, paperPath, context.id), paperPath };
  }
  async listMarks(input: MarkListInput) {
    const { store } = await this.markStore(input), result = await store.list();
    const query = (input.query ?? '').toLocaleLowerCase();
    return { ...result, items: result.items.filter(mark => (!input.kind || mark.kind === input.kind) && (!input.page || mark.page === input.page) && (!query || [mark.quote, mark.note, mark.result, ...(mark.messages ?? []).map(m => m.content)].some(t => t?.toLocaleLowerCase().includes(query)))) };
  }
  async addMark(input: AddMarkInput) { const { context, store, paperPath } = await this.markStore(input); return this.exclusive(context, paperPath, async () => { await this.paperPath(context, paperPath); return store.add(input); }); }
  async updateMark(input: UpdateMarkInput) { const { context, store, paperPath } = await this.markStore(input); return this.exclusive(context, paperPath, async () => { await this.paperPath(context, paperPath); return store.update(input); }); }
  async deleteMark(input: DeleteMarkInput) { const { context, store, paperPath } = await this.markStore(input); return this.exclusive(context, paperPath, async () => { await this.paperPath(context, paperPath); return store.remove(input.id, input.revision); }); }
  async readMarkAsset(input: PaperInput & { id: string }) { const { store } = await this.markStore(input); return store.asset(input.id); }

  async translateText(input: TranslateInput, signal?: AbortSignal) {
    const checkCancellation = () => { if (signal?.aborted) throw new LibraryError('OPERATION_CANCELLED', '翻译已取消。'); };
    checkCancellation();
    const context = await this.context(input);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20_000) throw new LibraryError('INVALID_TRANSLATION', '翻译原文必须为 1 至 20000 字符。');
    const to = input.to ?? 'zh-CN', from = input.from ?? 'auto';
    if (![to, from].every(s => /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(s))) throw new LibraryError('INVALID_TRANSLATION', '语言代码无效。');
    const providers = ['google', 'googleapi', 'deeplx', 'cnki', 'huoshanweb', 'tencenttransmart'];
    if (input.provider && !providers.includes(input.provider)) throw new LibraryError('INVALID_TRANSLATION', 'CLI 仅支持免费翻译引擎。');
    await this.requireCli(context.settings);
    // Native free-MT limits one request to 5000 characters. Preserve all text
    // through bounded chunks instead of silently truncating a page paragraph.
    const chunks = input.text.match(/[\s\S]{1,4000}/gu) ?? [], translated: string[] = [];
    for (const chunk of chunks) {
      checkCancellation();
      this.assertCurrentContext(context, await this.readSettings());
      checkCancellation();
      const args = ['--json', '--vault', context.path, 'translate', '--to', to, '--from', from];
      if (input.provider) args.push('--provider', input.provider);
      args.push('--', chunk);
      const data = record(await this.cli(context.settings, args, signal, 120_000));
      checkCancellation();
      if (typeof data.text !== 'string' || !data.text.trim()) throw new LibraryError('UPSTREAM_INVALID', '翻译引擎未返回译文。');
      translated.push(data.text);
    }
    return { text: translated.join('\n'), sourceLang: from, targetLang: to };
  }

  private async pdfLocation(context: Context, paperPath: string) {
    const directory = await containedPath(context.path, paperPath), names = await readdir(directory);
    const filename = names.includes(`${basename(paperPath)}.pdf`) ? `${basename(paperPath)}.pdf` : names.filter(n => n.toLowerCase().endsWith('.pdf')).sort()[0];
    if (!filename) throw new LibraryError('PDF_MISSING', '论文没有本地 PDF。');
    const path = await containedPath(context.path, `${paperPath}/${filename}`), info = await stat(path);
    if (!info.isFile()) throw new LibraryError('INVALID_PDF', '论文 PDF 不是普通文件。');
    if (info.size > 256 * 1024 * 1024) throw new LibraryError('PDF_TOO_LARGE', 'PDF 超过 256 MiB。');
    return { path, filename, revision: `pdf:${createHash('sha256').update(JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs])).digest('hex')}` };
  }
  async openPaperExternally(input: PaperInput) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath);
    const location = await this.pdfLocation(context, paperPath);
    if (extname(location.path).toLowerCase() !== '.pdf') throw new LibraryError('INVALID_PDF', '所选资源不是本地 PDF 文件。');
    const handle = await open(location.path, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new LibraryError('INVALID_PDF', '所选资源不是普通 PDF 文件。');
      const header = Buffer.alloc(1024), { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!header.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) throw new LibraryError('INVALID_PDF', '所选文件没有有效的 PDF 文件头。');
    } finally { await handle.close(); }
    this.ensureOpen();
    this.assertCurrentContext(context, await this.readSettings());
    try { await this.externalPdfOpener(location.path); }
    catch (error) { if (error instanceof LibraryError) throw error; throw new LibraryError('EXTERNAL_OPEN_FAILED', '无法向系统 PDF 阅读器发送打开请求，请检查默认阅读器。'); }
    return { requested: true as const, vaultId: context.id, paperPath, fileName: location.filename, handler: 'system-default' as const };
  }
  private async atomicBytes(path: string, bytes: Uint8Array) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  async writePdfBookmarks(input: WriteBookmarksInput) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath);
    return this.exclusive(context, paperPath, async () => {
      const location = await this.pdfLocation(context, paperPath);
      if (!input.revision || location.revision !== input.revision) throw new LibraryError('PDF_CHANGED', 'PDF 已变化，请重新打开后编辑目录。', true);
      const bytes = await editBookmarks(await readFile(location.path), input.nodes);
      this.assertCurrentContext(context, await this.readSettings());
      if ((await this.pdfLocation(context, paperPath)).revision !== input.revision) throw new LibraryError('PDF_CHANGED', 'PDF 在保存期间发生变化。', true);
      await this.atomicBytes(location.path, bytes);
      return { revision: (await this.pdfLocation(context, paperPath)).revision, saved: true as const, totalBytes: bytes.length };
    });
  }
  async exportPaper(input: ExportPaperInput): Promise<ExportResult> {
    const { context, store, paperPath } = await this.markStore(input), marks = await store.list();
    if (!['pdf', 'markdown', 'json'].includes(input.format)) throw new LibraryError('INVALID_EXPORT', '导出格式无效。');
    let bytes: Buffer, content: string | undefined;
    const extension = input.format === 'markdown' ? 'md' : input.format;
    if (input.format === 'pdf') {
      const location = await this.pdfLocation(context, paperPath);
      if (input.revision && input.revision !== location.revision) throw new LibraryError('PDF_CHANGED', 'PDF 已变化，请刷新后导出。', true);
      const original = await readFile(location.path);
      bytes = Buffer.from(input.includeMarks === false ? original : await annotatedPdf(original, marks.items));
    } else {
      content = input.format === 'json' ? `${JSON.stringify(marks, null, 2)}\n` : `# ${basename(paperPath)} — 阅读标注\n\n${marks.items.map(mark => `## 第 ${mark.page} 页 · ${mark.kind}\n\n${mark.quote ? `> ${mark.quote.replaceAll('\n', '\n> ')}\n\n` : ''}${[mark.comment, mark.result, ...(mark.messages ?? []).map(m => `**${m.role}**: ${m.content}`)].filter(Boolean).join('\n\n')}\n`).join('\n')}`;
      bytes = Buffer.from(content);
    }
    const result: ExportResult = { fileName: `${basename(paperPath)}-annotated.${extension}`, mediaType: input.format === 'pdf' ? 'application/pdf' : input.format === 'json' ? 'application/json' : 'text/markdown', totalBytes: bytes.length, ...(content === undefined ? {} : { content }) };
    this.assertCurrentContext(context, await this.readSettings());
    if (input.filePath) {
      const path = resolve(expandHome(input.filePath));
      if (!isAbsolute(expandHome(input.filePath))) throw new LibraryError('INVALID_PATH', '导出目标必须是明确选择的绝对路径。');
      const original = input.format === 'pdf' ? (await this.pdfLocation(context, paperPath)).path : '';
      const targetCanonical = await exists(path) ? await realpath(path) : path;
      const comparable = (v: string) => process.platform === 'win32' ? v.toLocaleLowerCase() : v;
      if (comparable(targetCanonical) === comparable(original)) throw new LibraryError('INVALID_PATH', '导出文件不能覆盖知识库原 PDF。');
      await this.atomicBytes(path, bytes); result.savedPath = path;
    } else {
      if (bytes.length > 32 * 1024 * 1024) throw new LibraryError('EXPORT_TOO_LARGE', '超过 32 MiB 的导出请明确选择本地保存位置。');
      result.base64 = bytes.toString('base64');
    }
    return result;
  }
  async readLayout(input: PaperInput) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath);
    const path = await containedPath(context.path, `${paperPath}/source/layout.json`, true);
    if (!(await exists(path))) return { regions: [] };
    if ((await stat(path)).size > 32 * 1024 * 1024) throw new LibraryError('LAYOUT_TOO_LARGE', '版面文件超过 32 MiB。');
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  }
  async readPaperMarkdown(input: PaperInput) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath), relative = `${paperPath}/PAPER.md`;
    const path = await containedPath(context.path, relative, true);
    if (!(await exists(path))) return { path: relative, content: '', revision: null, exists: false };
    if ((await stat(path)).size > MAX_NOTE_BYTES) throw new LibraryError('MARKDOWN_TOO_LARGE', '论文 Markdown 超过 2 MiB。');
    const content = await readFile(path, 'utf8');
    return { path: relative, content, revision: contentRevision(content), exists: true };
  }
  private readerStatePath(context: Context, paperPath: string) { return join(this.dataRoot, 'state', 'reader', `${createHash('sha256').update(`${context.id}:${paperPath}`).digest('hex')}.json`); }
  async readReaderState(input: PaperInput) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath);
    return { state: record(await readJson(this.readerStatePath(context, paperPath))).state ?? {} };
  }
  async writeReaderState(input: PaperInput & { state: Record<string, unknown> }) {
    const context = await this.context(input), paperPath = await this.paperPath(context, input.paperPath);
    const state = record(input.state), allowed = ['pageNumber', 'zoom', 'fit', 'rotation', 'tone', 'outlineOpen', 'marksOpen', 'notesOpen'];
    if (Object.keys(state).some(k => !allowed.includes(k)) || JSON.stringify(state).length > 2000) throw new LibraryError('INVALID_STATE', '阅读状态无效。');
    if (state.pageNumber !== undefined && (!Number.isInteger(state.pageNumber) || Number(state.pageNumber) < 1)) throw new LibraryError('INVALID_STATE', '页码无效。');
    if (state.rotation !== undefined && ![0, 90, 180, 270].includes(Number(state.rotation))) throw new LibraryError('INVALID_STATE', '旋转角度无效。');
    return this.exclusive(context, `${paperPath}/reader-state`, async () => { await atomicJson(this.readerStatePath(context, paperPath), { state }); return { state }; });
  }

  async changeTag(input: ChangeTagInput) {
    const context = await this.context(input), path = await this.paperPath(context, input.paperPath);
    if (!['add', 'rm'].includes(input.op) || typeof input.tag !== 'string' || !input.tag.trim() || input.tag.length > 1000) throw new LibraryError('INVALID_TAG', '标签操作无效。');
    return this.exclusive(context, path, async () => { await this.requireCli(context.settings); const data = await this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'tag', input.op, path, '--', input.tag]); this.snapshot = undefined; return record(data); });
  }
  async deletePaper(input: PaperInput) {
    const context = await this.context(input), path = await this.paperPath(context, input.paperPath);
    return this.exclusive(context, path, async () => { await this.requireCli(context.settings); const data = await this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'delete', path]); this.snapshot = undefined; return record(data); });
  }
  async downloadPaper(input: PaperInput): Promise<LibraryOperation> {
    const context = await this.context(input), path = await this.paperPath(context, input.paperPath); await this.requireCli(context.settings);
    return this.startOperation(context, 'download', signal => this.cli(context.settings, ['--json', '--vault', context.path, 'paper', 'download', path], signal, 120_000), path);
  }
  async importBibliography(input: BibliographyInput): Promise<LibraryOperation> {
    const context = await this.context(input); await this.requireCli(context.settings);
    if (!!input.text === !!input.filePath) throw new LibraryError('INVALID_IMPORT', '请提供 BibTeX 文本或本地文件之一。');
    let path: string, temporary = false;
    if (input.text !== undefined) {
      if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 8 * 1024 * 1024) throw new LibraryError('INVALID_IMPORT', '文献格式文本超过 8 MiB。');
      path = join(this.dataRoot, 'state', 'imports', `${randomUUID()}.bib`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, input.text, { flag: 'wx', mode: 0o600 }); temporary = true;
    } else {
      if (!isAbsolute(expandHome(input.filePath!))) throw new LibraryError('INVALID_PATH', '导入文件必须是绝对路径。');
      path = await realpath(expandHome(input.filePath!));
      if (!(await stat(path)).isFile() || (await stat(path)).size > 8 * 1024 * 1024) throw new LibraryError('INVALID_IMPORT', '导入文件超过 8 MiB 或不是普通文件。');
    }
    return this.startOperation(context, 'bibliography', async signal => { try { return await this.cli(context.settings, ['--json', '--vault', context.path, 'import', 'bib', '--', path], signal, 120_000); } finally { if (temporary) await rm(path, { force: true }); } });
  }
  async exportBibliography(input: ExportBibliographyInput) {
    const context = await this.context(input); await this.requireCli(context.settings);
    const data = record(await this.cli(context.settings, ['--json', '--vault', context.path, 'export', 'bib'], undefined, 120_000));
    if (typeof data.content !== 'string') throw new LibraryError('UPSTREAM_INVALID', 'CLI 没有返回 BibTeX 内容。');
    if (input.filePath) {
      if (!isAbsolute(expandHome(input.filePath))) throw new LibraryError('INVALID_PATH', '导出文件必须是绝对路径。');
      await this.atomicBytes(resolve(expandHome(input.filePath)), Buffer.from(data.content));
    }
    return { ...data, content: data.content, ...(input.filePath ? { savedPath: resolve(expandHome(input.filePath)) } : {}) };
  }

  async renameNote(input: RenameNoteInput) {
    const context = await this.context(input), location = await this.noteLocation(context, { vaultId: input.vaultId, path: input.path });
    const destination = await this.noteLocation(context, { vaultId: input.vaultId, path: input.newPath });
    if (location.paperPath || destination.paperPath) throw new LibraryError('INVALID_PATH', '论文 NOTES.md 不能重命名。');
    return this.exclusive(context, location.path, async () => {
      const before = await this.readLocatedNote(context, location);
      if (!before.exists || before.revision !== input.revision) throw new LibraryError('NOTE_CONFLICT', '笔记已变化，请先重新载入。', true);
      const target = await containedPath(context.path, destination.path, true);
      if (await exists(target)) throw new LibraryError('FILE_EXISTS', '目标笔记已存在。');
      const moved = await this.call(context, 'file_move', { from: location.path, to: destination.path });
      const saved = await this.readLocatedNote(context, destination);
      return { ...saved, renamedFrom: location.path, updatedSources: moved.updatedSources ?? [], skipped: moved.skipped ?? [] };
    });
  }
  private assetMime(path: string) {
    const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
    const value = mime[extname(path).toLowerCase()]; if (!value) throw new LibraryError('INVALID_ASSET', '仅支持 PNG/JPEG/GIF/WebP/AVIF 图片附件。'); return value;
  }
  async readNoteAsset(input: NoteAssetReadInput) {
    const context = await this.context(input);
    const source = relativePath(input.notePath);
    const note = source.startsWith('papers/') && source.endsWith('/PAPER.md')
      ? { path: source, paperPath: await this.paperPath(context, source.slice(0, -'/PAPER.md'.length)) }
      : await this.noteLocation(context, { vaultId: input.vaultId, path: input.notePath });
    if (typeof input.assetPath !== 'string' || /^(?:[a-z]+:|\/|\\)/i.test(input.assetPath)) throw new LibraryError('INVALID_PATH', '请使用笔记内的相对图片路径。');
    const relative = relativePath(posix.normalize(posix.join(posix.dirname(note.path), input.assetPath.replaceAll('\\', '/'))));
    if (!relative.startsWith('notes/') && !(note.paperPath && relative.startsWith(`${note.paperPath}/`))) throw new LibraryError('INVALID_PATH', '附件超出当前笔记范围。');
    const path = await containedPath(context.path, relative), mimeType = this.assetMime(path), info = await stat(path);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new LibraryError('ASSET_TOO_LARGE', '图片附件超过 8 MiB。');
    return { path: relative, markdownPath: input.assetPath, mimeType, totalBytes: info.size, base64: (await readFile(path)).toString('base64') };
  }
  async importNoteAsset(input: NoteAssetImportInput) {
    const context = await this.context(input), note = await this.noteLocation(context, { vaultId: input.vaultId, path: input.notePath });
    if (!!input.filePath === !!input.base64) throw new LibraryError('INVALID_ASSET', '请提供本地图片文件或 base64 数据之一。');
    const fileName = basename(input.fileName).replace(/[^\p{L}\p{N}._-]/gu, '_'), mimeType = this.assetMime(fileName);
    if (mimeType !== input.mimeType) throw new LibraryError('INVALID_ASSET', '附件扩展名与类型不一致。');
    let bytes: Buffer;
    if (input.filePath) {
      if (!isAbsolute(expandHome(input.filePath))) throw new LibraryError('INVALID_PATH', '图片文件必须是绝对路径。');
      const source = await realpath(expandHome(input.filePath)), info = await stat(source);
      if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new LibraryError('ASSET_TOO_LARGE', '图片附件超过 8 MiB。');
      bytes = await readFile(source);
    } else {
      if (!input.base64 || input.base64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new LibraryError('INVALID_ASSET', '图片编码无效。');
      bytes = Buffer.from(input.base64, 'base64');
    }
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new LibraryError('ASSET_TOO_LARGE', '图片附件超过 8 MiB。');
    const file = `${randomUUID()}-${fileName}`, path = `${posix.dirname(note.path)}/assets/${file}`;
    return this.exclusive(context, note.paperPath ?? note.path, async () => { if (note.paperPath) await this.paperPath(context, note.paperPath); const target = await containedPath(context.path, path, true); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); return { path, markdownPath: `assets/${file}`, mimeType, totalBytes: bytes.length }; });
  }
  async noteLinks(input: NoteLinksInput) {
    const context = await this.context(input), note = await this.noteLocation(context, input), files: string[] = [];
    let truncated = false;
    const scan = async (directory: string, depth: number): Promise<void> => {
      if (depth > 16 || files.length >= 1000) { truncated = true; return; }
      const path = await containedPath(context.path, directory, true); if (!(await exists(path))) return;
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory() && (directory.startsWith('notes') || !['source', 'marks', 'assets'].includes(entry.name))) await scan(relative, depth + 1);
        else if (entry.isFile() && (relative.startsWith('notes/') && relative.endsWith('.md') || entry.name === 'NOTES.md')) { files.push(relative); if (files.length >= 1000) { truncated = true; return; } }
      }
    };
    await scan('notes', 0); await scan('papers', 0);
    const links = (content: string, source: string) => {
      const found = [...content.matchAll(/\[\[([^\]#|]+)(?:[^\]]*)\]\]|(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1] ?? match[2]);
      return [...new Set(found.flatMap(raw => {
        try {
          const target = decodeURIComponent(raw.split('#')[0]); if (/^[a-z]+:|^\//i.test(target)) return [];
          const path = relativePath(target.startsWith('notes/') || target.startsWith('papers/') ? target : posix.normalize(posix.join(posix.dirname(source), target.endsWith('.md') ? target : `${target}.md`)));
          return path.startsWith('notes/') || path.startsWith('papers/') && path.endsWith('/NOTES.md') ? [path] : [];
        } catch { return []; }
      }))];
    };
    const document = await this.readLocatedNote(context, note), outgoing = links(document.content, note.path).map(path => ({ path, title: basename(path, '.md') })), backlinks: { path: string; title: string }[] = [];
    let scannedBytes = 0;
    for (const path of files) {
      const target = await containedPath(context.path, path), info = await stat(target);
      if (info.size > MAX_NOTE_BYTES || scannedBytes + info.size > 32 * 1024 * 1024) { truncated = true; continue; }
      scannedBytes += info.size;
      if (path !== note.path && links(await readFile(target, 'utf8'), path).includes(note.path)) backlinks.push({ path, title: basename(path, '.md') });
    }
    return { outgoing, backlinks, truncated };
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
    const diagnosis = this.pdfDiagnosis;
    diagnosis?.controller.abort();
    for (const operation of this.operations.values()) if (activeStatuses.has(operation.public.status)) operation.controller.abort();
    await this.closeNative();
    // A concurrent disk refresh may already own the previous connection's
    // close promise after removing it from this.native. Wait for that owner.
    await Promise.allSettled([this.settingsReads, this.settingsChain]);
    await this.runner.close?.();
    if (diagnosis) await Promise.allSettled([diagnosis.pending]);
    await Promise.allSettled([...this.operations.values()].map(operation => operation.done));
    await Promise.allSettled([...this.queues.values()]);
  }

  private async recoveryDraftCount(): Promise<number> {
    try { return (await readdir(join(this.dataRoot, 'state', 'drafts'))).filter(name => /^[a-f0-9-]+-[a-f0-9]{24}\.draft\.json$/.test(name)).length; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  }
}
