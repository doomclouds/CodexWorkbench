import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { LibraryError } from '../contracts/errors.js';

export function externalPdfCommand(path: string, platform: NodeJS.Platform = process.platform) {
  if (!(platform === 'win32' ? win32.isAbsolute(path) : posix.isAbsolute(path)) || path.includes('\0')) throw new LibraryError('INVALID_PATH', '系统打开操作需要本地文件或目录的绝对路径。');
  if (platform === 'win32') {
    // ShellExecute reports association/launch errors, unlike spawning Explorer.
    // Keep the path in environment data: never interpolate it into PowerShell.
    const script = 'try { Start-Process -FilePath $env:CODEXWORKBENCH_OPEN_PATH -ErrorAction Stop; exit 0 } catch { exit 1 }';
    return { command: win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [path] };
  throw new LibraryError('PLATFORM_UNSUPPORTED', '当前平台没有已配置的系统打开方式。');
}

type SpawnExternal = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
/** Launcher exit 0 acknowledges dispatch; it still does not prove a window appeared. */
export async function requestExternalPdfOpen(path: string, options: { platform?: NodeJS.Platform; spawn?: SpawnExternal; timeoutMs?: number } = {}): Promise<void> {
  const launch = externalPdfCommand(path, options.platform);
  await new Promise<void>((resolve, reject) => {
    let child: ChildProcess | undefined; let settled = false;
    const fail = () => new LibraryError('EXTERNAL_OPEN_FAILED', '系统未接受打开请求，请检查默认应用或文件管理器。');
    const finish = (error?: LibraryError) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(); };
    const timer = setTimeout(() => { finish(new LibraryError('EXTERNAL_OPEN_FAILED', '系统打开请求超时，请检查默认应用或文件管理器后重试。')); child?.kill(); }, options.timeoutMs ?? 10_000);
    try {
      child = (options.spawn ?? spawn)(launch.command, launch.args, { shell: false, windowsHide: true, stdio: 'ignore', env: { ...process.env, CODEXWORKBENCH_OPEN_PATH: path } });
      child.once('error', () => finish(fail()));
      child.once('close', (code, signal) => finish(code === 0 && !signal ? undefined : fail()));
    } catch { finish(fail()); }
  });
}
