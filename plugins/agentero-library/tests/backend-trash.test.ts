import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryError } from '../src/contracts/errors.js';
import { LibraryService } from '../src/core/library-service.js';
import type { TrashOpenInput } from '../src/contracts/trash.js';
import { diagnosticPdf } from '../src/infrastructure/pdf-probe.js';
import { TRASH_REL } from '../src/infrastructure/trash-reader.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function temporary() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-trash-owned-'));
  cleanup.push(async () => { expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-trash-owned-')).toBe(true); await rm(root, { recursive: true, force: true }); });
  return root;
}
async function fixture(options: { snapshotTtlMs?: number; externalPdfOpener?: (path: string) => Promise<void> } = {}) {
  const root = await temporary(), vault = join(root, 'Vault 中文'), opened: string[] = [];
  for (const part of ['.agentero', 'papers', 'notes']) await mkdir(join(vault, part), { recursive: true });
  await writeFile(join(vault, '.agentero/catalog.sqlite'), 'owned mock catalog');
  const service = new LibraryService({ dataRoot: join(root, 'data'), cliRunner: { run: async () => { throw new Error('Trash reads must not invoke a CLI or catalog'); } }, externalPdfOpener: async path => { opened.push(path); }, ...options });
  cleanup.push(() => service.close());
  const settings = await service.updateSettings({ vaultPath: vault });
  return { root, vault, opened, service, vaultId: settings.vaultId! };
}
async function batch(vault: string, batchId: string, entries: { rel: string; stored: string; catalogRows?: unknown[]; phase?: string }[]) {
  const path = join(vault, TRASH_REL, batchId); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ batchId, createdAt: '2026-11-11T01:02:03.000Z', items: entries }));
  return path;
}
async function paperBatch(vault: string, batchId: string, title = 'Deleted paper') {
  const path = await batch(vault, batchId, [{ rel: 'papers/deleted-paper', stored: '0__deleted-paper', phase: 'trashed', catalogRows: [{ path: 'papers/deleted-paper', title, abstract_text: 'PRIVATE_CATALOG_BODY', authors: ['Private author'], arbitrary: { mustNotLeak: true } }] }]);
  await mkdir(join(path, '0__deleted-paper')); await writeFile(join(path, '0__deleted-paper/deleted-paper.pdf'), diagnosticPdf());
  return path;
}

