import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { LibraryError } from '../contracts/errors.js';

export function externalPdfCommand(path: string, platform: NodeJS.Platform = process.platform) {
  if (!(platform === 'win32' ? win32.isAbsolute(path) : posix.isAbsolute(path)) || path.includes('\0')) throw new LibraryError('INVALID_PATH', '系统阅读器需要本地 PDF 的绝对路径。');
  if (platform === 'win32') return { command: win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), args: [path] };
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [path] };
  throw new LibraryError('PLATFORM_UNSUPPORTED', '当前平台没有已配置的系统 PDF 打开方式。');
}

type SpawnExternal = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
/** A successful spawn means the request was sent; it does not prove a viewer appeared. */
export async function requestExternalPdfOpen(path: string, options: { platform?: NodeJS.Platform; spawn?: SpawnExternal } = {}): Promise<void> {
  const launch = externalPdfCommand(path, options.platform);
  await new Promise<void>((resolve, reject) => {
    try {
      const child = (options.spawn ?? spawn)(launch.command, launch.args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
      child.once('error', () => reject(new LibraryError('EXTERNAL_OPEN_FAILED', '无法向系统 PDF 阅读器发送打开请求，请检查默认阅读器。')));
      child.once('spawn', () => { child.unref(); resolve(); });
    } catch { reject(new LibraryError('EXTERNAL_OPEN_FAILED', '无法向系统 PDF 阅读器发送打开请求，请检查默认阅读器。')); }
  });
}
