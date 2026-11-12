import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliRunner } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { markdownChanges, PAPER_HISTORY_LIMIT } from '../src/infrastructure/paper-documents.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(content = '---\ntitle: Original\n---\n# Body\nOriginal statement.\n![figure](images/figure.png)\n') {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-paper-documents-owned-')), vault = join(root, 'Vault 中文 空格'), dataRoot = join(root, 'data');
  cleanups.push(async () => { expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-paper-documents-owned-')).toBe(true); await rm(root, { recursive: true, force: true }); });
  await Promise.all(['.agentero', 'papers/a/images', 'papers/b', 'notes'].map(path => mkdir(join(vault, path), { recursive: true })));
  await writeFile(join(vault, '.agentero/catalog.sqlite'), 'isolated mock');
  await writeFile(join(vault, 'papers/a/PAPER.md'), content);
  await writeFile(join(vault, 'papers/a/original.pdf'), 'original-pdf-bytes');
  await writeFile(join(vault, 'papers/a/images/figure.png'), 'owned-image-bytes');
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let loseResponse = false;
  const cliRunner: CliRunner = { async run(request) { return { code: 0, stderr: '', stdout: request.args.includes('--version') ? 'agentero 0.15.2' : JSON.stringify({ ok: true, data: request.args.includes('describe') ? { id: 'paper.list' } : {} }) }; } };
  const service = new LibraryService({ dataRoot, cliRunner, nativeFactory: async () => ({
    async close() {}, async call(name, args) {
      calls.push({ name, args });
      if (name === 'file_write') {
        expect(args.path).toBe('papers/a/PAPER.md'); expect(args.mode).toBe('replace');
        await writeFile(join(vault, String(args.path)), String(args.content));
        if (loseResponse) throw new Error('synthetic response lost after write');
      }
      return {};
    },
  }) });
  cleanups.push(() => service.close());
  const settings = await service.updateSettings({ cliPath: 'fake', vaultPath: vault, allowAgentPdfText: true });
  return { service, root, vault, dataRoot, paper: { vaultId: settings.vaultId!, paperPath: 'papers/a' }, calls, loseWriteResponse: () => { loseResponse = true; } };
}

describe('restricted PAPER.md revision', () => {
  it('keeps PAPER image previews inside the same canonical paper, including junctions', async context => {
    const { service, paper, vault } = await fixture();
    await mkdir(join(vault, 'notes'), { recursive: true });
    await writeFile(join(vault, 'notes/private.png'), 'outside-paper');
    await expect(service.readNoteAsset({ vaultId: paper.vaultId, notePath: 'papers/a/PAPER.md', assetPath: '../../notes/private.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const other = join(vault, 'papers/b/images'); await mkdir(other, { recursive: true }); await writeFile(join(other, 'private.png'), 'outside-paper');
    try { await symlink(other, join(vault, 'papers/a/images/redirect'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return; } throw error; }
    await expect(service.readNoteAsset({ vaultId: paper.vaultId, notePath: 'papers/a/PAPER.md', assetPath: 'images/redirect/private.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('reads bounded windows and saves exact edits via public native MCP, keeping original PDF and assets', async () => {
    const { service, paper, calls, vault } = await fixture();
    const first = await service.readEditablePaperMarkdown({ ...paper, maxChars: 12 });
    expect(first).toMatchObject({ offset: 0, nextOffset: 12, truncated: true, exists: true });
    const rest = await service.readEditablePaperMarkdown({ ...paper, offset: first.nextOffset! });
    expect(rest.revision).toBe(first.revision);
    const saved = await service.writePaperMarkdown({ ...paper, revision: first.revision!, edits: [{ oldText: 'Original statement.', newText: 'Revised from selected remark.' }] });
    expect(saved).toMatchObject({ saved: true, dryRun: false, previousRevision: first.revision });
    expect(saved.content).toContain('Revised from selected remark.'); expect(saved.recoveryId).toMatch(/^[a-f\d-]{36}$/);
    expect(calls).toHaveLength(1); expect(calls[0].name).toBe('file_write');
    expect(await readFile(join(vault, 'papers/a/original.pdf'), 'utf8')).toBe('original-pdf-bytes');
    expect(await readFile(join(vault, 'papers/a/images/figure.png'), 'utf8')).toBe('owned-image-bytes');
    expect((await service.readNoteAsset({ vaultId: paper.vaultId, notePath: 'papers/a/PAPER.md', assetPath: 'images/figure.png' })).base64).toBe(Buffer.from('owned-image-bytes').toString('base64'));
    const history = await service.paperMarkdownHistory({ ...paper, historyId: saved.recoveryId!, maxChars: 15 });
    expect(history.items[0]).toMatchObject({ status: 'saved', previousRevision: first.revision, revision: saved.revision });
    expect(history.entry).toMatchObject({ before: first.content + rest.content.slice(0, 3), offset: 0, nextOffset: 15 });
    expect(history.entry!.before.length).toBeLessThanOrEqual(15); expect(history.entry!.proposed.length).toBeLessThanOrEqual(15);
  });

  it('preserves frontmatter original bytes including BOM and CRLF', async () => {
    const prefix = '\uFEFF---\r\ntitle: "Keep spacing"  \r\ncustom: [a, b]\r\n---\r\n';
    const { service, paper, vault } = await fixture(prefix + 'Original body.');
    const document = await service.readEditablePaperMarkdown(paper);
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, content: prefix.replace('custom:', 'renamed:') + 'Changed body.' })).rejects.toMatchObject({ code: 'MARKDOWN_HEADER_PROTECTED' });
    await service.writePaperMarkdown({ ...paper, revision: document.revision!, content: prefix + 'Changed body.' });
    expect((await readFile(join(vault, 'papers/a/PAPER.md'))).subarray(0, Buffer.byteLength(prefix))).toEqual(Buffer.from(prefix));
  });

  it.each(['![figure](images/figure.png)', '![figure [nested]](images/figure.png)', '![figure](<images/figure.png>)', '![figure](images/figure.png "title")', '![figure][pic]\n[pic]: images/figure.png', '<img src="images/figure.png">', '![[images/figure.png]]'])('protects relative image references: %s', async image => {
    const { service, paper, vault } = await fixture(`# Body\n${image}\n`), document = await service.readEditablePaperMarkdown(paper);
    const content = document.content.replace('images/figure.png', 'images/other.png');
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, content })).rejects.toMatchObject({ code: 'MARKDOWN_IMAGES_PROTECTED' });
    const saved = await service.writePaperMarkdown({ ...paper, revision: document.revision!, content, allowImageReferenceChanges: true });
    expect(saved.saved).toBe(true); expect(await readFile(join(vault, 'papers/a/images/figure.png'), 'utf8')).toBe('owned-image-bytes');
  });

  it('rejects stale revisions and ambiguous edits without touching the Vault', async () => {
    const { service, paper, vault, calls } = await fixture('repeat repeat');
    const document = await service.readEditablePaperMarkdown(paper);
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, edits: [{ oldText: 'repeat', newText: 'new' }] })).rejects.toMatchObject({ code: 'MARKDOWN_EDIT_AMBIGUOUS' });
    await writeFile(join(vault, 'papers/a/PAPER.md'), 'external change');
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, content: 'my draft' })).rejects.toMatchObject({ code: 'MARKDOWN_CONFLICT' });
    expect(calls).toHaveLength(0); expect(await readFile(join(vault, 'papers/a/PAPER.md'), 'utf8')).toBe('external change');
  });

  it('supports a bounded dry-run diff without writes or recovery allocation', async () => {
    const { service, paper, calls, dataRoot } = await fixture(), document = await service.readEditablePaperMarkdown(paper);
    const preview = await service.writePaperMarkdown({ ...paper, revision: document.revision!, edits: [{ oldText: 'Original statement.', newText: 'Proposed statement.' }], dryRun: true });
    expect(preview).toMatchObject({ saved: false, dryRun: true, recoveryId: null }); expect(preview.changes.some(change => change.kind === 'added')).toBe(true);
    expect(calls).toHaveLength(0); expect(await readdir(join(dataRoot, 'state')).catch(() => [])).not.toContain('paper-documents');
  });

  it('retains unique before/proposed snapshots after an unknown write result and never replays it', async () => {
    const { service, paper, calls, loseWriteResponse } = await fixture(), document = await service.readEditablePaperMarkdown(paper);
    loseWriteResponse();
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, edits: [{ oldText: 'Original statement.', newText: 'Applied despite lost response.' }] })).rejects.toMatchObject({ code: 'MARKDOWN_WRITE_UNCONFIRMED', retryable: false });
    expect(calls).toHaveLength(1);
    const history = await service.paperMarkdownHistory(paper), recoveryId = history.items[0].historyId;
    expect(history.items[0].status).toBe('unconfirmed');
    const detail = await service.paperMarkdownHistory({ ...paper, historyId: recoveryId });
    expect(detail.entry!.before).toContain('Original statement.'); expect(detail.entry!.proposed).toContain('Applied despite lost response.');
    expect((await service.readEditablePaperMarkdown(paper)).content).toContain('Applied despite lost response.');
    const backup = await service.ensurePaperMarkdownBackup(paper); expect(backup.recoveryId).not.toBe(recoveryId);
    expect((await service.paperMarkdownHistory(paper)).items).toHaveLength(2);
  });

  it('does not create missing bodies or accept arbitrary file paths or foreign histories', async () => {
    const { service, paper, calls } = await fixture();
    await expect(service.writePaperMarkdown({ ...paper, paperPath: 'notes', revision: 'x', content: 'x' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.writePaperMarkdown({ ...paper, paperPath: 'papers/a/PAPER.md', revision: 'x', content: 'x' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.writePaperMarkdown({ ...paper, paperPath: 'papers/../notes', revision: 'x', content: 'x' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.writePaperMarkdown({ ...paper, paperPath: 'papers/b', revision: 'x', content: 'x' })).rejects.toMatchObject({ code: 'MARKDOWN_NOT_FOUND' });
    const backup = await service.ensurePaperMarkdownBackup(paper);
    await expect(service.paperMarkdownHistory({ ...paper, paperPath: 'papers/b', historyId: backup.recoveryId! })).rejects.toMatchObject({ code: 'MARKDOWN_HISTORY_NOT_FOUND' });
    await expect(service.paperMarkdownHistory({ ...paper, historyId: '../metadata.json' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(calls).toHaveLength(0);
  });

  it('rejects body symlinks including redirects to another file inside the Vault', async ({ skip }) => {
    const { service, paper, vault } = await fixture();
    await rm(join(vault, 'papers/a/PAPER.md'));
    await writeFile(join(vault, 'notes/private.md'), 'never overwrite');
    try { await symlink(join(vault, 'notes/private.md'), join(vault, 'papers/a/PAPER.md')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; } throw error; }
    await expect(service.readEditablePaperMarkdown(paper)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await readFile(join(vault, 'notes/private.md'), 'utf8')).toBe('never overwrite');
  });

  it('rejects a paper directory junction pointing at another Vault directory', async ({ skip }) => {
    const { service, paper, vault, calls } = await fixture();
    await mkdir(join(vault, 'notes/redirect'));
    await writeFile(join(vault, 'notes/redirect/PAPER.md'), 'private ordinary document');
    try { await symlink(join(vault, 'notes/redirect'), join(vault, 'papers/redirect'), 'junction'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; } throw error; }
    await expect(service.writePaperMarkdown({ ...paper, paperPath: 'papers/redirect', revision: 'untrusted', content: 'overwrite' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await readFile(join(vault, 'notes/redirect/PAPER.md'), 'utf8')).toBe('private ordinary document'); expect(calls).toHaveLength(0);
  });

  it('enforces the model body permission for read/write/history while keeping the App preview available', async () => {
    const { service, paper } = await fixture(), document = await service.readEditablePaperMarkdown(paper);
    await service.updateSettings({ allowAgentPdfText: false });
    await expect(service.readEditablePaperMarkdown(paper)).rejects.toMatchObject({ code: 'TEXT_ACCESS_DISABLED' });
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, content: 'x' })).rejects.toMatchObject({ code: 'TEXT_ACCESS_DISABLED' });
    await expect(service.paperMarkdownHistory(paper)).rejects.toMatchObject({ code: 'TEXT_ACCESS_DISABLED' });
    expect((await service.readPaperMarkdown(paper)).exists).toBe(true);
    const saved = await service.writePaperMarkdownFromApp({ ...paper, revision: document.revision!, edits: [{ oldText: 'Original statement.', newText: 'Explicit manual revision.' }] });
    expect(saved.saved).toBe(true);
    expect((await service.paperMarkdownHistoryFromApp(paper)).items).toHaveLength(1);
  });

  it('refuses new writes when the bounded recovery store is full without deleting evidence', async () => {
    const { service, paper, dataRoot, calls } = await fixture(), document = await service.readEditablePaperMarkdown(paper);
    const historyRoot = join(dataRoot, 'state/paper-documents');
    for (let index = 0; index < PAPER_HISTORY_LIMIT; index++) await mkdir(join(historyRoot, `slot-${String(index).padStart(3, '0')}`), { recursive: true });
    await expect(service.writePaperMarkdown({ ...paper, revision: document.revision!, edits: [{ oldText: 'Original statement.', newText: 'My proposal.' }] })).rejects.toMatchObject({ code: 'MARKDOWN_HISTORY_FULL' });
    expect(await readdir(historyRoot)).toHaveLength(PAPER_HISTORY_LIMIT); expect(calls).toHaveLength(0);
  });

  it('keeps a replacement diff bounded for a two-MiB document', () => {
    const diff = markdownChanges('a'.repeat(2 * 1024 * 1024), 'b'.repeat(2 * 1024 * 1024));
    expect(diff.changesTruncated).toBe(true); expect(diff.changes.reduce((sum, change) => sum + change.text.length, 0)).toBeLessThanOrEqual(20_000);
  });
});
