import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

const assetFileLimit = 20 * 1024 * 1024;
const windows = platform() === 'win32';
const readFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const reservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:[ .]|$)/iu;

function samePath(left: string, right: string): boolean {
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isLocalAbsolutePath(path: string): boolean {
  return (
    isAbsolute(path) &&
    !path.startsWith('\\\\') &&
    !path.startsWith('//') &&
    (!windows || (/^[a-z]:[/\\]/iu.test(path) && !path.slice(2).includes(':')))
  );
}

function sameFileVersion(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function readLocalFile(path: string, maximumBytes: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!isLocalAbsolutePath(path)) {
    throw new TypeError('请提供本机文件的绝对路径。');
  }

  const before = await lstat(path);
  const canonical = await realpath(path);
  if (before.isSymbolicLink() || !samePath(canonical, resolve(path))) {
    throw new TypeError('请选择文件的真实路径，不能通过符号链接导入。');
  }
  if (!before.isFile()) {
    throw new TypeError('请选择本机常规文件。');
  }
  if (before.size < 1 || before.size > maximumBytes) {
    throw new TypeError('文件大小不符合当前导入要求。');
  }

  signal.throwIfAborted();
  const file = await open(canonical, readFlags);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !sameFileVersion(stat, before)) {
      throw new Error('文件在读取前发生变化，请重新导入。');
    }

    const bytes = new Uint8Array(stat.size + 1);
    let position = 0;
    while (position < bytes.length) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(bytes, position, bytes.length - position, position);
      if (!bytesRead) {
        break;
      }

      position += bytesRead;
    }
    signal.throwIfAborted();
    const after = await file.stat();
    if (position !== stat.size || !sameFileVersion(after, stat)) {
      throw new Error('文件在读取时发生变化，请重新导入。');
    }

    return bytes.subarray(0, position);
  } finally {
    await file.close();
  }
}

export function createMcpFileAccess(dataRoot: string, archiveFileLimit: number) {
  return {
    readArchiveFile(path: string, signal: AbortSignal) {
      if (extname(path).toLowerCase() !== '.zip') {
        throw new TypeError('请选择 Studio ZIP 归档。');
      }

      return readLocalFile(path, archiveFileLimit, signal);
    },
    readAssetFile(path: string, signal: AbortSignal) {
      return readLocalFile(path, assetFileLimit, signal);
    },
    async writeExportFile(name: string, bytes: Uint8Array, signal: AbortSignal) {
      signal.throwIfAborted();
      const validBasename = Boolean(name.trim()) && basename(name) === name;
      const unsafeName = /[\p{Cc}<>:"/\\|?*]|[. ]$/u.test(name) || reservedName.test(name);
      if (!validBasename || unsafeName) {
        throw new TypeError('导出文件名称无效。');
      }

      const root = await realpath(dataRoot);
      const folder = join(root, 'exports');
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const exportsRoot = await realpath(folder);
      if (!samePath(exportsRoot, folder)) {
        throw new Error('导出目录不在 Studio 数据根内。');
      }

      signal.throwIfAborted();
      const directory = await mkdtemp(join(exportsRoot, 'board-'));
      const actualDirectory = await realpath(directory);
      if (
        !samePath(actualDirectory, directory) ||
        !samePath(dirname(actualDirectory), exportsRoot)
      ) {
        throw new Error('导出目录不在 Studio 数据根内。');
      }

      const path = join(actualDirectory, name);
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx', signal });

      return path;
    },
  };
}
