import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryError } from '../src/contracts/errors.js';
import type { CliRequest, CliRunner, NativeBackend, Paper } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { ProcessCliRunner, cliEnvironment } from '../src/infrastructure/cli.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function temporary(): Promise<string> {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'codex-workbench-backend-'));
  cleanups.push(async () => {
    expect(dirname(root)).toBe(parent);
    expect(basename(root).startsWith('codex-workbench-backend-')).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function makeVault(path: string) {
  await Promise.all(['papers', 'notes', '.agentero'].map(part => mkdir(join(path, part), { recursive: true })));
  await writeFile(join(path, '.agentero', 'catalog.sqlite'), 'isolated mock catalog');
}

class FakeCli implements CliRunner {
  calls: CliRequest[] = [];
  papers: Paper[] = [];
  beforeDescription?: () => Promise<void>;
  operation?: (request: CliRequest) => Promise<unknown>;

  async run(request: CliRequest) {
    this.calls.push(request);
    const args = request.args;
    if (args.includes('--version')) return { code: 0, stdout: 'agentero 0.15.2\n', stderr: '' };
    let data: unknown = {};
    if (args.includes('describe')) { await this.beforeDescription?.(); data = { id: 'paper.list' }; }
    else if (args.includes('vault') && args.includes('create')) {
      const path = args[args.indexOf('create') + 1]; await makeVault(path); data = { path };
    } else if (args.includes('paper') && args.includes('list')) data = this.papers;
    else if (args.includes('import') && request.signal && this.operation) {
      try { data = await this.operation(request); } catch { return { code: 1, stdout: '', stderr: '', cancelled: true }; }
    } else if (args.includes('import')) data = { papers: [{ path: 'papers/codex-workbench-probe' }] };
    return { code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' };
  }
}

class FakeNative implements NativeBackend {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  closed = false;
  beforeWrite?: () => Promise<void>;
  failNextList = false;
  hits: Record<string, unknown>[] = [];
  constructor(readonly vault: string) {}

  async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ name, args });
    if (this.closed) throw new LibraryError('UPSTREAM_CLOSED', 'closed', true);
    if (name === 'file_list') {
      if (this.failNextList) { this.failNextList = false; throw new LibraryError('UPSTREAM_CLOSED', 'closed', true); }
      const path = String(args.path ?? '');
      const entries = await readdir(join(this.vault, path), { withFileTypes: true });
      return { path, entries: entries.map(entry => ({ name: entry.name, path: `${path}/${entry.name}`, kind: entry.isDirectory() ? 'directory' : 'file' })), truncated: false };
    }
    if (name === 'file_read' || name === 'paper_notes_get') {
      const path = name === 'file_read' ? String(args.path) : `${args.ref}/NOTES.md`;
      return { path, content: await readFile(join(this.vault, path), 'utf8') };
    }
    if (name === 'file_write' || name === 'paper_notes_write') {
      await this.beforeWrite?.();
      if (this.closed) throw new LibraryError('UPSTREAM_CLOSED', 'closed', true);
      const path = name === 'file_write' ? String(args.path) : `${args.ref}/NOTES.md`;
      await mkdir(dirname(join(this.vault, path)), { recursive: true });
      const before = args.mode === 'append' ? await readFile(join(this.vault, path), 'utf8').catch(() => '') : '';
      await writeFile(join(this.vault, path), before + String(args.content));
      return { path, mode: args.mode };
    }
    if (name === 'vault_search') return { hits: this.hits, truncated: false };
    if (name === 'page_read') return { pageCount: 1, regionCount: 3, textRegions: [{ text: 'L'.repeat(50_000) }], regions: [{ text: 'L'.repeat(50_000) }] };
    if (name === 'paper_text_get') return { pageCount: 2, pages: [{ page: 1, text: 'P'.repeat(50_000), charCount: 50_000 }, { page: 2, text: 'Q'.repeat(50_000), charCount: 50_000 }] };
    if (name === 'paper_paths') return { paths: ['papers/p1/p1.pdf'] };
    return { id: 'p1', path: 'papers/p1', title: 'Paper', authors: [], tags: [], isRead: false };
  }
  async close() { this.closed = true; }
}

