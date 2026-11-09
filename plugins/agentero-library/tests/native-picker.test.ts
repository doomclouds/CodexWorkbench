import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync, spawn as spawnProcess, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeNativePickers, nativePickerLaunch, pickNativePath, validatePickerInput, validatePickerResult } from '../src/infrastructure/native-picker';
import type { FilePickerInput } from '../src/contracts/picker';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await closeNativePickers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'codex-picker-test-'));
  cleanups.push(async () => {
    expect(dirname(root)).toBe(parent);
    expect(basename(root).startsWith('codex-picker-test-')).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
  const folder = join(root, '中文 知识库');
  await mkdir(folder);
  const one = join(folder, '实验 样本 one.PDF');
  const two = join(folder, '实验样本二.pdf');
  const cli = join(folder, 'agentero');
  const cliExe = join(folder, 'agentero.exe');
  await Promise.all([writeFile(one, '%PDF-test'), writeFile(two, '%PDF-test'), writeFile(cli, 'executable placeholder'), writeFile(cliExe, 'executable placeholder')]);
  return { root, folder, one, two, cli, cliExe };
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  constructor(pid: number) { super(); this.pid = pid; }
  respond(value: unknown, code = 0) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    const character = bytes.indexOf(Buffer.from('实'));
    const split = character >= 0 ? character + 1 : Math.floor(bytes.length / 2);
    this.stdout.write(bytes.subarray(0, split));
    this.stdout.end(bytes.subarray(split)); this.stderr.end();
    this.exitCode = code; this.emit('close', code, null);
  }
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.killed = true; this.signalCode = signal;
    queueMicrotask(() => { this.stdout.end(); this.stderr.end(); this.emit('close', null, signal); });
    return true;
  }
}

function executor(onDialog?: (child: FakeChild) => void) {
  const calls: { command: string; args: readonly string[]; options: SpawnOptions; child: FakeChild }[] = [];
  let dialog: FakeChild | undefined;
  const spawn = (command: string, args: readonly string[], options: SpawnOptions) => {
    const child = new FakeChild(calls.length + 5001);
    calls.push({ command, args, options, child });
    if (command.toLowerCase().endsWith('taskkill.exe')) queueMicrotask(() => { dialog?.kill(); child.respond({}); });
    else { dialog = child; if (onDialog) queueMicrotask(() => onDialog(child)); }
    return child as unknown as ChildProcess;
  };
  return { calls, spawn };
}

