import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MarkdownChange, PaperMarkdownDocument, PaperMarkdownHistory, PaperMarkdownHistoryEntry, PaperMarkdownHistoryInput, PaperMarkdownWriteResult, ReadPaperMarkdownInput, WritePaperMarkdownInput } from '../contracts/documents.js';
import { LibraryError } from '../contracts/errors.js';
import { atomicJson, containedPath, contentRevision, relativePath } from './files.js';

export const PAPER_MARKDOWN_MAX_BYTES = 2 * 1024 * 1024;
export const PAPER_HISTORY_LIMIT = 100;
const WINDOW_LIMIT = 20_000;
interface Recovery extends PaperMarkdownHistoryEntry { vaultId: string; paperPath: string; purpose: 'write' | 'before-parse' }
interface Snapshot { content: string; revision: string | null; exists: boolean }
interface RecoveryLocation { directory: string; entry: Recovery }

export function markdownPrefix(content: string): string {
  return /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content)?.[0] ?? '';
}

function windowRange(offset = 0, maxChars = WINDOW_LIMIT) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > WINDOW_LIMIT) throw new LibraryError('INVALID_RANGE', '正文窗口应为 1 至 20000 字符，偏移从0开始。');
  return { offset, maxChars };
}

/** A bounded single-hunk diff; common edges are scanned once, without a quadratic LCS table. */
export function markdownChanges(before: string, proposed: string): { changes: MarkdownChange[]; changesTruncated: boolean } {
  if (before === proposed) return { changes: [], changesTruncated: false };
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < proposed.length && before[prefix] === proposed[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < proposed.length - prefix && before[before.length - 1 - suffix] === proposed[proposed.length - 1 - suffix]) suffix++;
  const removed = before.slice(prefix, before.length - suffix), added = proposed.slice(prefix, proposed.length - suffix);
  const changes: MarkdownChange[] = [];
  if (prefix) changes.push({ kind: 'equal', text: before.slice(Math.max(0, prefix - 240), prefix) });
  if (removed) changes.push({ kind: 'removed', text: removed.slice(0, 9500) });
  if (added) changes.push({ kind: 'added', text: added.slice(0, 9500) });
  if (suffix) changes.push({ kind: 'equal', text: before.slice(before.length - suffix, before.length - suffix + 240) });
  return { changes, changesTruncated: removed.length > 9500 || added.length > 9500 || prefix > 240 || suffix > 240 };
}

function relativeImageReferences(content: string): string[] {
  const references = new Map<string, string>(), result: string[] = [];
  for (const match of content.matchAll(/^[ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*(<[^>\r\n]*>|[^\s\r\n]+)/gm)) references.set(match[1].trim().toLowerCase(), match[2].replace(/^<|>$/g, ''));
  const add = (target: string) => { if (target && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) result.push(target); };
  for (let index = 0; index < content.length - 1; index++) {
    if (content[index] !== '!' || content[index + 1] !== '[' || index && content[index - 1] === '\\') continue;
    if (content[index + 2] === '[') {
      const end = content.indexOf(']]', index + 3); if (end === -1) break;
      add(content.slice(index + 3, end).split('|')[0]); index = end + 1; continue;
    }
    let end = index + 2, labelDepth = 1;
    for (; end < content.length; end++) { if (content[end] === '\\') end++; else if (content[end] === '[') labelDepth++; else if (content[end] === ']' && --labelDepth === 0) break; }
    if (content[end] !== ']') { index = end; continue; }
    const label = content.slice(index + 2, end);
    if (content[end + 1] === '(') {
      let cursor = end + 2; while (/\s/.test(content[cursor] ?? '') && cursor < content.length) cursor++;
      const start = cursor; let depth = 0;
      if (content[cursor] === '<') { const close = content.indexOf('>', cursor + 1); if (close !== -1) { add(content.slice(cursor + 1, close)); index = close; } }
      else {
        for (; cursor < content.length; cursor++) {
          if (content[cursor] === '\\') { cursor++; continue; }
          if (content[cursor] === '(') depth++;
          else if (content[cursor] === ')') { if (!depth) break; depth--; }
          else if (/\s/.test(content[cursor]) && !depth) break;
        }
        add(content.slice(start, cursor)); index = Math.max(end, cursor - 1);
      }
    } else if (content[end + 1] === '[') {
      const close = content.indexOf(']', end + 2); if (close !== -1) { add(references.get((content.slice(end + 2, close) || label).trim().toLowerCase()) ?? ''); index = close; }
    } else { add(references.get(label.trim().toLowerCase()) ?? ''); index = end; }
  }
  for (const match of content.matchAll(/<img\b[^>]*>/gi)) { const source = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]); if (source) add(source[1] ?? source[2] ?? source[3]); }
  return result.sort();
}

