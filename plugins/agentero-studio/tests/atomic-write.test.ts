import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { atomicWrite } from '../src/core/shared/common.js';
import { StudioService } from '../src/core/service.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let folder: string;
const holders: (() => Promise<void>)[] = [];
const services: StudioService[] = [];
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'studio-atomic-write-')); vi.mocked(rename).mockReset().mockImplementation(actualFs.rename); });
afterEach(async () => {
  for (const release of holders.splice(0)) await release();
  for (const service of services.splice(0)) await service.close();
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected atomic-write fixture');
  await rm(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A real Windows handle that permits reads but omits FILE_SHARE_DELETE. */
async function holdReplacement(file: string) {
  const encodedPath = Buffer.from(file, 'utf8').toString('base64');
  const script = `$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $stream.Dispose() }`;
  const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  const lines = createInterface({ input: child.stdout });
  let released = false;
  const release = async () => { if (released) return; released = true; child.stdin.end('\n'); if (child.exitCode === null) await once(child, 'exit'); lines.close(); };
  holders.push(release);
  const first = await Promise.race([once(lines, 'line').then(([line]) => line), once(child, 'exit').then(([code]) => { throw new Error(`Windows holder exited ${code}: ${stderr}`); })]);
  expect(first).toBe('READY'); return release;
}
function watchFirstFailure(file: string) {
  let failed!: (error: NodeJS.ErrnoException) => void;
  const first = new Promise<NodeJS.ErrnoException>(resolve => { failed = resolve; });
  vi.mocked(rename).mockImplementation(async (source, target) => {
    try { await actualFs.rename(source, target); }
    catch (error) { if (target === file) failed(error as NodeJS.ErrnoException); throw error; }
  });
  return first;
}

it('atomically creates and replaces complete UTF-8 content', async () => {
  const file = join(folder, 'artifact.json'), original = JSON.stringify({ text: '原始内容' }), updated = JSON.stringify({ text: '新内容 🎨' });
  await atomicWrite(file, original); expect(await readFile(file, 'utf8')).toBe(original);
  await atomicWrite(file, updated); expect(await readFile(file, 'utf8')).toBe(updated);
  expect((await readdir(folder)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it.runIf(process.platform === 'win32')('recovers after an ordinary Node reader closes its target handle on Windows', async () => {
  const file = join(folder, 'artifact.json'); await writeFile(file, '{"text":"old"}');
  const reader = await open(file, 'r'), firstFailure = watchFirstFailure(file);
  const result = atomicWrite(file, '{"text":"new"}').then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  try {
    const error = await firstFailure; expect(error.code).toBe('EPERM'); expect(error.syscall).toBe('rename');
    expect(await reader.readFile('utf8')).toBe('{"text":"old"}'); expect(await readFile(file, 'utf8')).toBe('{"text":"old"}');
  } finally { await reader.close(); }
  expect(await result).toEqual({ ok: true }); expect(await readFile(file, 'utf8')).toBe('{"text":"new"}');
  expect((await readdir(folder)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it.runIf(process.platform === 'win32')('recovers after a real Windows sharing violation releases the old file', async () => {
  const file = join(folder, 'artifact.json'); await writeFile(file, 'old complete JSON');
  const release = await holdReplacement(file), firstFailure = watchFirstFailure(file);
  const result = atomicWrite(file, 'new complete JSON').then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  const error = await firstFailure; expect(['EPERM', 'EBUSY', 'EACCES']).toContain(error.code);
  expect(error.syscall).toBe('rename'); expect(await readFile(file, 'utf8')).toBe('old complete JSON');
  console.info('Windows native blocked rename:', { code: error.code, syscall: error.syscall });
  await release(); expect(await result).toEqual({ ok: true });
  expect(await readFile(file, 'utf8')).toBe('new complete JSON'); expect(vi.mocked(rename).mock.calls.length).toBeGreaterThan(1);
  expect((await readdir(folder)).filter(name => name.endsWith('.tmp'))).toEqual([]);
}, 15000);

it.runIf(process.platform === 'win32')('exhausts bounded retries without deleting old data when a Windows holder persists', async () => {
  const file = join(folder, 'artifact.json'); await writeFile(file, '{"text":"old"}');
  await holdReplacement(file); const failures: NodeJS.ErrnoException[] = [];
  vi.mocked(rename).mockImplementation(async (source, target) => { try { await actualFs.rename(source, target); } catch (error) { failures.push(error as NodeJS.ErrnoException); throw error; } });
  const failure = await atomicWrite(file, '{"text":"new"}').then(() => undefined, error => error);
  expect(failures).toHaveLength(6); expect(failure).toBe(failures.at(-1)); expect(failure.syscall).toBe('rename');
  expect(['EPERM', 'EBUSY', 'EACCES']).toContain(failure.code); expect(await readFile(file, 'utf8')).toBe('{"text":"old"}');
  expect((await readdir(folder)).filter(name => name.endsWith('.tmp'))).toEqual([]);
}, 15000);

it('does not retry an unrelated filesystem error or replace the old target', async () => {
  const file = join(folder, 'artifact.json'); await writeFile(file, 'old');
  const error = Object.assign(new Error('Synthetic I/O failure'), { code: 'EIO' }); vi.mocked(rename).mockRejectedValue(error);
  await expect(atomicWrite(file, 'new')).rejects.toBe(error); expect(rename).toHaveBeenCalledTimes(1); expect(await readFile(file, 'utf8')).toBe('old');
  expect((await readdir(folder)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it.runIf(process.platform === 'win32')('keeps the transaction lock and CAS while retrying a blocked Windows replacement', async () => {
  const service = new StudioService({ dataRoot: folder }), other = new StudioService({ dataRoot: folder }); services.push(service, other);
  const created = await service.execute('artifact_manage', { action: 'create', elements: [{ id: 'a', type: 'text', text: 'old' }] });
  const id = created.artifact.id, file = service.store.file(id), release = await holdReplacement(file), firstFailure = watchFirstFailure(file);
  const attempt = (instance: StudioService, text: string) => instance.execute('artifact_apply', { artifactId: id, operationId: randomUUID(), expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { text } }] });
  const first = attempt(service, 'committed once').then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  await firstFailure; expect(JSON.parse(await readFile(file, 'utf8')).content.elements[0]).toMatchObject({ text: 'old', version: 1 });
  const second = attempt(other, 'stale overwrite').then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  await release(); const results = await Promise.all([first, second]);
  expect(results[0].ok).toBe(true); expect(results[1]).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  const board = await service.execute('artifact_read', { artifactId: id, mode: 'board' });
  expect(board.elements[0]).toMatchObject({ text: 'committed once', version: 2 }); expect(board.artifact.revision).toBe(1);
  expect((await service.store.read(id)).operations).toHaveLength(1);
}, 15000);