async function fixture(options: { papers?: number; nativeFactory?: (vault: string, index: number) => FakeNative } = {}) {
  const root = await temporary();
  const vault = join(root, '知识库 with spaces');
  const dataRoot = join(root, 'plugin-data');
  await makeVault(vault);
  await mkdir(join(vault, 'papers', 'p1'), { recursive: true });
  const cli = new FakeCli();
  cli.papers = Array.from({ length: options.papers ?? 1 }, (_, index) => ({ id: `p${index + 1}`, path: `papers/p${index + 1}`, title: `Paper ${String(index + 1).padStart(3, '0')}`, authors: ['Author'], tags: ['Agent'], isRead: false, year: 2020 + index % 6 }));
  const natives: FakeNative[] = [];
  const service = new LibraryService({ dataRoot, cliRunner: cli, nativeFactory: async context => { const native = options.nativeFactory?.(context.vaultPath, natives.length) ?? new FakeNative(context.vaultPath); natives.push(native); return native; } });
  cleanups.push(() => service.close());
  const settings = await service.updateSettings({ cliPath: 'fake-agentero', vaultPath: vault });
  return { root, vault, dataRoot, cli, natives, service, vaultId: settings.vaultId! };
}

async function waitUntil(predicate: () => Promise<boolean> | boolean, milliseconds = 3000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Condition did not become true');
}