describe('read-only Agentero v0.15.2 trash', () => {
  it('lists bounded metadata and stable stored IDs without catalog rows, text, or implicit writes', async () => {
    const { service, vault, vaultId, opened } = await fixture();
    const empty = await service.listTrash({ vaultId }); expect(empty.items).toEqual([]); expect(empty.restoreSupported).toBe(false);
    await expect(stat(join(vault, TRASH_REL))).rejects.toMatchObject({ code: 'ENOENT' });
    const path = await paperBatch(vault, '20261111T010203-123'); const before = await readFile(join(path, 'manifest.json'));
    const result = await service.listTrash({ vaultId, refresh: true });
    expect(result).toMatchObject({ total: 1, complete: true, truncated: false, restoreSupported: false, nextCursor: null, diagnostics: { scannedBatches: 1, skippedBatches: 0, skippedItems: 0 } });
    expect(result.items[0]).toMatchObject({ id: '20261111T010203-123::0__deleted-paper', batchId: '20261111T010203-123', storedId: '0__deleted-paper', title: 'Deleted paper', kind: 'paper', originalPath: 'papers/deleted-paper', deletedAt: '2026-11-11T01:02:03.000Z', itemsCount: 1, pdfAvailable: true, folderAvailable: true });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_CATALOG_BODY|Private author|catalogRows|mustNotLeak/);
    expect(await readFile(join(path, 'manifest.json'))).toEqual(before); expect(opened).toEqual([]);
  });
  it('paginates a stable bounded snapshot and rejects stale or cross-vault cursors', async () => {
    const { service, vault, vaultId } = await fixture();
    for (let i = 0; i < 3; i++) await paperBatch(vault, `batch-${i}`);
    const first = await service.listTrash({ vaultId, limit: 1 }); expect(first.total).toBe(3); expect(first.nextCursor).toBeTruthy();
    const second = await service.listTrash({ vaultId, limit: 1, cursor: first.nextCursor! }); expect(second.items[0].id).not.toBe(first.items[0].id);
    await service.listTrash({ vaultId, refresh: true });
    await expect(service.listTrash({ vaultId, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
    await expect(service.listTrash({ vaultId: 'other', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'VAULT_CHANGED' });
    await expect(service.listTrash({ vaultId, cursor: '!not-a-cursor' })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
  });
  it('opens only the explicitly selected deleted PDF or its registered batch folder', async () => {
    const { service, vault, vaultId, opened } = await fixture(); const path = await paperBatch(vault, 'batch-open');
    const input = { vaultId, batchId: 'batch-open', storedId: '0__deleted-paper' };
    expect(await service.openTrash({ ...input, target: 'pdf' })).toEqual({ requested: true, target: 'pdf' });
    expect(opened[0]).toBe(join(path, '0__deleted-paper/deleted-paper.pdf'));
    expect(await service.openTrash({ ...input, target: 'folder' })).toEqual({ requested: true, target: 'folder' }); expect(opened[1]).toBe(path);
    await expect(service.openTrash({ ...input, batchId: '../outside', target: 'pdf' })).rejects.toMatchObject({ code: 'INVALID_TRASH_PATH' });
    await expect(service.openTrash({ ...input, storedId: '../outside.pdf', target: 'pdf' })).rejects.toMatchObject({ code: 'INVALID_TRASH_PATH' });
    await expect(service.openTrash({ ...input, storedId: 'not-registered', target: 'folder' })).rejects.toMatchObject({ code: 'TRASH_ITEM_NOT_FOUND' });
    await expect(service.openTrash({ ...input, target: 'file' } as unknown as TrashOpenInput)).rejects.toMatchObject({ code: 'INVALID_TRASH_PATH' }); expect(opened).toHaveLength(2);
  });
  it('opens registered Markdown and directory sources, never an executable disguised by the original name', async () => {
    const { service, vault, vaultId, opened } = await fixture();
    const path = await batch(vault, 'batch-sources', [{ rel: 'notes/中文 & reading.md', stored: '0__中文 & reading.md' }, { rel: 'notes/Chapter', stored: '1__Chapter' }, { rel: 'notes/looks-like-note.md', stored: '2__program.exe' }]);
    await writeFile(join(path, '0__中文 & reading.md'), '# synthetic note'); await mkdir(join(path, '1__Chapter')); await writeFile(join(path, '2__program.exe'), 'owned fake executable');
    const before = await readFile(join(path, 'manifest.json'));
    const list = await service.listTrash({ vaultId });
    expect(list.items.find(item => item.storedId === '0__中文 & reading.md')).toMatchObject({ kind: 'note', sourceAvailable: true, pdfAvailable: false });
    expect(list.items.find(item => item.storedId === '1__Chapter')).toMatchObject({ kind: 'directory', sourceAvailable: true });
    expect(list.items.find(item => item.storedId === '2__program.exe')).toMatchObject({ sourceAvailable: false });
    const input = { vaultId, batchId: 'batch-sources', target: 'source' as const };
    expect(await service.openTrash({ ...input, storedId: '0__中文 & reading.md' })).toEqual({ requested: true, target: 'source' });
    await service.openTrash({ ...input, storedId: '1__Chapter' });
    await expect(service.openTrash({ ...input, storedId: '2__program.exe' })).rejects.toMatchObject({ code: 'INVALID_TRASH_PATH' });
    expect(opened).toEqual([join(path, '0__中文 & reading.md'), join(path, '1__Chapter')]);
    expect(await readFile(join(path, 'manifest.json'))).toEqual(before);
  });
  it('reports a rejected system launch instead of claiming the trash directory opened', async () => {
    const { service, vault, vaultId } = await fixture({ externalPdfOpener: async () => { throw new LibraryError('EXTERNAL_OPEN_FAILED', '系统未接受打开请求'); } });
    await paperBatch(vault, 'batch-open-failure');
    await expect(service.openTrash({ vaultId, batchId: 'batch-open-failure', storedId: '0__deleted-paper', target: 'folder' })).rejects.toMatchObject({ code: 'TRASH_OPEN_FAILED', message: '系统未接受打开请求' });
  });
  it('skips corrupt, oversized and excessive-item manifests with bounded diagnostics', async () => {
    const { service, vault, vaultId } = await fixture(); await paperBatch(vault, 'batch-valid');
    const invalid = await batch(vault, 'batch-invalid', []); await writeFile(join(invalid, 'manifest.json'), '{PRIVATE_INVALID_CONTENT');
    const huge = await batch(vault, 'batch-huge', []); await writeFile(join(huge, 'manifest.json'), 'X'.repeat(512 * 1024 + 1));
    await batch(vault, 'batch-many', Array.from({ length: 201 }, (_, i) => ({ rel: `notes/${i}.md`, stored: `${i}__note.md` })));
    const result = await service.listTrash({ vaultId }); expect(result.items).toHaveLength(1); expect(result.diagnostics.skippedBatches).toBe(3); expect(result.complete).toBe(false); expect(result.diagnostics.warnings.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INVALID_CONTENT');
  });
  it('rejects traversal, protected paths and symlinked stored content rather than opening an alias', async () => {
    const { service, vault, root, vaultId, opened } = await fixture(); const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'Outside.pdf'), diagnosticPdf());
    const path = await batch(vault, 'batch-malicious', [
      { rel: 'papers/outside', stored: '0__outside' },
      { rel: '../outside', stored: '1__outside' },
      { rel: '.agentero/catalog.sqlite', stored: '2__catalog' },
      { rel: 'notes/note.md', stored: '../escape.md' },
    ]);
    await symlink(outside, join(path, '0__outside'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await service.listTrash({ vaultId }); expect(result.items).toEqual([]); expect(result.diagnostics.skippedItems).toBe(4);
    await expect(service.openTrash({ vaultId, batchId: 'batch-malicious', storedId: '0__outside', target: 'folder' })).rejects.toMatchObject({ code: 'INVALID_TRASH_PATH' }); expect(opened).toEqual([]);
  });
  it('rejects a redirected trash root and does not create or modify its target', async () => {
    const { service, vault, root, vaultId, opened } = await fixture(); const outside = join(root, 'outside'); await mkdir(outside);
    await symlink(outside, join(vault, TRASH_REL), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.listTrash({ vaultId })).rejects.toMatchObject({ code: 'INVALID_TRASH_PATH' }); expect(await readdir(outside)).toEqual([]); expect(opened).toEqual([]);
  });
  it('does not pretend non-PDF files or missing payloads can be opened as a PDF', async () => {
    const { service, vault, vaultId, opened } = await fixture();
    const path = await batch(vault, 'batch-note', [{ rel: 'notes/note.md', stored: '0__note.md' }, { rel: 'papers/missing', stored: '1__missing' }, { rel: 'papers/bad.pdf', stored: '2__bad.pdf' }]);
    await writeFile(join(path, '0__note.md'), '# note'); await writeFile(join(path, '2__bad.pdf'), 'not a PDF');
    const result = await service.listTrash({ vaultId }); expect(result.items.find(item => item.kind === 'note')?.pdfAvailable).toBe(false); expect(result.diagnostics.skippedItems).toBe(1);
    await expect(service.openTrash({ vaultId, batchId: 'batch-note', storedId: '0__note.md', target: 'pdf' })).rejects.toMatchObject({ code: 'PDF_MISSING' });
    await expect(service.openTrash({ vaultId, batchId: 'batch-note', storedId: '2__bad.pdf', target: 'pdf' })).rejects.toMatchObject({ code: 'INVALID_PDF' }); expect(opened).toEqual([]);
  });
  it('bounds batch scanning and reports that a large recycle bin is only partially represented', async () => {
    const { service, vault, vaultId } = await fixture();
    await Promise.all(Array.from({ length: 205 }, (_, i) => batch(vault, `batch-${String(i).padStart(4, '0')}`, [])));
    const result = await service.listTrash({ vaultId }); expect(result.complete).toBe(false); expect(result.truncated).toBe(true); expect(result.diagnostics.scannedBatches).toBe(200);
  });
});

it.skipIf(!process.env.AGENTERO_TRASH_TEST_CLI)('reads a real v0.15.2 CLI safe-delete manifest from an owned synthetic Vault', async () => {
  const root = await temporary(), opened: string[] = [];
  const service = new LibraryService({ dataRoot: join(root, 'data'), externalPdfOpener: async path => { opened.push(path); } }); cleanup.push(() => service.close());
  await service.updateSettings({ cliPath: process.env.AGENTERO_TRASH_TEST_CLI! });
  const settings = await service.createVault({ path: join(root, 'Vault 中文') });
  const source = join(root, 'Owned Trash Fixture.pdf'); await writeFile(source, diagnosticPdf());
  const operation = await service.importPaper({ vaultId: settings.vaultId!, filePath: source, noRecognize: true });
  let state = await service.getOperation(operation);
  while (['queued', 'running'].includes(state.status)) { await new Promise(resolve => setTimeout(resolve, 20)); state = await service.getOperation(operation); }
  expect(state.status).toBe('succeeded');
  const path = String(((state.result as { data: { papers: { path: string }[] } }).data.papers)[0].path);
  await service.deletePaper({ vaultId: settings.vaultId!, paperPath: path });
  const list = await service.listTrash({ vaultId: settings.vaultId! }); expect(list.items).toHaveLength(1); expect(list.items[0]).toMatchObject({ originalPath: path, kind: 'paper', pdfAvailable: true });
  await service.openTrash({ vaultId: settings.vaultId!, batchId: list.items[0].batchId, storedId: list.items[0].storedId, target: 'pdf' }); expect(opened).toHaveLength(1);
  expect(list.restoreSupported).toBe(false);
}, 30000);
