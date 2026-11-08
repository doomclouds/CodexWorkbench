import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliRequest, CliResult, CliRunner } from '../contracts/types.js';
import { LibraryError } from '../contracts/errors.js';

export async function cliEnvironment(dataRoot: string, pdfiumPath?: string): Promise<NodeJS.ProcessEnv> {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENTERO_')));
  environment.XDG_CONFIG_HOME = join(dataRoot, 'cli-config');
  environment.XDG_CACHE_HOME = join(dataRoot, 'cache', 'agentero');
  const configDirectory = join(environment.XDG_CONFIG_HOME, 'agentero');
  await mkdir(configDirectory, { recursive: true });
  await mkdir(environment.XDG_CACHE_HOME, { recursive: true });
  // An existing isolated config prevents the CLI's legacy user-config migration.
  try { await writeFile(join(configDirectory, 'config.toml'), 'known_vaults = []\n', { flag: 'wx', mode: 0o600 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  delete environment.PDFIUM_LIB_PATH;
  if (pdfiumPath) environment.PDFIUM_LIB_PATH = pdfiumPath;
  return environment;
}

const stoppingProcesses = new WeakMap<ChildProcess, Promise<void>>();

export function stopOwnedProcess(child: ChildProcess): Promise<void> {
  let stopping = stoppingProcesses.get(child);
  if (!stopping) { stopping = stopOwnedProcessTree(child); stoppingProcesses.set(child, stopping); }
  return stopping;
}

async function stopOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  if (process.platform === 'win32') {
    // taskkill is an OS adapter, scoped to the live process we spawned and its tree.
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => { child.kill(); resolve(); });
      killer.once('close', () => resolve());
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already stopped */ }
  }, 750);
  timer.unref();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([exited, new Promise<void>(resolve => { deadline = setTimeout(resolve, 3000); })]); }
  finally { clearTimeout(timer); clearTimeout(deadline); }
}

export function spawnOwned(cliPath: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(cliPath, args, { env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
}

export class ProcessCliRunner implements CliRunner {
  private readonly children = new Set<ChildProcess>();
  private closed = false;

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.children].map(stopOwnedProcess));
  }

  async run(request: CliRequest): Promise<CliResult> {
    if (this.closed) throw new LibraryError('SERVICE_CLOSED', 'CLI 执行器已关闭。');
    if (request.signal?.aborted) return { code: null, stdout: '', stderr: '', cancelled: true };
    const env = await cliEnvironment(request.dataRoot, request.pdfiumPath);
    if (this.closed) throw new LibraryError('SERVICE_CLOSED', 'CLI 执行器已关闭。');
    const child = spawnOwned(request.cliPath, request.args, env);
    this.children.add(child);
    return await new Promise<CliResult>((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let timedOut = false;
      let cancelled = false;
      let excessive = false;
      let stopping: Promise<void> | undefined;
      const stop = () => { stopping ??= stopOwnedProcess(child); };
      const abort = () => { cancelled = true; stop(); };
      const timer = setTimeout(() => { timedOut = true; stop(); }, request.timeoutMs ?? 30_000);
      request.signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); this.children.delete(child); };
      child.stdout?.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) { excessive = true; stop(); return; }
        stdout.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => { if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk); });
      child.once('error', error => { cleanup(); reject(new LibraryError('CLI_NOT_FOUND', `无法启动 Agentero CLI：${error.message}`)); });
      child.once('close', async code => {
        cleanup();
        await stopping;
        if (excessive) { reject(new LibraryError('UPSTREAM_LIMIT', '上游输出超过 32 MiB，请缩小操作范围。')); return; }
        resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), timedOut, cancelled });
      });
      if (request.signal?.aborted) abort();
    });
  }
}