function proposal(current: string, input: WritePaperMarkdownInput): string {
  if (Number(input.content !== undefined) + Number(input.edits !== undefined) !== 1) throw new LibraryError('INVALID_MARKDOWN_EDIT', '请提供完整内容或一组精确替换中的一种。');
  let next = current;
  if (input.content !== undefined) {
    if (typeof input.content !== 'string') throw new LibraryError('INVALID_MARKDOWN_EDIT', '论文 Markdown 必须是文本。');
    next = input.content;
  } else {
    if (!Array.isArray(input.edits) || !input.edits.length || input.edits.length > 100) throw new LibraryError('INVALID_MARKDOWN_EDIT', '精确替换应包含1至100项。');
    for (const edit of input.edits) {
      if (typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string') throw new LibraryError('INVALID_MARKDOWN_EDIT', '每项替换必须提供非空原文和新文本。');
      const index = next.indexOf(edit.oldText);
      if (index === -1 || next.indexOf(edit.oldText, index + 1) !== -1) throw new LibraryError('MARKDOWN_EDIT_AMBIGUOUS', '替换原文必须在当前内容中恰好出现一次。');
      next = next.slice(0, index) + edit.newText + next.slice(index + edit.oldText.length);
      if (Buffer.byteLength(next) > PAPER_MARKDOWN_MAX_BYTES) throw new LibraryError('MARKDOWN_TOO_LARGE', '论文 Markdown 超过 2 MiB。');
    }
  }
  if (Buffer.byteLength(next) > PAPER_MARKDOWN_MAX_BYTES) throw new LibraryError('MARKDOWN_TOO_LARGE', '论文 Markdown 超过 2 MiB。');
  if (markdownPrefix(current) !== markdownPrefix(next)) throw new LibraryError('MARKDOWN_HEADER_PROTECTED', '论文元数据必须保持原始字节，不能随正文修订改写。');
  if (!input.allowImageReferenceChanges && JSON.stringify(relativeImageReferences(current)) !== JSON.stringify(relativeImageReferences(next))) throw new LibraryError('MARKDOWN_IMAGES_PROTECTED', '相对图片引用已变化；仅在用户明确要求时允许修改引用。');
  return next;
}

/** Only PAPER.md is addressable. Vault writes are delegated to the public native MCP operation. */
export class PaperDocuments {
  readonly path: string;
  private readonly historyRoot: string;
  constructor(dataRoot: string, private readonly vaultPath: string, private readonly vaultId: string, private readonly paperPath: string) {
    const normalized = relativePath(paperPath);
    if (!normalized.startsWith('papers/') || normalized !== paperPath) throw new LibraryError('INVALID_PATH', '论文 Markdown 必须属于 papers/ 下的论文目录。');
    this.path = `${normalized}/PAPER.md`;
    this.historyRoot = join(dataRoot, 'state', 'paper-documents');
  }

  private async snapshot(): Promise<Snapshot> {
    const path = await containedPath(this.vaultPath, this.path, true), expected = resolve(await realpath(this.vaultPath), this.path);
    const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (key(path) !== key(expected)) throw new LibraryError('INVALID_PATH', '论文正文路径不能通过符号链接指向其他文件。');
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new LibraryError('INVALID_PATH', 'PAPER.md 必须是论文目录中的普通文件。');
      const handle = await open(path, 'r');
      try {
        const before = await handle.stat();
        if (before.size > PAPER_MARKDOWN_MAX_BYTES) throw new LibraryError('MARKDOWN_TOO_LARGE', '论文 Markdown 超过 2 MiB。');
        const bytes = await handle.readFile(), after = await handle.stat();
        if (bytes.length > PAPER_MARKDOWN_MAX_BYTES) throw new LibraryError('MARKDOWN_TOO_LARGE', '论文 Markdown 超过 2 MiB。');
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new LibraryError('MARKDOWN_CONFLICT', '论文 Markdown 在读取时发生变化，请重新读取。');
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new LibraryError('MARKDOWN_ENCODING', 'PAPER.md 不是有效 UTF-8，不能安全改写。'); }
        return { content, revision: contentRevision(content), exists: true };
      } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', revision: null, exists: false }; throw error; }
  }

  private document(snapshot: Snapshot, offset = 0, maxChars = WINDOW_LIMIT): PaperMarkdownDocument {
    windowRange(offset, maxChars);
    if (offset > snapshot.content.length) throw new LibraryError('INVALID_RANGE', '正文偏移超出文档。');
    const end = Math.min(snapshot.content.length, offset + maxChars);
    return { vaultId: this.vaultId, paperPath: this.paperPath, path: this.path, exists: snapshot.exists, revision: snapshot.revision, content: snapshot.content.slice(offset, end), offset, nextOffset: end < snapshot.content.length ? end : null, totalChars: snapshot.content.length, truncated: end < snapshot.content.length };
  }

  async read(input: Pick<ReadPaperMarkdownInput, 'offset' | 'maxChars'> = {}): Promise<PaperMarkdownDocument> { windowRange(input.offset, input.maxChars); return this.document(await this.snapshot(), input.offset, input.maxChars); }

  private async recoveries(): Promise<RecoveryLocation[]> {
    const entries: RecoveryLocation[] = [];
    for (let index = 0; index < PAPER_HISTORY_LIMIT; index++) {
      const directory = join(this.historyRoot, `slot-${String(index).padStart(3, '0')}`);
      try {
        const entry = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as Recovery;
        if (entry.vaultId === this.vaultId && entry.paperPath === this.paperPath && /^[a-f\d-]{36}$/.test(entry.historyId)) entries.push({ directory, entry });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new LibraryError('MARKDOWN_HISTORY_INVALID', '修订恢复记录损坏，已保留原文件。'); }
    }
    return entries.sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt) || b.entry.historyId.localeCompare(a.entry.historyId));
  }

  private async prepare(before: Snapshot, proposed: string, purpose: Recovery['purpose']): Promise<RecoveryLocation> {
    await mkdir(this.historyRoot, { recursive: true });
    let directory: string | undefined;
    for (let index = 0; index < PAPER_HISTORY_LIMIT; index++) {
      const candidate = join(this.historyRoot, `slot-${String(index).padStart(3, '0')}`);
      try { await mkdir(candidate, { mode: 0o700 }); directory = candidate; break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    if (!directory) throw new LibraryError('MARKDOWN_HISTORY_FULL', '修订恢复记录已达100条上限，未删除旧记录；请先管理插件数据目录中的恢复记录。');
    const entry: Recovery = { historyId: randomUUID(), createdAt: new Date().toISOString(), vaultId: this.vaultId, paperPath: this.paperPath, previousRevision: before.revision!, revision: contentRevision(proposed), status: 'prepared', purpose };
    await writeFile(join(directory, 'before.md'), before.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await writeFile(join(directory, 'proposed.md'), proposed, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await atomicJson(join(directory, 'metadata.json'), entry);
    return { directory, entry };
  }

  async ensureBackup(): Promise<{ recoveryId: string | null }> {
    const current = await this.snapshot();
    return { recoveryId: current.exists ? (await this.prepare(current, current.content, 'before-parse')).entry.historyId : null };
  }

  async write(input: WritePaperMarkdownInput, write: (content: string) => Promise<unknown>, assertCurrent: () => Promise<void>): Promise<PaperMarkdownWriteResult> {
    if (typeof input.revision !== 'string' || !input.revision) throw new LibraryError('REVISION_REQUIRED', '请先读取论文 Markdown，再携带 revision 保存。');
    const current = await this.snapshot();
    if (!current.exists) throw new LibraryError('MARKDOWN_NOT_FOUND', '论文还没有 PAPER.md，不会顺带创建或解析。');
    if (current.revision !== input.revision) throw new LibraryError('MARKDOWN_CONFLICT', '论文 Markdown 已变化，请重新读取后比较。');
    const proposed = proposal(current.content, input), diff = markdownChanges(current.content, proposed);
    const result = (snapshot: Snapshot, recoveryId: string | null, saved: boolean): PaperMarkdownWriteResult => ({ ...this.document(snapshot), ...diff, saved, dryRun: input.dryRun === true, previousRevision: current.revision!, recoveryId });
    if (input.dryRun) return result({ content: proposed, exists: true, revision: contentRevision(proposed) }, null, false);
    if (proposed === current.content) return result(current, null, true);
    const recovery = await this.prepare(current, proposed, 'write');
    await assertCurrent();
    if ((await this.snapshot()).revision !== current.revision) throw new LibraryError('MARKDOWN_CONFLICT', '保存前论文 Markdown 已变化；提议稿和原文已保留。', false, { recoveryId: recovery.entry.historyId });
    try {
      await write(proposed);
      const saved = await this.snapshot();
      if (saved.revision !== recovery.entry.revision) throw new LibraryError('MARKDOWN_CONFLICT', '写入后的内容与提议稿不同，请保留草稿并比较。');
      recovery.entry.status = 'saved'; await atomicJson(join(recovery.directory, 'metadata.json'), recovery.entry);
      return result(saved, recovery.entry.historyId, true);
    } catch (error) {
      recovery.entry.status = 'unconfirmed'; await atomicJson(join(recovery.directory, 'metadata.json'), recovery.entry).catch(() => undefined);
      throw new LibraryError('MARKDOWN_WRITE_UNCONFIRMED', '保存响应或回读未确认；原文与提议稿已保留，请先回读，不要自动重放写入。', false, { recoveryId: recovery.entry.historyId, cause: error instanceof LibraryError ? error.code : 'UPSTREAM_FAILED' });
    }
  }

  async history(input: Pick<PaperMarkdownHistoryInput, 'historyId' | 'offset' | 'maxChars'> = {}): Promise<PaperMarkdownHistory> {
    const { offset, maxChars } = windowRange(input.offset, input.maxChars), entries = await this.recoveries();
    const publicEntry = ({ historyId, createdAt, previousRevision, revision, status }: Recovery): PaperMarkdownHistoryEntry => ({ historyId, createdAt, previousRevision, revision, status });
    const result: PaperMarkdownHistory = { items: entries.map(item => publicEntry(item.entry)), truncated: false };
    if (!input.historyId) return result;
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(input.historyId)) throw new LibraryError('INVALID_PATH', '恢复记录引用无效。');
    const selected = entries.find(item => item.entry.historyId === input.historyId);
    if (!selected) throw new LibraryError('MARKDOWN_HISTORY_NOT_FOUND', '该恢复记录不属于当前论文或已不可用。');
    const before = await readFile(join(selected.directory, 'before.md'), 'utf8'), proposed = await readFile(join(selected.directory, 'proposed.md'), 'utf8');
    const totalChars = Math.max(before.length, proposed.length), end = Math.min(totalChars, offset + maxChars);
    if (offset > totalChars) throw new LibraryError('INVALID_RANGE', '恢复记录偏移超出文档。');
    result.entry = { ...publicEntry(selected.entry), before: before.slice(offset, end), proposed: proposed.slice(offset, end), offset, nextOffset: end < totalChars ? end : null, totalChars };
    return result;
  }
}
