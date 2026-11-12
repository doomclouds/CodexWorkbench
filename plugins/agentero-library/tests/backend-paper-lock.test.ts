import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliResult, CliRunner, LibraryOperation } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { withPaperDocumentLock } from '../src/infrastructure/paper-lock.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const success = (data: unknown = {}): CliResult => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, data }) });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-paper-lock-owned-'));
  const vault = join(root, 'Vault 中文 空格'), dataRoot = join(root, 'data');
  cleanups.push(async () => {
    expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-paper-lock-owned-')).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['.agentero', 'papers/a', 'papers/b', 'notes'].map(path => mkdir(join(vault, path), { recursive: true })));
  await mkdir(dataRoot);
  await writeFile(join(vault, '.agentero/catalog.sqlite'), 'isolated fake catalog');
  await Promise.all(['a', 'b'].map(name => writeFile(join(vault, `papers/${name}/PAPER.md`), `Original ${name}.`)));
  return { root, vault, dataRoot };
}

async function services() {
  const location = await fixture(), entered = deferred(), proceed = deferred();
  let parseCalls = 0, writes = 0;
  const cliRunner: CliRunner = { async run(request) {
    if (request.args.includes('--version')) return { code: 0, stdout: 'agentero 0.15.2', stderr: '' };
    if (request.args.includes('describe')) return success({ id: 'paper.list' });
    if (request.args.includes('parse')) {
      parseCalls++; expect(request.args).toContain('--force'); entered.resolve();
      await proceed.promise;
      if (request.signal?.aborted) return { code: 1, stdout: '', stderr: '', cancelled: true };
      await writeFile(join(location.vault, 'papers/a/PAPER.md'), 'Freshly parsed a.');
    }
    return success();
  } };
  const nativeFactory = async () => ({ async close() {}, async call(name: string, args: Record<string, unknown>) {
    if (name === 'file_write') { writes++; await writeFile(join(location.vault, String(args.path)), String(args.content)); }
    return {};
  } });
  const first = new LibraryService({ dataRoot: location.dataRoot, cliRunner, nativeFactory });
  const second = new LibraryService({ dataRoot: location.dataRoot, cliRunner, nativeFactory });
  cleanups.push(() => second.close()); cleanups.push(() => first.close()); cleanups.push(async () => { proceed.resolve(); });
  const settings = await first.updateSettings({ cliPath: 'fake-paper-lock-cli', vaultPath: location.vault, allowAgentPdfText: true });
  return { ...location, first, second, paper: { vaultId: settings.vaultId!, paperPath: 'papers/a' }, entered, proceed, parseCalls: () => parseCalls, writes: () => writes };
}

async function finished(service: LibraryService, operation: LibraryOperation) {
  let latest = operation;
  await expect.poll(async () => {
    latest = await service.getOperation(operation);
    return ['succeeded', 'failed', 'cancelled'].includes(latest.status);
  }, { timeout: 3000, interval: 10 }).toBe(true);
  return latest;
}

interface ChildMessage { event: string; code?: string }
async function childOwner(location: Awaited<ReturnType<typeof fixture>>, rejectOnAbort = false) {
  const entry = join(location.root, 'paper-lock-owner.cjs');
  const modulePath = fileURLToPath(new URL('../src/infrastructure/paper-lock.ts', import.meta.url));
  await build({ stdin: { contents: `
    import { withPaperDocumentLock } from ${JSON.stringify(modulePath)};
    const [dataRoot, vault, abortMode] = process.argv.slice(2);
    withPaperDocumentLock(dataRoot, vault, 'papers/a', async (check, signal) => {
      await new Promise((resolve, reject) => {
        const finish = () => {
          signal.removeEventListener('abort', finish); process.off('message', message);
          if (signal.aborted && abortMode === 'reject-on-abort') reject(Object.assign(new Error('parser cancelled'), { code: 'OPERATION_CANCELLED' })); else resolve();
        };
        const message = value => { if (value === 'release') finish(); };
        signal.addEventListener('abort', finish, { once: true }); process.on('message', message);
        process.send({ event: 'acquired' });
      });
      check();
    }).then(() => process.send({ event: 'finished' }), error => process.send({ event: 'finished', code: error.code ?? 'UNEXPECTED' }))
      .finally(() => process.disconnect());
  `, resolveDir: dirname(modulePath), sourcefile: 'paper-lock-owner.ts', loader: 'ts' }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' });
  const child = spawn(process.execPath, [entry, location.dataRoot, location.vault, rejectOnAbort ? 'reject-on-abort' : 'resolve-on-abort'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const messages: ChildMessage[] = []; let stderr = '';
  child.on('message', message => messages.push(message as ChildMessage)); child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; }
  });
  await expect.poll(() => messages.some(message => message.event === 'acquired'), { timeout: 3000, interval: 10 }).toBe(true);
  return { child, messages, exit, stderr: () => stderr };
}

async function releaseChild(child: ChildProcess) { await new Promise<void>((resolve, reject) => child.send('release', error => error ? reject(error) : resolve())); }

describe('shared paper parse/save lock', () => {
  it('blocks another Service during force-parse, then rejects its stale revision and accepts a fresh save', async () => {
    const setup = await services(), { first, second, paper, vault, entered, proceed } = setup;
    const old = await second.readEditablePaperMarkdown(paper);
    const parsing = await first.parsePaper({ ...paper, force: true }); await entered.promise;
    await expect(second.writePaperMarkdown({ ...paper, revision: old.revision!, content: 'Must not be overwritten by parser.' })).rejects.toMatchObject({ code: 'DOCUMENT_BUSY', retryable: true });
    expect(setup.writes()).toBe(0); expect(await readFile(join(vault, 'papers/a/PAPER.md'), 'utf8')).toBe('Original a.');
    proceed.resolve(); expect((await finished(first, parsing)).status).toBe('succeeded');
    await expect(second.writePaperMarkdown({ ...paper, revision: old.revision!, content: 'Stale editor draft.' })).rejects.toMatchObject({ code: 'MARKDOWN_CONFLICT' });
    const fresh = await second.readEditablePaperMarkdown(paper);
    expect(fresh.content).toBe('Freshly parsed a.');
    const saved = await second.writePaperMarkdown({ ...paper, revision: fresh.revision!, content: 'Saved after parse.' });
    expect(saved.saved).toBe(true); expect(setup.writes()).toBe(1);
    expect(await readFile(join(vault, 'papers/a/PAPER.md'), 'utf8')).toBe('Saved after parse.');
    expect((await readdir(join(setup.dataRoot, 'state/document-locks'))).filter(name => name.endsWith('.lock'))).toEqual([]);
  });

  it('releases after a failing operation and allows a different paper to proceed independently', async () => {
    const { dataRoot, vault } = await fixture(), entered = deferred(), proceed = deferred();
    cleanups.push(async () => { proceed.resolve(); });
    const sentinel = new Error('synthetic write failure');
    const owner = withPaperDocumentLock(dataRoot, vault, 'papers/a', async () => { entered.resolve(); await proceed.promise; throw sentinel; });
    const failed = expect(owner).rejects.toBe(sentinel); await entered.promise;
    await expect(withPaperDocumentLock(dataRoot, vault, 'papers/b', async () => 'independent')).resolves.toBe('independent');
    await expect(withPaperDocumentLock(dataRoot, vault, 'papers/a', async () => 'unexpected')).rejects.toMatchObject({ code: 'DOCUMENT_BUSY' });
    proceed.resolve(); await failed;
    await expect(withPaperDocumentLock(dataRoot, vault, 'papers/a', async () => 'released')).resolves.toBe('released');
  });

  it('cancels a queued parse without replaying it or leaving a lock behind', async () => {
    const setup = await services(), { first, second, paper, entered, proceed } = setup;
    const running = await first.parsePaper({ ...paper, force: true }); await entered.promise;
    const pending = await first.parsePaper({ ...paper, force: true });
    await first.cancelOperation(pending); proceed.resolve();
    expect((await finished(first, running)).status).toBe('succeeded');
    expect((await finished(first, pending)).status).toBe('cancelled'); expect(setup.parseCalls()).toBe(1);
    const fresh = await second.readEditablePaperMarkdown(paper);
    await expect(second.writePaperMarkdown({ ...paper, revision: fresh.revision!, content: 'Save after queued cancellation.' })).resolves.toMatchObject({ saved: true });
  });

  it('blocks another Service from moving a folder during note save, then moves the completed content without resurrecting its old folder', async () => {
    const { vault, dataRoot } = await fixture(), entered = deferred(), proceed = deferred();
    let holdWrites = false;
    const mutations: { owner: string; name: string }[] = [];
    const cliRunner: CliRunner = { async run(request) { return request.args.includes('--version') ? { code: 0, stdout: 'agentero 0.15.2', stderr: '' } : success(request.args.includes('describe') ? { id: 'paper.list' } : {}); } };
    const nativeFactory = (owner: string) => async () => ({ async close() {}, async call(name: string, args: Record<string, unknown>) {
      if (name === 'file_read') return { content: await readFile(join(vault, String(args.path)), 'utf8') };
      if (name === 'file_write') {
        mutations.push({ owner, name });
        if (owner === 'first' && holdWrites) { entered.resolve(); await proceed.promise; }
        const target = join(vault, String(args.path)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, String(args.content));
      }
      if (name === 'file_move') {
        mutations.push({ owner, name });
        const target = join(vault, String(args.to)); await mkdir(dirname(target), { recursive: true }); await rename(join(vault, String(args.from)), target);
      }
      return {};
    } });
    const first = new LibraryService({ dataRoot, cliRunner, nativeFactory: nativeFactory('first') });
    const second = new LibraryService({ dataRoot, cliRunner, nativeFactory: nativeFactory('second') });
    cleanups.push(() => second.close()); cleanups.push(() => first.close()); cleanups.push(async () => { proceed.resolve(); });
    const { vaultId } = await first.updateSettings({ cliPath: 'fake-notes-lock-cli', vaultPath: vault });
    const folder = await first.createNoteFolder({ vaultId: vaultId!, parentPath: 'notes', name: 'Original' });
    const note = await first.createNote({ vaultId: vaultId!, folderPath: folder.path, title: 'One', content: 'Original note.' });
    const before = (await second.noteTree({ vaultId: vaultId! })).items.find(item => item.path === folder.path)!;
    holdWrites = true;
    const pendingSave = first.writeNote({ vaultId: vaultId!, path: note.path, revision: note.revision, content: 'Completed note save.' });
    await entered.promise;
    await expect(second.moveNoteFolder({ vaultId: vaultId!, path: folder.path, newPath: 'notes/Moved', revision: before.revision! })).rejects.toMatchObject({ code: 'DOCUMENT_BUSY', retryable: true });
    await expect(second.createNoteFolder({ vaultId: vaultId!, parentPath: folder.path, name: 'Must not appear' })).rejects.toMatchObject({ code: 'DOCUMENT_BUSY' });
    expect(mutations.filter(item => item.owner === 'second')).toEqual([]);
    expect(await readdir(join(vault, folder.path))).toEqual(['One.md']);
    expect(await readFile(join(vault, note.path), 'utf8')).toBe('Original note.');
    proceed.resolve(); await expect(pendingSave).resolves.toMatchObject({ saved: true, content: 'Completed note save.' });
    const after = (await second.noteTree({ vaultId: vaultId! })).items.find(item => item.path === folder.path)!;
    await expect(second.moveNoteFolder({ vaultId: vaultId!, path: folder.path, newPath: 'notes/Moved', revision: after.revision! })).resolves.toMatchObject({ path: 'notes/Moved' });
    expect((await second.readNote({ vaultId: vaultId!, path: 'notes/Moved/One.md' })).content).toBe('Completed note save.');
    expect(await readdir(join(vault, 'notes'))).toEqual(['Moved']);
    expect(mutations).toEqual([{ owner: 'first', name: 'file_write' }, { owner: 'first', name: 'file_write' }, { owner: 'second', name: 'file_move' }]);
  });

  it('excludes an actual child Node process and releases ownership after its acknowledged completion', async () => {
    const location = await fixture(), owner = await childOwner(location);
    await expect(withPaperDocumentLock(location.dataRoot, location.vault, 'papers/a', async () => 'unexpected')).rejects.toMatchObject({ code: 'DOCUMENT_BUSY' });
    await expect(withPaperDocumentLock(location.dataRoot, location.vault, 'papers/b', async () => 'independent')).resolves.toBe('independent');
    await releaseChild(owner.child); await expect(owner.exit).resolves.toEqual({ code: 0, signal: null });
    expect(owner.messages).toContainEqual({ event: 'finished' }); expect(owner.stderr()).toBe('');
    await expect(withPaperDocumentLock(location.dataRoot, location.vault, 'papers/a', async () => 'released')).resolves.toBe('released');
  });

  it('reports lease loss even when a compromised child parser rejects as cancelled, without an uncaught host-process exception', async () => {
    const location = await fixture(), owner = await childOwner(location, true);
    const directory = join(location.dataRoot, 'state/document-locks'), names = await readdir(directory);
    expect(names).toHaveLength(1); expect(names[0]).toMatch(/^[a-f\d]{64}\.lock$/);
    const lockPath = join(directory, names[0]); expect(dirname(await realpath(lockPath))).toBe(await realpath(directory));
    await utimes(lockPath, new Date(0), new Date(0));
    await expect.poll(() => owner.messages.find(message => message.event === 'finished'), { timeout: 8000, interval: 25 }).toEqual({ event: 'finished', code: 'DOCUMENT_LOCK_LOST' });
    await expect(owner.exit).resolves.toEqual({ code: 0, signal: null }); expect(owner.stderr()).toBe('');
  }, 12_000);
});