describe('native picker input and platform contracts', () => {
  it('uses only OS-provided launchers and passes user data outside script text', async () => {
    const { one } = await fixture();
    const fake = executor(child => child.respond({ cancelled: false, paths: [one] }));
    const marker = "用户 '引号' $() `备注`";
    expect(await pickNativePath({ mode: 'open-file', title: marker, filters: [{ name: 'PDF', extensions: ['PDF'] }] }, { platform: 'win32', spawn: fake.spawn })).toEqual({ cancelled: false, paths: [one] });
    const call = fake.calls[0];
    expect(call.options.shell).toBe(false); expect(call.options.windowsHide).toBe(true);
    expect(call.args).toContain('-STA'); expect(call.args).toContain('-EncodedCommand');
    const script = Buffer.from(call.args[call.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    expect(script).not.toContain(marker); expect(script).not.toContain('DllImport'); expect(script).not.toContain('Add-Type -TypeDefinition');
    const payload = JSON.parse(String(call.options.env?.CODEXWORKBENCH_PICKER_REQUEST));
    expect(payload.title).toBe(marker); expect(payload.filters[0].extensions).toEqual(['pdf']);
  });

  it('defines a macOS AppKit panel without a new runtime or script interpolation', () => {
    const launch = nativePickerLaunch('darwin');
    expect(launch.command).toBe('/usr/bin/osascript'); expect(launch.args.slice(0, 2)).toEqual(['-l', 'JavaScript']);
    const script = launch.args[3];
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('NSOpenPanel'); expect(script).toContain('NSSavePanel');
    expect(script).toContain('allowsMultipleSelection'); expect(script).toContain('activateIgnoringOtherApps');
    expect(script).not.toContain('System Events'); expect(script).not.toContain('python');
    expect(() => nativePickerLaunch('linux')).toThrow('Windows 和 macOS');
  });

  it.skipIf(process.platform !== 'win32')('parses the Windows helper with the installed PowerShell without opening a dialog', () => {
    const launch = nativePickerLaunch('win32');
    const script = Buffer.from(launch.args[launch.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    const parser = "$ProgressPreference='SilentlyContinue'; $tokens=$null; $parseErrors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:PICKER_TEST_SCRIPT,[ref]$tokens,[ref]$parseErrors); @{errors=@($parseErrors | ForEach-Object {$_.Message})} | ConvertTo-Json -Compress";
    const output = execFileSync(launch.command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(parser, 'utf16le').toString('base64')], { env: { ...process.env, PICKER_TEST_SCRIPT: script }, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    expect(JSON.parse(output.replace(/^\uFEFF/, '')).errors).toEqual([]);
  });

  it.skipIf(process.platform !== 'win32')('round-trips Chinese paths as encoded JSON through the actual Windows launcher', async () => {
    const { one, two } = await fixture();
    const launch = nativePickerLaunch('win32');
    const program = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $request=ConvertFrom-Json -InputObject $env:CODEXWORKBENCH_PICKER_REQUEST; [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{cancelled=$false;paths=@($request.paths)}))";
    const output = execFileSync(launch.command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')], { env: { ...process.env, CODEXWORKBENCH_PICKER_REQUEST: JSON.stringify({ paths: [one, two] }) }, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    expect(JSON.parse(output.replace(/^\uFEFF/, ''))).toEqual({ cancelled: false, paths: [one, two] });
  });

  it('rejects unknown launch parameters, invalid filters and unsupported multi-select modes', () => {
    expect(() => validatePickerInput({ mode: 'open-file', command: 'unrelated' } as FilePickerInput)).toThrow('未知参数');
    expect(() => validatePickerInput({ mode: 'open-directory', multiple: true })).toThrow('多选');
    expect(() => validatePickerInput({ mode: 'save-file', multiple: true })).toThrow('多选');
    expect(() => validatePickerInput({ mode: 'open-file', filters: [{ name: 'PDF|unexpected', extensions: ['pdf'] }] })).toThrow('筛选');
    expect(() => validatePickerInput({ mode: 'open-file', filters: [{ name: 'PDF', extensions: ['*.pdf'] }] })).toThrow('筛选');
  });
});

describe('selection and cancellation results', () => {
  it('supports single and multiple PDF paths containing spaces and Chinese without UTF-8 damage', async () => {
    const { one, two } = await fixture();
    const fake = executor(child => child.respond({ cancelled: false, paths: [one, two] }));
    const result = await pickNativePath({ mode: 'open-file', multiple: true, filters: [{ name: 'PDF 文件', extensions: ['pdf'] }] }, { platform: 'win32', spawn: fake.spawn });
    expect(result.paths).toEqual([one, two]);
    expect(await validatePickerResult({ cancelled: false, paths: [one] }, { mode: 'open-file' })).toEqual({ cancelled: false, paths: [one] });
  });

  it('normalizes cancellation to an empty list even if a helper includes obsolete paths', async () => {
    const fake = executor(child => child.respond({ cancelled: true, paths: ['invalid obsolete value'] }));
    const result = await pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: fake.spawn });
    expect(result).toEqual({ cancelled: true, paths: [] });
  });

  it('accepts an extensionless CLI, filters file types, and requires a directory for folder mode', async () => {
    const { cli, cliExe, one, folder } = await fixture();
    expect(await validatePickerResult({ cancelled: false, paths: [cli] }, { mode: 'open-file' })).toEqual({ cancelled: false, paths: [cli] });
    await expect(validatePickerResult({ cancelled: false, paths: [cli] }, { mode: 'open-file', filters: [{ name: 'Windows 应用', extensions: ['exe'] }] })).rejects.toThrow('文件类型');
    expect(await validatePickerResult({ cancelled: false, paths: [cliExe] }, { mode: 'open-file', filters: [{ name: 'Windows 应用', extensions: ['exe'] }] })).toEqual({ cancelled: false, paths: [cliExe] });
    expect(await validatePickerResult({ cancelled: false, paths: [folder] }, { mode: 'open-directory' })).toEqual({ cancelled: false, paths: [folder] });
    await expect(validatePickerResult({ cancelled: false, paths: [one] }, { mode: 'open-directory' })).rejects.toThrow('目录');
  });

  it('treats a basename as a suggested save filename and never starts in the installed plugin cwd', async () => {
    const { folder } = await fixture();
    const target = join(folder, '论文 导出.bib');
    const fake = executor(child => child.respond({ cancelled: false, paths: [target] }));
    expect(await pickNativePath({ mode: 'save-file', defaultPath: '论文.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] }, { platform: 'win32', spawn: fake.spawn })).toEqual({ cancelled: false, paths: [target] });
    const payload = JSON.parse(String(fake.calls[0].options.env?.CODEXWORKBENCH_PICKER_REQUEST));
    expect(payload.fileName).toBe('论文.bib');
    expect([resolve(homedir()), resolve(join(homedir(), 'Documents'))]).toContain(resolve(payload.initialDirectory));
    expect(fake.calls[0].options.cwd).toBe(payload.initialDirectory);
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back from missing initial directories and does not create them merely by opening a picker', async () => {
    const { root, folder } = await fixture();
    const missing = join(root, '未创建', 'deeper', 'library.bib');
    const fake = executor(child => child.respond({ cancelled: true, paths: [] }));
    await pickNativePath({ mode: 'save-file', defaultPath: missing }, { platform: 'win32', spawn: fake.spawn });
    const payload = JSON.parse(String(fake.calls[0].options.env?.CODEXWORKBENCH_PICKER_REQUEST));
    expect(payload.initialDirectory).toBe(root); expect(payload.fileName).toBe('library.bib');
    await expect(readFile(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('owned helper process lifecycle', () => {
  it('times out and terminates only the PID tree created for its own dialog', async () => {
    const fake = executor();
    await expect(pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: fake.spawn, timeoutMs: 100 })).rejects.toMatchObject({ code: 'PICKER_TIMEOUT' });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].args).toEqual(['/PID', String(fake.calls[0].child.pid), '/T', '/F']);
    expect(fake.calls[1].options.windowsHide).toBe(true);
    expect(fake.calls[1].args).not.toContain('/IM');
    expect(fake.calls[0].child.killed).toBe(true);
  });

  it('propagates abort and refuses a second dialog while the first is active', async () => {
    const fake = executor(); const controller = new AbortController();
    const pending = pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: fake.spawn, signal: controller.signal });
    const outcome = pending.catch(error => error);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    await expect(pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: fake.spawn })).rejects.toMatchObject({ code: 'PICKER_BUSY' });
    controller.abort(); expect((await outcome).code).toBe('PICKER_ABORTED');
    expect(fake.calls[0].child.killed).toBe(true);
  });

  it('closes its own outstanding dialogs during server shutdown', async () => {
    const fake = executor();
    const outcome = pickNativePath({ mode: 'open-directory' }, { platform: 'win32', spawn: fake.spawn }).catch(error => error);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    await closeNativePickers(); expect((await outcome).code).toBe('PICKER_ABORTED');
    expect(fake.calls[0].child.killed).toBe(true);
  });

  it('uses a signal on only its owned macOS helper when the request is aborted', async () => {
    const fake = executor(); const controller = new AbortController();
    const outcome = pickNativePath({ mode: 'open-file' }, { platform: 'darwin', spawn: fake.spawn, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    controller.abort(); expect((await outcome).code).toBe('PICKER_ABORTED');
    expect(fake.calls).toHaveLength(1); expect(fake.calls[0].child.signalCode).toBe('SIGTERM');
  });

  it('reports launcher failure and allows a later request rather than leaving a busy lock', async () => {
    await expect(pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: () => { throw new Error('unavailable'); } })).rejects.toMatchObject({ code: 'PICKER_UNAVAILABLE' });
    const fake = executor(child => child.respond({ cancelled: true, paths: [] }));
    expect(await pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: fake.spawn })).toEqual({ cancelled: true, paths: [] });
  });

  it.skipIf(process.platform !== 'win32')('aborts an owned real helper and its child without touching unrelated processes', async () => {
    const { root } = await fixture();
    const marker = join(root, 'owned-pids.json');
    const controller = new AbortController();
    let helperPid: number | undefined;
    const helperScript = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,childPid:child.pid}));setInterval(()=>{},1000);`;
    const launch = (command: string, args: readonly string[], options: SpawnOptions) => {
      if (command.toLowerCase().endsWith('powershell.exe')) {
        const child = spawnProcess(process.execPath, ['-e', helperScript], options);
        helperPid = child.pid;
        return child;
      }
      return spawnProcess(command, args, options);
    };
    const outcome = pickNativePath({ mode: 'open-file' }, { platform: 'win32', spawn: launch, signal: controller.signal, timeoutMs: 10_000 }).catch(error => error);
    let pids!: { pid: number; childPid: number };
    await vi.waitFor(async () => { pids = JSON.parse(await readFile(marker, 'utf8')); expect(pids.pid).toBe(helperPid); }, { timeout: 5000 });
    controller.abort(); expect((await outcome).code).toBe('PICKER_ABORTED');
    await vi.waitFor(() => {
      expect(() => process.kill(pids.pid, 0)).toThrow();
      expect(() => process.kill(pids.childPid, 0)).toThrow();
    });
  });
});