describe('library backend', () => {
  it('observes another instance saving after the first read found no config', async () => {
    const root = await temporary();
    const dataRoot = join(root, 'shared-plugin');
    const vault = join(root, 'Shared Vault');
    await makeVault(vault);
    const first = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    const second = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => first.close(), () => second.close());
    expect((await first.readSettings()).vaultId).toBeNull();
    const saved = await second.updateSettings({ cliPath: 'configured-cli', vaultPath: vault });
    expect(await first.readSettings()).toEqual(saved);
    const status = await first.status();
    expect(status.ready).toBe(true);
    expect(status.cli.path).toBe('configured-cli');
    expect(status.vault.vaultId).toBe(saved.vaultId);
    // A stale process saving the same path must not mint a second identity.
    expect((await first.updateSettings({ vaultPath: saved.vaultPath })).vaultId).toBe(saved.vaultId);
    expect((await second.readSettings()).vaultId).toBe(saved.vaultId);
  });

  it('invalidates native and snapshot/probe caches after external policy changes', async () => {
    const { service, dataRoot, cli, vaultId, vault, natives } = await fixture();
    const second = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => second.close());
    await writeFile(join(vault, 'notes', 'test.md'), 'Shared note');
    await service.status();
    await service.listPapers({ vaultId });
    await service.readNote({ vaultId, path: 'notes/test.md' });
    const firstNative = natives[0];
    const versionCalls = cli.calls.filter(call => call.args.includes('--version')).length;
    const parseCalls = cli.calls.filter(call => call.args.includes('parse')).length;
    const lists = cli.calls.filter(call => call.args.includes('list')).length;
    await second.updateSettings({ allowAgentPdfText: true });
    expect((await service.readSettings()).allowAgentPdfText).toBe(true);
    expect(firstNative.closed).toBe(true);
    await service.status();
    await service.listPapers({ vaultId });
    expect(cli.calls.filter(call => call.args.includes('--version')).length).toBeGreaterThan(versionCalls);
    expect(cli.calls.filter(call => call.args.includes('parse')).length).toBeGreaterThan(parseCalls);
    expect(cli.calls.filter(call => call.args.includes('list')).length).toBe(lists + 1);
    await service.readPaper({ vaultId, paperPath: 'papers/p1', source: 'pdf' });
    expect(natives).toHaveLength(2);
    await second.updateSettings({ allowAgentPdfText: false });
    await expect(service.readPaper({ vaultId, paperPath: 'papers/p1', source: 'pdf' })).rejects.toMatchObject({ code: 'TEXT_ACCESS_DISABLED' });
    expect(natives[1].closed).toBe(true);
    expect((await service.readNote({ vaultId, path: 'notes/test.md' })).content).toBe('Shared note');
    expect(natives).toHaveLength(3);
  });

  it('rejects old references and rebuilds its own native backend for an externally selected Vault', async () => {
    const { service, dataRoot, root, vaultId, vault, natives } = await fixture();
    const secondVault = join(root, 'Another Vault');
    await makeVault(secondVault);
    await writeFile(join(vault, 'notes', 'same.md'), 'Old Vault');
    await writeFile(join(secondVault, 'notes', 'same.md'), 'New Vault');
    const second = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => second.close());
    expect((await service.readNote({ vaultId, path: 'notes/same.md' })).content).toBe('Old Vault');
    const next = await second.updateSettings({ vaultPath: secondVault });
    await expect(service.readNote({ vaultId, path: 'notes/same.md' })).rejects.toMatchObject({ code: 'VAULT_CHANGED' });
    expect(natives[0].closed).toBe(true);
    expect((await service.readNote({ vaultId: next.vaultId!, path: 'notes/same.md' })).content).toBe('New Vault');
    expect(natives).toHaveLength(2);
    expect(natives[1].vault).toBe(await realpath(secondVault));
    expect(natives[1].calls.every(call => call.args.vault === next.vaultPath)).toBe(true);
  });

  it('keeps an already running CLI operation pinned when another process switches Vault', async () => {
    const { service, dataRoot, root, vaultId, vault, cli } = await fixture();
    const secondVault = join(root, 'Next Vault'); await makeVault(secondVault);
    const second = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => second.close());
    let request: CliRequest | undefined;
    let finish!: (result: unknown) => void;
    cli.operation = input => { request = input; return new Promise(resolve => { finish = resolve; }); };
    const operation = await service.importPaper({ vaultId, text: '1706.03762' });
    await waitUntil(() => !!request);
    const next = await second.updateSettings({ vaultPath: secondVault });
    expect((await service.readSettings()).vaultId).toBe(next.vaultId);
    expect(request!.args[request!.args.indexOf('--vault') + 1]).toBe(await realpath(vault));
    expect(request!.signal!.aborted).toBe(false);
    finish({ path: 'papers/old-target' });
    await waitUntil(async () => (await service.getOperation({ operationId: operation.operationId })).status === 'succeeded');
    const finished = await service.getOperation({ operationId: operation.operationId });
    expect(finished.vaultId).toBe(vaultId);
    expect(cli.calls.filter(call => call.signal && call.args.includes('import'))).toHaveLength(1);
    await expect(service.listPapers({ vaultId })).rejects.toMatchObject({ code: 'VAULT_CHANGED' });
  });

  it('preserves queued drafts instead of retrying a write after an external switch', async () => {
    const { service, dataRoot, root, vaultId, vault, natives } = await fixture();
    const secondVault = join(root, 'New Draft Vault'); await makeVault(secondVault);
    await writeFile(join(vault, 'notes', 'queued.md'), 'Original');
    await writeFile(join(secondVault, 'notes', 'queued.md'), 'Unchanged new Vault');
    const second = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => second.close());
    const note = await service.readNote({ vaultId, path: 'notes/queued.md' });
    let writing = false;
    let release!: () => void;
    natives[0].beforeWrite = () => { writing = true; return new Promise(resolve => { release = resolve; }); };
    const first = service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'First draft' }).catch(error => error);
    await waitUntil(() => writing);
    const queued = service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'Queued draft' }).catch(error => error);
    await second.updateSettings({ vaultPath: secondVault });
    await service.readSettings();
    release();
    expect(await first).toBeInstanceOf(LibraryError);
    expect(await queued).toMatchObject({ code: 'VAULT_CHANGED' });
    expect(natives).toHaveLength(1);
    expect(await readFile(join(vault, 'notes', 'queued.md'), 'utf8')).toBe('Original');
    expect(await readFile(join(secondVault, 'notes', 'queued.md'), 'utf8')).toBe('Unchanged new Vault');
    expect((await readdir(join(dataRoot, 'state', 'drafts'))).some(name => name.endsWith('.draft.json'))).toBe(true);
  });

  it('waits for a connection already being closed by a disk refresh during shutdown', async () => {
    const { service, dataRoot, root, vaultId, natives } = await fixture();
    const secondVault = join(root, 'Shutdown Vault'); await makeVault(secondVault);
    const second = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => second.close());
    await service.listNotes({ vaultId });
    let closing = false;
    let release!: () => void;
    natives[0].close = () => { natives[0].closed = true; closing = true; return new Promise(resolve => { release = resolve; }); };
    await second.updateSettings({ vaultPath: secondVault });
    const refreshing = service.readSettings();
    await waitUntil(() => closing);
    let stopped = false;
    const stopping = service.close().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    release();
    await Promise.all([refreshing, stopping]);
    await expect(service.listNotes({ vaultId })).rejects.toMatchObject({ code: 'SERVICE_CLOSED' });
    expect(natives).toHaveLength(1);
  });

  it('does not create a default Vault on startup or turn a missing path into one', async () => {
    const root = await temporary();
    const dataRoot = join(root, 'data');
    const service = new LibraryService({ dataRoot, cliRunner: new FakeCli() });
    cleanups.push(() => service.close());
    expect((await service.readSettings()).vaultId).toBeNull();
    await expect(stat(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.updateSettings({ vaultPath: join(root, 'missing') })).rejects.toMatchObject({ code: 'VAULT_INVALID' });
    await expect(stat(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('paginates a complete CLI snapshot and expires an old snapshot cursor', async () => {
    const { service, vaultId, cli } = await fixture({ papers: 351 });
    const first = await service.listPapers({ vaultId, limit: 200 });
    expect(first.total).toBe(351); expect(first.items).toHaveLength(200); expect(first.complete).toBe(true);
    const second = await service.listPapers({ vaultId, limit: 200, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(151); expect(second.nextCursor).toBeNull();
    expect(cli.calls.filter(call => call.args.includes('list'))).toHaveLength(1);
    await service.listPapers({ vaultId, refresh: true });
    await expect(service.listPapers({ vaultId, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
  });

  it('writes bounded recovery files and preserves a conflicting draft across restart', async () => {
    const { service, vaultId, vault, dataRoot, cli } = await fixture();
    let note = await service.readNote({ vaultId, path: 'notes/test.md' });
    for (let index = 0; index < 12; index += 1) note = await service.writeNote({ vaultId, path: note.path, revision: note.revision, content: `Save ${index}` });
    let files = await readdir(join(dataRoot, 'state', 'drafts'));
    expect(files).toHaveLength(1); expect(files[0].endsWith('-before.json')).toBe(true);
    await writeFile(join(vault, 'notes', 'test.md'), 'External editor content');
    await expect(service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'My preserved draft' })).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    expect(await readFile(join(vault, 'notes', 'test.md'), 'utf8')).toBe('External editor content');
    files = await readdir(join(dataRoot, 'state', 'drafts'));
    expect(files).toHaveLength(2);
    const draft = JSON.parse(await readFile(join(dataRoot, 'state', 'drafts', files.find(name => name.endsWith('.draft.json'))!), 'utf8'));
    expect(draft.content).toBe('My preserved draft');
    await service.close();
    const restarted = new LibraryService({ dataRoot, cliRunner: cli });
    cleanups.push(() => restarted.close());
    expect((await restarted.status()).recoveryDrafts).toBe(1);
  });

  it('rejects the nonexistent native create mode and path traversal', async () => {
    const { service, vaultId } = await fixture();
    await expect(service.readNote({ vaultId, path: 'notes/../../secret.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.writeNote({ vaultId, path: 'notes/new.md', revision: null, content: 'text', mode: 'create' as 'replace' })).rejects.toMatchObject({ code: 'INVALID_MODE' });
  });

  it('invalidates old Vault references when settings change', async () => {
    const { root, service, vaultId } = await fixture();
    const second = join(root, 'second'); await makeVault(second);
    const settings = await service.updateSettings({ vaultPath: second });
    expect(settings.vaultId).not.toBe(vaultId);
    await expect(service.listPapers({ vaultId })).rejects.toMatchObject({ code: 'VAULT_CHANGED' });
  });

  it('reconnects only on the next request after an upstream connection closes', async () => {
    const { service, vaultId, natives } = await fixture({ nativeFactory: (vault, index) => { const native = new FakeNative(vault); native.failNextList = index === 0; return native; } });
    await expect(service.listNotes({ vaultId })).rejects.toMatchObject({ code: 'UPSTREAM_CLOSED' });
    expect(natives).toHaveLength(1); expect(natives[0].closed).toBe(true);
    await service.listNotes({ vaultId });
    expect(natives).toHaveLength(2);
  });

  it('never creates a new upstream backend after close begins', async () => {
    const { service, vaultId, cli, natives } = await fixture();
    let entered = false;
    let release!: () => void;
    cli.beforeDescription = () => { entered = true; return new Promise<void>(resolve => { release = resolve; }); };
    const pending = service.listNotes({ vaultId });
    const outcome = pending.catch(error => error);
    await waitUntil(() => entered);
    await service.close(); release();
    expect(await outcome).toMatchObject({ code: 'SERVICE_CLOSED' });
    expect(natives).toHaveLength(0);
  });

  it('preserves queued writer drafts instead of reconnecting while closing', async () => {
    const { service, vaultId, vault, natives, dataRoot } = await fixture();
    await writeFile(join(vault, 'notes', 'queued.md'), 'original');
    const note = await service.readNote({ vaultId, path: 'notes/queued.md' });
    let writing = false;
    let release!: () => void;
    natives[0].beforeWrite = () => { writing = true; return new Promise<void>(resolve => { release = resolve; }); };
    const first = service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'first' });
    const firstOutcome = first.catch(error => error);
    await waitUntil(() => writing);
    const second = service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'second' });
    const secondOutcome = second.catch(error => error);
    const closing = service.close();
    release();
    await Promise.all([firstOutcome, secondOutcome, closing]);
    expect(natives).toHaveLength(1);
    expect((await readdir(join(dataRoot, 'state', 'drafts'))).filter(name => name.endsWith('.draft.json'))).toHaveLength(1);
    expect(await readFile(join(vault, 'notes', 'queued.md'), 'utf8')).toBe('original');
  });

  it('does not leak body snippets while text access is off', async () => {
    const { service, vaultId, natives, vault } = await fixture();
    await writeFile(join(vault, 'notes', 'allowed.md'), 'Notes');
    await service.listNotes({ vaultId });
    natives[0].hits = [{ path: 'papers/p1/PAPER.md', snippet: 'SECRET BODY', title: 'Body' }, { path: 'notes/allowed.md', snippet: 'Allowed note', title: 'Note' }];
    const result = await service.search({ vaultId, query: 'something', scope: 'all' });
    expect(JSON.stringify(result)).not.toContain('SECRET BODY'); expect(JSON.stringify(result)).toContain('Allowed note');
    await expect(service.readPaper({ vaultId, paperPath: 'papers/p1' })).rejects.toMatchObject({ code: 'TEXT_ACCESS_DISABLED' });
  });

  it('caps all returned body text and avoids duplicating it in page metadata', async () => {
    const { service, vaultId, vault } = await fixture();
    await service.updateSettings({ allowAgentPdfText: true });
    await mkdir(join(vault, 'papers/p1/source'), { recursive: true });
    await writeFile(join(vault, 'papers/p1/source/layout.json'), '{}');
    const layout = await service.readPaper({ vaultId, paperPath: 'papers/p1', source: 'layout', maxChars: 100 });
    expect(layout.content).toHaveLength(100); expect(layout.truncated).toBe(true);
    expect(JSON.stringify(layout.pages)).not.toContain('LLLLL');
    const pdf = await service.readPaper({ vaultId, paperPath: 'papers/p1', source: 'pdf', pages: [1, 2], maxChars: 100 });
    expect(pdf.content).toHaveLength(100); expect(pdf.truncated).toBe(true);
    expect(JSON.stringify(pdf.pages)).not.toContain('PPPPP');
  });

  it('continues a long Markdown line using its actual character offset', async () => {
    const { service, vaultId, vault } = await fixture();
    await service.updateSettings({ allowAgentPdfText: true });
    await writeFile(join(vault, 'papers/p1/PAPER.md'), `${'A'.repeat(80)}${'B'.repeat(80)}\nSecond line`);
    const first = await service.readPaper({ vaultId, paperPath: 'papers/p1', source: 'markdown', maxChars: 80 });
    expect(first.content).toBe('A'.repeat(80)); expect(first.nextLine).toBe(1); expect(first.nextOffset).toBe(80);
    const second = await service.readPaper({ vaultId, paperPath: 'papers/p1', source: 'markdown', startLine: first.nextLine!, startOffset: first.nextOffset!, maxChars: 80 });
    expect(second.content).toBe('B'.repeat(80)); expect(second.nextLine).toBe(2); expect(second.nextOffset).toBe(0);
  });

  it('rejects cross-group paper updates before any native mutation', async () => {
    const { service, vaultId, natives } = await fixture();
    await expect(service.updatePaper({ vaultId, paperPath: 'papers/p1', title: 'New', tags: ['Agent'] })).rejects.toMatchObject({ code: 'INVALID_UPDATE' });
    expect(natives).toHaveLength(0);
  });

  it('bounds PDF chunks, requires revision continuity and detects changed files', async () => {
    const { service, vaultId, vault } = await fixture();
    const path = join(vault, 'papers/p1/p1.pdf');
    const bytes = Buffer.alloc(1024 * 1024 + 17, 42); await writeFile(path, bytes);
    const first = await service.readPdfChunk({ vaultId, paperPath: 'papers/p1', length: 10 * 1024 * 1024 });
    expect(Buffer.from(first.base64, 'base64')).toHaveLength(1024 * 1024); expect(first.eof).toBe(false);
    await expect(service.readPdfChunk({ vaultId, paperPath: 'papers/p1', offset: first.nextOffset })).rejects.toMatchObject({ code: 'PDF_REVISION_REQUIRED' });
    const second = await service.readPdfChunk({ vaultId, paperPath: 'papers/p1', offset: first.nextOffset, revision: first.revision });
    expect(Buffer.from(second.base64, 'base64')).toHaveLength(17); expect(second.eof).toBe(true);
    await writeFile(path, Buffer.concat([bytes, Buffer.from('changed')]));
    await expect(service.readPdfChunk({ vaultId, paperPath: 'papers/p1', revision: first.revision })).rejects.toMatchObject({ code: 'PDF_CHANGED' });
  });

  it('captures import ownership and only reports cancellation after runner exit', async () => {
    const { service, vaultId, cli } = await fixture();
    let stop!: () => void;
    cli.operation = request => new Promise((_, reject) => { stop = () => reject(new Error('stopped')); request.signal?.addEventListener('abort', () => setTimeout(stop, 30), { once: true }); });
    const operation = await service.importPaper({ vaultId, text: '1706.03762' });
    await waitUntil(() => !!stop);
    const cancelling = await service.cancelOperation({ operationId: operation.operationId });
    expect(cancelling.status).toBe('cancel_requested');
    await waitUntil(async () => (await service.getOperation({ operationId: operation.operationId })).status === 'cancelled');
    await expect(service.getOperation({ operationId: `other:${operation.operationId}` })).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' });
  });

  it('isolates CLI configuration and never overwrites an existing isolated config', async () => {
    const root = await temporary();
    const first = await cliEnvironment(root);
    const path = join(first.XDG_CONFIG_HOME!, 'agentero', 'config.toml');
    await writeFile(path, 'known_vaults = ["keep"]\n');
    const next = await cliEnvironment(root, '/explicit/pdfium');
    expect(await readFile(path, 'utf8')).toBe('known_vaults = ["keep"]\n');
    expect(next.XDG_CONFIG_HOME).toBe(join(root, 'cli-config'));
    expect(next.PDFIUM_LIB_PATH).toBe('/explicit/pdfium');
  });
});

it('stops the real owned CLI process and its child tree on cancellation', async () => {
  const root = await temporary();
  const file = join(root, 'pids.json');
  const runner = new ProcessCliRunner();
  const controller = new AbortController();
  const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000);`;
  const pending = runner.run({ cliPath: process.execPath, args: ['-e', script], dataRoot: join(root, 'data'), signal: controller.signal, timeoutMs: 10000 });
  cleanups.push(async () => { controller.abort(); await runner.close(); await pending.catch(() => undefined); });
  await waitUntil(async () => readFile(file).then(() => true, () => false));
  const pids = JSON.parse(await readFile(file, 'utf8')) as { parent: number; child: number };
  const closing = runner.close();
  controller.abort();
  await closing;
  expect((await pending).cancelled).toBe(true);
  const stopped = (pid: number) => { try { process.kill(pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; } };
  await waitUntil(() => stopped(pids.parent) && stopped(pids.child));
}, 15000);
