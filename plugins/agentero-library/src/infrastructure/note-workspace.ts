import { createHash } from 'node:crypto';
import { lstat, opendir, readFile, stat } from 'node:fs/promises';
import { LibraryError } from '../contracts/errors.js';
import type { NoteAssociation, NoteTreeEntry } from '../contracts/notes.js';
import { containedPath, contentRevision, exists, relativePath } from './files.js';

export const NOTE_ASSOCIATION_KEY = '_codexworkbench_note';
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 5000;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const forbiddenName = /[<>:"/\\|?*\u0000-\u001f]/u;
const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function noteName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120 || Buffer.byteLength(value) > 240 || value === '.' || value === '..' || forbiddenName.test(value) || /[. ]$/.test(value) || reservedName.test(value)) throw new LibraryError('INVALID_PATH', '名称必须是 Windows/macOS 安全的单个文件名（最多 120 字符、240 字节）。');
  return value;
}

export function noteWorkspacePath(value: string, rootAllowed = false): string {
  const path = relativePath(value);
  if (path === 'notes' && rootAllowed) return path;
  if (!path.startsWith('notes/')) throw new LibraryError('INVALID_PATH', '笔记和文件夹必须位于 notes/，不能操作笔记根目录。');
  for (const name of path.split('/')) noteName(name);
  return path;
}

/** Reject aliases into papers or elsewhere, including links that remain inside the Vault. */
export async function safeNotePath(root: string, value: string, allowMissing = false, rootAllowed = false): Promise<string> {
  const path = noteWorkspacePath(value, rootAllowed);
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i += 1) {
    const candidate = await containedPath(root, parts.slice(0, i).join('/'), true);
    if (!(await exists(candidate))) { if (allowMissing) break; continue; }
    // containedPath canonicalizes its result, so inspect the lexical component too.
    const lexical = `${root}/${parts.slice(0, i).join('/')}`;
    if ((await lstat(lexical)).isSymbolicLink()) throw new LibraryError('INVALID_PATH', '笔记工作区不支持符号链接目录或文件。');
  }
  return containedPath(root, path, allowMissing);
}

function frontmatter(content: string) {
  const start = /^(?:\uFEFF)?---\r?\n/.exec(content);
  if (!start) return undefined;
  const ending = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  ending.lastIndex = start[0].length;
  const end = ending.exec(content);
  if (!end) throw new LibraryError('NOTE_FRONTMATTER_INVALID', '笔记 frontmatter 缺少结束标记，未修改文件。');
  return { prefix: start[0], header: content.slice(start[0].length, end.index), suffix: content.slice(end.index), newline: start[0].includes('\r\n') ? '\r\n' : '\n' };
}

export function readNoteAssociation(content: string): NoteAssociation | undefined {
  const header = frontmatter(content)?.header;
  if (header === undefined) return undefined;
  const lines = header.split(/\r?\n/).filter(line => new RegExp(`^${NOTE_ASSOCIATION_KEY}\\s*:`).test(line));
  if (!lines.length) return undefined;
  let value: unknown;
  try { if (lines.length !== 1) throw new Error(); value = JSON.parse(lines[0].slice(lines[0].indexOf(':') + 1)); } catch { throw new LibraryError('NOTE_ASSOCIATION_INVALID', '笔记保留关联字段无效，未修改文件。'); }
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (record.schemaVersion !== 1 || typeof record.paperId !== 'string' || !record.paperId || record.paperId.length > 512 || typeof record.paperPath !== 'string' || typeof record.paperTitle !== 'string' || record.paperTitle.length > 1000) throw new LibraryError('NOTE_ASSOCIATION_INVALID', '笔记论文关联格式无效。');
  const paperPath = relativePath(record.paperPath);
  if (!paperPath.startsWith('papers/')) throw new LibraryError('NOTE_ASSOCIATION_INVALID', '笔记关联必须指向论文目录。');
  return { paperId: record.paperId, paperPath, paperTitle: record.paperTitle };
}

/** Edit only our reserved property; preserve the user's other header bytes and body. */
export function withNoteAssociation(content: string, association: NoteAssociation | null | undefined): string {
  const parsed = frontmatter(content);
  const line = association ? `${NOTE_ASSOCIATION_KEY}: ${JSON.stringify({ schemaVersion: 1, ...association })}` : '';
  if (!parsed) return line ? `---\n${line}\n---\n${content}` : content;
  const pattern = new RegExp(`^${NOTE_ASSOCIATION_KEY}[ \\t]*:[^\\r\\n]*(?:\\r?\\n|$)`, 'gm');
  const header = parsed.header.replace(pattern, '');
  return parsed.prefix + header + (line ? `${line}${parsed.newline}` : '') + parsed.suffix;
}

