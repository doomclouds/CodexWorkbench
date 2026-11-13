import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, win32 } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliRequest, CliRunner } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { externalPdfCommand, requestExternalPdfOpen } from '../src/infrastructure/external-pdf.js';
import { diagnosticPdf } from '../src/infrastructure/pdf-probe.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function makeVault(path: string) {
  for (const name of ['papers', 'notes', '.agentero']) await mkdir(join(path, name), { recursive: true });
  await writeFile(join(path, '.agentero/catalog.sqlite'), 'owned mock catalog');
}
class Cli implements CliRunner {
  calls: CliRequest[] = [];
  version = '0.15.2';
  failParse = false;
  parse?: (request: CliRequest) => Promise<void>;
  async run(request: CliRequest) {
    this.calls.push(request); const args = request.args;
    if (args.includes('--version')) return { code: 0, stdout: `agentero ${this.version}`, stderr: '' };
    if (args.includes('parse')) {
      try { await this.parse?.(request); } catch { return { code: 1, cancelled: true, stdout: '', stderr: '' }; }
      if (this.failParse) return { code: 1, stdout: JSON.stringify({ ok: false, error: { message: 'PDFium unavailable' } }), stderr: '' };
    }
    let data: unknown = {};
    if (args.includes('describe')) data = { id: 'paper.list' };
    if (args.includes('vault') && args.includes('create')) await makeVault(args[args.indexOf('create') + 1]);
    if (args.includes('import')) data = { papers: [{ path: 'papers/codex-workbench-probe' }] };
    return { code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' };
  }
  count(command: string) { return this.calls.filter(call => call.args.includes(command)).length; }
}
async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-status-owned-'));
  cleanup.push(async () => { expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-status-owned-')).toBe(true); await rm(root, { recursive: true, force: true }); });
  const vault = join(root, 'Vault 中文'), dataRoot = join(root, 'data'); await makeVault(vault);
  const cli = new Cli(), opened: string[] = [];
  const service = new LibraryService({ dataRoot, cliRunner: cli, externalPdfOpener: async path => { opened.push(path); } });
  cleanup.push(() => service.close());
  const settings = await service.updateSettings({ cliPath: 'owned-agentero', vaultPath: vault, allowAgentPdfText: true });
  return { root, vault, dataRoot, cli, opened, service, vaultId: settings.vaultId! };
}

describe('lightweight status and explicit PDF diagnostics', () => {
  it('does not import or parse a fixture from ordinary repeated status calls', async () => {
    const { service, cli, dataRoot } = await fixture();
    for (let i = 0; i < 4; i++) {
      const status = await service.status();
      expect(status).toMatchObject({ ready: true, pdfium: { available: null, state: 'unknown' }, capabilities: { pdfRead: true, pdfText: false, pdfParse: false } });
    }
    expect(cli.count('import')).toBe(0); expect(cli.count('parse')).toBe(0); expect(cli.count('create')).toBe(0);
    await expect(stat(join(dataRoot, 'cache/diagnostics'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('persists explicit diagnostics across instances without a TTL or implicit repeat', async () => {
    const { service, cli, dataRoot } = await fixture();
    expect((await service.status({ diagnosePdf: true })).pdfium).toMatchObject({ available: true, state: 'available', checkedAt: expect.any(String) });
    expect(cli.count('import')).toBe(1); expect(cli.count('parse')).toBe(1);
    const path = join(dataRoot, 'state/pdf-diagnostic.json'), saved = JSON.parse(await readFile(path, 'utf8'));
    saved.checkedAt = '2001-01-01T00:00:00.000Z'; await writeFile(path, JSON.stringify(saved));
    const secondCli = new Cli(), second = new LibraryService({ dataRoot, cliRunner: secondCli }); cleanup.push(() => second.close());
    for (let i = 0; i < 3; i++) expect((await second.status()).pdfium).toMatchObject({ available: true, checkedAt: saved.checkedAt });
    expect(secondCli.count('parse')).toBe(0); expect(secondCli.count('import')).toBe(0);
    await second.status({ diagnosePdf: true });
    expect(secondCli.count('parse')).toBe(1);
    expect((await service.status()).pdfium.checkedAt).not.toBe(saved.checkedAt);
    expect(cli.count('parse')).toBe(1);
  });
  it('does not reuse another CLI/PDFium/version fingerprint and caches failed diagnoses honestly', async () => {
    const { service, cli, root } = await fixture(); await service.status({ diagnosePdf: true });
    await service.updateSettings({ pdfiumPath: join(root, 'pdfium-new') });
    expect((await service.status()).pdfium).toMatchObject({ configured: true, available: null, state: 'unknown' });
    expect(cli.count('parse')).toBe(1);
    cli.failParse = true;
    expect((await service.status({ diagnosePdf: true })).pdfium).toMatchObject({ available: false, state: 'unavailable' });
    expect((await service.status()).pdfium.state).toBe('unavailable'); expect(cli.count('parse')).toBe(2);
    await service.updateSettings({ cliPath: 'another-agentero' });
    expect((await service.status()).pdfium.available).toBeNull(); expect(cli.count('parse')).toBe(2);
    cli.version = '0.15.3';
    expect((await service.status({ diagnosePdf: true })).pdfium.state).toBe('unknown'); expect(cli.count('parse')).toBe(2);
  });
  it('keeps ordinary status responsive during a diagnosis and rejects stale completion after another instance changes config', async () => {
    const { service, cli, dataRoot } = await fixture();
    let started!: () => void, release!: () => void;
    const incoming = new Promise<void>(resolve => { started = resolve; });
    cli.parse = request => new Promise<void>((resolve, reject) => { release = resolve; started(); request.signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); });
    const diagnosing = service.status({ diagnosePdf: true }).catch(error => error); await incoming;
    expect((await service.status()).pdfium.state).toBe('unknown');
    const secondCli = new Cli(), second = new LibraryService({ dataRoot, cliRunner: secondCli }); cleanup.push(() => second.close());
    await second.updateSettings({ cliPath: 'second-agentero' }); await second.status({ diagnosePdf: true });
    const completed = await readFile(join(dataRoot, 'state/pdf-diagnostic.json'), 'utf8');
    release(); expect(await diagnosing).toMatchObject({ code: 'SETTINGS_CHANGED' });
    expect(await readFile(join(dataRoot, 'state/pdf-diagnostic.json'), 'utf8')).toBe(completed);
    expect((await service.status()).pdfium.available).toBe(true);
  });
  it('treats malformed derived cache as unknown and stops an owned explicit diagnosis on close', async () => {
    const { service, cli, dataRoot } = await fixture();
    await mkdir(join(dataRoot, 'state')); await writeFile(join(dataRoot, 'state/pdf-diagnostic.json'), '{invalid');
    expect((await service.status()).pdfium.state).toBe('unknown'); expect(cli.count('parse')).toBe(0);
    let started!: () => void; const incoming = new Promise<void>(resolve => { started = resolve; });
    cli.parse = request => new Promise<void>((_resolve, reject) => { started(); request.signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); });
    const pending = service.status({ diagnosePdf: true }).catch(error => error); await incoming; await service.close();
    expect(await pending).toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(await readFile(join(dataRoot, 'state/pdf-diagnostic.json'), 'utf8')).toBe('{invalid');
  });
});

describe('explicit system PDF opening', () => {
  it('builds Windows/macOS argv and sends a shell-free request without claiming a visible window', async () => {
    const windows = 'C:\\Vault 中文\\Paper.pdf', mac = '/Users/test/Vault 中文/Paper.pdf';
    const windowsCommand = externalPdfCommand(windows, 'win32');
    expect(windowsCommand.command).toBe(win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    expect(Buffer.from(windowsCommand.args.at(-1)!, 'base64').toString('utf16le')).toContain('Start-Process -FilePath $env:CODEXWORKBENCH_OPEN_PATH -ErrorAction Stop');
    expect(windowsCommand.args.join(' ')).not.toContain(windows);
    expect(externalPdfCommand(mac, 'darwin')).toEqual({ command: '/usr/bin/open', args: [mac] });
    const calls: { command: string; args: string[]; options: SpawnOptions }[] = [];
    await requestExternalPdfOpen(windows, { platform: 'win32', spawn(command, args, options) {
      calls.push({ command, args, options }); const child = new EventEmitter() as ChildProcess;
      queueMicrotask(() => { child.emit('spawn'); child.emit('close', 0, null); }); return child;
    } });
    expect(calls[0]).toMatchObject({ ...windowsCommand, options: { shell: false, windowsHide: true, stdio: 'ignore', env: { CODEXWORKBENCH_OPEN_PATH: windows } } });
    await expect(requestExternalPdfOpen(mac, { platform: 'darwin', spawn() { const child = new EventEmitter() as ChildProcess; queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child; } })).rejects.toMatchObject({ code: 'EXTERNAL_OPEN_FAILED' });
    expect(() => externalPdfCommand('relative.pdf', 'win32')).toThrow(); expect(() => externalPdfCommand('/tmp/file.pdf', 'linux')).toThrow();
  });
  it('waits for dispatch acknowledgment and rejects launcher failures after a successful spawn', async () => {
    const child = new EventEmitter() as ChildProcess;
    let accepted = false;
    const pending = requestExternalPdfOpen('C:\\Vault 中文\\.agentero\\.trash\\batch-one', { platform: 'win32', spawn: () => child }).then(() => { accepted = true; });
    child.emit('spawn'); await Promise.resolve(); expect(accepted).toBe(false);
    child.emit('close', 1, null);
    await expect(pending).rejects.toMatchObject({ code: 'EXTERNAL_OPEN_FAILED' });
    expect(accepted).toBe(false);
    const waiting = new EventEmitter() as ChildProcess; waiting.kill = vi.fn(() => true);
    await expect(requestExternalPdfOpen('/Users/test/Vault 中文', { platform: 'darwin', spawn: () => waiting, timeoutMs: 1 })).rejects.toMatchObject({ code: 'EXTERNAL_OPEN_FAILED', message: expect.stringContaining('超时') });
    expect(waiting.kill).toHaveBeenCalledOnce();
  });
  it('opens only a validated PDF from the current Vault and never launches during status', async () => {
    const { service, vault, root, vaultId, opened } = await fixture();
    await mkdir(join(vault, 'papers/p1')); const pdf = join(vault, 'papers/p1/Paper.pdf'); await writeFile(pdf, diagnosticPdf());
    await service.status(); expect(opened).toEqual([]);
    expect(await service.openPaperExternally({ vaultId, paperPath: 'papers/p1' })).toMatchObject({ requested: true, paperPath: 'papers/p1', fileName: 'Paper.pdf', handler: 'system-default' });
    expect(opened).toEqual([await realpath(pdf)]);
    await expect(service.openPaperExternally({ vaultId: 'old-vault', paperPath: 'papers/p1' })).rejects.toMatchObject({ code: 'VAULT_CHANGED' });
    await expect(service.openPaperExternally({ vaultId, paperPath: '../outside' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'Outside.pdf'), diagnosticPdf());
    await symlink(outside, join(vault, 'papers/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.openPaperExternally({ vaultId, paperPath: 'papers/escape' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await writeFile(pdf, 'not a PDF'); await expect(service.openPaperExternally({ vaultId, paperPath: 'papers/p1' })).rejects.toMatchObject({ code: 'INVALID_PDF' });
    expect(opened).toHaveLength(1);
  });
});
