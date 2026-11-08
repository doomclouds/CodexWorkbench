import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { LibraryError } from '../contracts/errors.js';

export function expandHome(value: string): string {
  const text = value.trim();
  if (text === '~') return homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2));
  return text;
}

export function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function relativePath(value: string): string {
  const path = value.replaceAll('\\', '/').trim();
  if (!path || isAbsolute(path) || /^[a-z]:/i.test(path) || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new LibraryError('INVALID_PATH', '请使用知识库内的相对路径。');
  }
  return path;
}

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function containedPath(root: string, rel: string, allowMissing = false): Promise<string> {
  const canonicalRoot = await realpath(root);
  let target = resolve(canonicalRoot, relativePath(rel));
  if (!within(canonicalRoot, target)) throw new LibraryError('INVALID_PATH', '路径超出当前知识库。');
  const missing: string[] = [];
  while (true) {
    let info;
    try { info = await lstat(target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !allowMissing || target === canonicalRoot) throw error;
      missing.unshift(basename(target));
      target = dirname(target);
      continue;
    }
    let actual: string;
    try { actual = await realpath(target); } catch {
      throw new LibraryError('INVALID_PATH', '无法解析文件路径或符号链接。');
    }
    if (!within(canonicalRoot, actual)) throw new LibraryError('INVALID_PATH', '符号链接指向知识库以外。');
    if (missing.length && !info.isDirectory()) throw new LibraryError('INVALID_PATH', '上级路径不是目录。');
    return join(actual, ...missing);
  }
}

export function contentRevision(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new LibraryError('CONFIG_INVALID', '插件配置无法读取，请检查 config.json。');
  }
}