export function paperFolderSuffix(paperId: string): string { return createHash('sha256').update(paperId).digest('hex').slice(0, 12); }
export function defaultPaperNoteFolder(paper: NoteAssociation): string {
  let title = paper.paperTitle.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim().replace(/[. ]+$/g, '').slice(0, 70) || '论文';
  if (reservedName.test(title)) title = `_${title}`;
  return `notes/论文/${title}--${paperFolderSuffix(paper.paperId)}`;
}

export interface NoteWorkspaceScan { items: NoteTreeEntry[]; truncated: boolean }
/** Local Markdown scan, bounded independently of the result limit. No symlinks are followed. */
export async function scanNoteWorkspace(root: string): Promise<NoteWorkspaceScan> {
  const items: NoteTreeEntry[] = [];
  let truncated = false, count = 0, bytes = 0;
  const scan = async (directory: string, depth: number): Promise<void> => {
    if (depth > 16 || count >= MAX_SCAN_ENTRIES) { truncated = true; return; }
    const actual = await safeNotePath(root, directory, true, true);
    if (!(await exists(actual))) return;
    const handle = await opendir(actual);
    try {
      for await (const entry of handle) {
        count += 1;
        if (count > MAX_SCAN_ENTRIES) { truncated = true; break; }
        if (entry.isSymbolicLink()) { truncated = true; continue; }
        const path = `${directory}/${entry.name}`;
        try { noteWorkspacePath(path); } catch { truncated = true; continue; }
        if (entry.isDirectory()) { items.push({ path, parentPath: directory, name: entry.name, kind: 'directory' }); await scan(path, depth + 1); }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const file = await safeNotePath(root, path), info = await stat(file);
          if (info.size > MAX_NOTE_BYTES || bytes + info.size > MAX_SCAN_BYTES) { truncated = true; continue; }
          bytes += info.size;
          const content = await readFile(file, 'utf8');
          let association: NoteAssociation | undefined;
          try { association = readNoteAssociation(content); } catch { truncated = true; }
          items.push({ path, parentPath: directory, name: entry.name, kind: 'file', revision: contentRevision(content), ...association });
        }
      }
    } finally { await handle.close().catch(() => undefined); }
  };
  await scan('notes', 0);
  return { items: items.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })), truncated };
}

/** A recursive revision includes file bytes and names, including assets and empty directories. */
export async function noteFolderRevision(root: string, path: string): Promise<{ revision: string; noteCount: number }> {
  const hash = createHash('sha256');
  let count = 0, bytes = 0, noteCount = 0;
  const scan = async (current: string, depth: number): Promise<void> => {
    if (depth > 16 || ++count > MAX_SCAN_ENTRIES) throw new LibraryError('NOTE_FOLDER_TOO_LARGE', '文件夹超过安全操作范围，请缩小目标。');
    const actual = await safeNotePath(root, current), info = await lstat(actual);
    hash.update(JSON.stringify([current.slice(path.length), info.isDirectory() ? 'directory' : 'file', info.isFile() ? info.size : 0]));
    if (info.isDirectory()) {
      const handle = await opendir(actual), children: string[] = [];
      try {
        for await (const entry of handle) {
          if (count + children.length >= MAX_SCAN_ENTRIES) throw new LibraryError('NOTE_FOLDER_TOO_LARGE', '文件夹超过安全操作范围，请缩小目标。');
          if (entry.isSymbolicLink()) throw new LibraryError('INVALID_PATH', '文件夹包含符号链接，未执行操作。');
          children.push(entry.name);
        }
      } finally { await handle.close().catch(() => undefined); }
      for (const child of children.sort((a, b) => a.localeCompare(b))) await scan(`${current}/${child}`, depth + 1);
    }
    else if (info.isFile()) {
      bytes += info.size;
      if (info.size > MAX_SCAN_BYTES || bytes > MAX_SCAN_BYTES) throw new LibraryError('NOTE_FOLDER_TOO_LARGE', '文件夹超过 32 MiB 安全操作范围。');
      const content = await readFile(actual);
      if (content.length !== info.size) throw new LibraryError('NOTE_CONFLICT', '文件夹内容在读取期间变化，请重新读取。', true);
      hash.update(content);
      if (current.toLowerCase().endsWith('.md')) noteCount += 1;
    } else throw new LibraryError('INVALID_PATH', '文件夹包含不支持的文件类型。');
  };
  await scan(noteWorkspacePath(path), 0);
  return { revision: `folder:${hash.digest('hex')}`, noteCount };
}
