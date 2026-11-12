import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliRunner } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { CONTEXT_CACHE_BYTES, CONTEXT_TTL, ReadingContextStore, validateContextPng, type ReadingSnapshot } from '../src/infrastructure/reading-context.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const snapshotInput = (vaultPath = 'owned') => ({ vaultId: 'v', vaultPath, paperPath: 'papers/a', paperId: 'stable:a', title: 'Paper A', pages: [1], marksCount: 0, action: 'summarize' as const, imageIds: [], content: 'Frozen', images: {} });

async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-reading-context-owned-')), vault = join(root, 'Vault 中文'), dataRoot = join(root, 'data');
  cleanup.push(async () => { expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-reading-context-owned-')).toBe(true); await rm(root, { recursive: true, force: true }); });
  await Promise.all(['.agentero', 'papers/a/marks/assets', 'notes'].map(path => mkdir(join(vault, path), { recursive: true })));
  await writeFile(join(vault, '.agentero/catalog.sqlite'), 'owned mock');
  const cliRunner: CliRunner = { async run(request) { return { code: 0, stderr: '', stdout: request.args.includes('--version') ? 'agentero 0.15.2' : JSON.stringify({ ok: true, data: request.args.includes('describe') ? { id: 'paper.list' } : {} }) }; } };
  let abortDuringPaperRead: (() => void) | undefined;
  const nativeFactory = async () => ({ async close() {}, async call(name: string, args: Record<string, unknown>) {
    if (name === 'paper_get') { abortDuringPaperRead?.(); return { id: 'stable:a', path: 'papers/a', title: 'Paper A', tags: [] }; }
    if (name === 'file_read') return { content: await readFile(join(vault, String(args.path)), 'utf8') };
    throw new Error(`Unexpected native operation ${name}`);
  } });
  const service = new LibraryService({ dataRoot, cliRunner, nativeFactory }); cleanup.push(() => service.close());
  const settings = await service.updateSettings({ cliPath: 'fake', vaultPath: vault });
  const paper = { vaultId: settings.vaultId!, paperPath: 'papers/a' };
  const marks = async (count = 3, longMessage = '') => {
    const annotations = Array.from({ length: count }, (_, index) => ({ annotation: { type: 9, id: `mark-${index}`, pageIndex: index % 3, rect: { origin: { x: 1, y: 2 }, size: { width: 10, height: 5 } }, contents: `Comment ${index}`, custom: { quote: `Quote ${index}`, messages: index === 0 && longMessage ? [{ id: 'reply', role: 'assistant', content: longMessage, createdAt: '2026-11-12' }] : [] } } }));
    await writeFile(join(vault, 'papers/a/marks/annotations.json'), JSON.stringify(annotations));
    return service.listMarks(paper);
  };
  return { root, vault, dataRoot, service, paper, marks, cliRunner, nativeFactory, abortOnPaper: (fn?: () => void) => { abortDuringPaperRead = fn; } };
}

describe('frozen reading context evidence', () => {
  it('freezes authoritative paper identity, quotes/comments/roles and preserves every long reply across windows', async () => {
    const { service, paper, marks } = await fixture(), long = 'Reply 中文。'.repeat(12_000), current = await marks(3, long);
    const reference = await service.createReadingContext({ ...paper, action: 'summarize', markIds: ['mark-0', 'mark-2'], marksRevision: current.revision });
    expect(reference).toMatchObject({ paperId: 'stable:a', title: 'Paper A', pages: [1, 3], marksCount: 2, imageIds: [] });
    expect(reference).not.toHaveProperty('content'); expect(reference).not.toHaveProperty('images');
    let offset = 0, combined = '';
    while (true) {
      const result = await service.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId, offset, maxChars: 7000 });
      expect(result.content.length).toBeLessThanOrEqual(7000); expect(result.sourceChanged).toBe(false);
      combined += result.content;
      if (result.nextOffset === null) { expect(combined.length).toBe(result.totalChars); break; }
      offset = result.nextOffset;
    }
    expect(combined).toContain(long); expect(combined).toContain('Role: assistant'); expect(combined).toContain('User comment:\nComment 0'); expect(combined).toContain('workbench-paper:papers%2Fa#page=3&mark=mark-2');
    await service.updateMark({ ...paper, id: 'mark-0', revision: current.revision, comment: 'Edited after attach' });
    const frozen = await service.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId });
    expect(frozen.sourceChanged).toBe(true); expect(frozen.content).toContain('Comment 0'); expect(frozen.content).not.toContain('Edited after attach');
  });

  it('allows selected text evidence with body permission off and optional geometry without reading PDF body', async () => {
    const { service, paper, dataRoot } = await fixture();
    expect((await service.readSettings()).allowAgentPdfText).toBe(false);
    const reference = await service.createReadingContext({ ...paper, action: 'summarize', selection: { text: 'Reader selected text', parts: [{ page: 7, quote: 'Reader selected text' }] } });
    const read = await service.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId });
    expect(read).toMatchObject({ pages: [7], sourceChanged: false, marksCount: 0 }); expect(read.content).toContain('Reader selected text'); expect(read.content).not.toContain('Selection geometry');
    const stored = JSON.parse(await readFile(join(dataRoot, 'cache/reading-context', `${reference.contextId}.json`), 'utf8')) as ReadingSnapshot;
    expect(stored.content).toBe(read.content); expect(stored.vaultPath).toBeTruthy();
  });

  it('keeps a selection-only snapshot free of existing same-page marks and needs no marks revision', async () => {
    const { service, paper, marks } = await fixture();
    await marks(3);
    for (const markIds of [undefined, []]) {
      const reference = await service.createReadingContext({ ...paper, action: 'summarize', pages: [1], ...(markIds ? { markIds } : {}), selection: { text: 'Only this selected source', parts: [{ page: 1, quote: 'Only this selected source' }] } });
      expect(reference).toMatchObject({ pages: [1], marksCount: 0 });
      const result = await service.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId });
      expect(result.sourceChanged).toBe(false); expect(result.content).toContain('Only this selected source'); expect(result.content).not.toContain('Quote 0'); expect(result.content).not.toContain('Comment 0'); expect(result.content).not.toContain('## Mark');
    }
  });

  it('survives a fresh service instance, enforces Vault scope, and does not change source state', async () => {
    const { service, paper, marks, dataRoot, cliRunner, nativeFactory, root } = await fixture(), current = await marks();
    const reference = await service.createReadingContext({ ...paper, action: 'create-note', pages: [2], marksRevision: current.revision, targetFolderPath: 'notes/计划' });
    expect(reference).toMatchObject({ pages: [2], marksCount: 1, targetFolderPath: 'notes/计划' });
    await service.close();
    const second = new LibraryService({ dataRoot, cliRunner, nativeFactory }); cleanup.push(() => second.close());
    expect((await second.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId })).content).toContain('Quote 1');
    const otherVault = join(root, 'Other'); await Promise.all(['.agentero', 'papers', 'notes'].map(path => mkdir(join(otherVault, path), { recursive: true }))); await writeFile(join(otherVault, '.agentero/catalog.sqlite'), 'owned');
    const changed = await second.updateSettings({ vaultPath: otherVault });
    await expect(second.readReadingContext({ vaultId: changed.vaultId!, contextId: reference.contextId })).rejects.toMatchObject({ code: 'CONTEXT_SCOPE' });
  });

  it('reads frozen evidence from a separate Node process without the original Reader or service', async () => {
    const { service, paper, dataRoot } = await fixture();
    const reference = await service.createReadingContext({ ...paper, action: 'summarize', selection: { text: '跨进程 frozen evidence', parts: [{ page: 12, quote: 'Selected quote' }] } });
    await service.close();
    const source = fileURLToPath(new URL('../src/infrastructure/reading-context.ts', import.meta.url));
    const bundle = await build({ stdin: { contents: `import { ReadingContextStore } from ${JSON.stringify(source)}; const result = await new ReadingContextStore(process.argv[2]).read(process.argv[3]); process.stdout.write(JSON.stringify({contextId:result.contextId,content:result.content,pages:result.pages}));`, resolveDir: dirname(source) }, bundle: true, platform: 'node', format: 'esm', write: false });
    const result = await new Promise<{ contextId: string; content: string; pages: number[] }>((resolveResult, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-', dataRoot, reference.contextId], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); }); child.on('error', reject);
      child.on('close', code => { if (code !== 0) reject(new Error(stderr)); else { try { resolveResult(JSON.parse(stdout)); } catch (error) { reject(error); } } });
      child.stdin.end(bundle.outputFiles[0].text);
    });
    expect(result).toMatchObject({ contextId: reference.contextId, pages: [12] }); expect(result.content).toContain('跨进程 frozen evidence');
  });

  it('rejects stale or missing IDs, empty sources, bad geometry and unsafe note targets', async () => {
    const { service, paper, marks, vault } = await fixture(), current = await marks();
    const base = { ...paper, action: 'summarize' as const };
    await expect(service.createReadingContext(base)).rejects.toMatchObject({ code: 'CONTEXT_EMPTY' });
    await expect(service.createReadingContext({ ...base, markIds: ['missing'], marksRevision: current.revision })).rejects.toMatchObject({ code: 'MARK_NOT_FOUND' });
    await expect(service.createReadingContext({ ...base, markIds: ['mark-0'], marksRevision: 'stale' })).rejects.toMatchObject({ code: 'MARK_CONFLICT' });
    await expect(service.createReadingContext({ ...base, markIds: ['mark-0'] })).rejects.toMatchObject({ code: 'MARK_CONFLICT' });
    await expect(service.createReadingContext({ ...base, markIds: ['mark-0'], pages: [2], marksRevision: current.revision })).rejects.toMatchObject({ code: 'INVALID_CONTEXT' });
    await expect(service.createReadingContext({ ...base, selection: { text: 'x', parts: [{ page: 1, quote: 'x', pageSize: { width: 10, height: 10 }, rects: [{ x: 8, y: 1, w: 5, h: 2 }] }] } })).rejects.toMatchObject({ code: 'INVALID_CONTEXT' });
    await expect(service.createReadingContext({ ...base, markIds: ['mark-0'], marksRevision: current.revision, targetNotePath: 'papers/a/PAPER.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.createReadingContext({ ...base, action: 'update-note', markIds: ['mark-0'], marksRevision: current.revision })).rejects.toMatchObject({ code: 'INVALID_CONTEXT' });
    await expect(service.createReadingContext({ ...base, action: 'update-note', targetNotePath: 'notes/missing.md' })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await symlink(join(vault, 'papers/a'), join(vault, 'notes/alias'), 'junction');
    await expect(service.createReadingContext({ ...base, targetFolderPath: 'notes/alias' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('cancels before persistence, bounds read windows, and refuses invalid context IDs', async () => {
    const { service, paper, dataRoot, abortOnPaper } = await fixture(), controller = new AbortController();
    abortOnPaper(() => controller.abort());
    await expect(service.createReadingContext({ ...paper, action: 'summarize', selection: { text: 'x', parts: [{ page: 1, quote: 'x' }] } }, controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(await readdir(join(dataRoot, 'cache/reading-context')).catch(() => [])).toEqual([]);
    abortOnPaper();
    const reference = await service.createReadingContext({ ...paper, action: 'summarize', selection: { text: 'x', parts: [{ page: 1, quote: 'x' }] } });
    for (const args of [{ offset: -1 }, { offset: 1_000_000 }, { maxChars: 20_001 }, { maxChars: 0 }]) await expect(service.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId, ...args })).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(service.readReadingContext({ vaultId: paper.vaultId, contextId: '../escape' })).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
    await expect(service.readReadingContext({ vaultId: paper.vaultId, contextId: reference.contextId }, controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
  });

  it('freezes real visual/selection PNG bytes and rejects forged, oversized, excessive-pixel images', async () => {
    const { service, paper, marks, vault } = await fixture();
    await marks(0);
    const visual = { version: 2, id: 'visual', kind: 'visual', page: 2, rects: [{ x: 0, y: 0, w: .1, h: .1 }], comment: 'Graph', image: { path: 'assets/visual.png', mimeType: 'image/png' } };
    await writeFile(join(vault, 'papers/a/marks/visual.json'), JSON.stringify(visual)); await writeFile(join(vault, 'papers/a/marks/assets/visual.png'), Buffer.from(png, 'base64'));
    const current = await service.listMarks(paper);
    const reference = await service.createReadingContext({ ...paper, action: 'summarize', markIds: ['visual'], marksRevision: current.revision, selection: { text: '', parts: [{ page: 3, quote: '' }], asset: { mediaType: 'image/png', data: png } } });
    expect(reference.imageIds).toHaveLength(2);
    const asset = await service.readReadingContextImage({ vaultId: paper.vaultId, contextId: reference.contextId, imageId: reference.imageIds[1] });
    expect(asset).toEqual({ mediaType: 'image/png', base64: png });
    await writeFile(join(vault, 'papers/a/marks/assets/visual.png'), 'changed outside snapshot');
    expect((await service.readReadingContextImage({ vaultId: paper.vaultId, contextId: reference.contextId, imageId: reference.imageIds[1] })).base64).toBe(png);
    await expect(service.readReadingContextImage({ vaultId: paper.vaultId, contextId: reference.contextId, imageId: '../visual' })).rejects.toMatchObject({ code: 'CONTEXT_IMAGE_NOT_FOUND' });
    expect(() => validateContextPng({ mediaType: 'image/png', data: Buffer.from('not png').toString('base64') })).toThrow();
    const huge = Buffer.from(png, 'base64'); huge.writeUInt32BE(20_000, 16); huge.writeUInt32BE(20_000, 20);
    expect(() => validateContextPng({ mediaType: 'image/png', data: huge.toString('base64') })).toThrow();
    expect(() => validateContextPng({ mediaType: 'image/png', data: Buffer.alloc(4_500_001).toString('base64') })).toThrow();
  });
});

describe('revision-bound mark pagination', () => {
  it('keeps default App items complete and provides a model continuation, exact ID/page filters, and stale-cursor errors', async () => {
    const { service, paper, marks } = await fixture(); await marks(205);
    const full = await service.listMarks(paper); expect(full.items).toHaveLength(205); expect(full.total).toBe(205); expect(full.nextCursor).toBeTruthy();
    const next = await service.listMarks({ ...paper, cursor: full.nextCursor! }); expect(next.items).toHaveLength(100); expect(next.items[0].id).toBe('mark-100');
    const end = await service.listMarks({ ...paper, cursor: next.nextCursor! }); expect(end.items).toHaveLength(5); expect(end.nextCursor).toBeNull();
    const first = await service.listMarks({ ...paper, limit: 2, pages: [1] }); expect(first.items.map(mark => mark.id)).toEqual(['mark-0', 'mark-3']);
    expect((await service.listMarks({ ...paper, ids: ['mark-0', 'mark-1'], pages: [2] })).items.map(mark => mark.id)).toEqual(['mark-1']);
    await expect(service.listMarks({ ...paper, cursor: first.nextCursor!, pages: [2] })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
    await service.updateMark({ ...paper, id: 'mark-0', revision: full.revision, comment: 'Edit' });
    await expect(service.listMarks({ ...paper, cursor: full.nextCursor! })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
    await expect(service.listMarks({ ...paper, limit: 501 })).rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });
});

describe('reading source cache bounds', () => {
  it('accounts for new serialized snapshot bytes, rejects excessive sources, and keeps existing cache entries', async () => {
    const { dataRoot } = await fixture(), store = new ReadingContextStore(dataRoot);
    await expect(store.create({ ...snapshotInput(), content: 'x'.repeat(8 * 1024 * 1024) })).rejects.toMatchObject({ code: 'CONTEXT_TOO_LARGE' });
    const directory = join(dataRoot, 'cache/reading-context'); await mkdir(directory, { recursive: true });
    for (let index = 0; index < 8; index += 1) { const handle = await open(join(directory, `${randomUUID()}.json`), 'wx'); await handle.truncate(CONTEXT_CACHE_BYTES / 8); await handle.close(); }
    await expect(store.create(snapshotInput())).rejects.toMatchObject({ code: 'CONTEXT_CACHE_FULL' });
    expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toHaveLength(8);
  });

  it('shares count limits across independent writers, expires snapshots, and rejects cache symlinks', async () => {
    const { dataRoot, root } = await fixture(), directory = join(dataRoot, 'cache/reading-context'); await mkdir(directory, { recursive: true });
    for (let index = 0; index < 199; index += 1) await writeFile(join(directory, `${randomUUID()}.json`), '{}');
    const first = new ReadingContextStore(dataRoot), second = new ReadingContextStore(dataRoot);
    const results = await Promise.allSettled([first.create(snapshotInput()), second.create(snapshotInput())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const created = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<ReadingSnapshot>, path = join(directory, `${created.value.contextId}.json`);
    await writeFile(path, JSON.stringify({ ...created.value, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(first.read(created.value.contextId)).rejects.toMatchObject({ code: 'CONTEXT_EXPIRED' });
    const expired = new Date(Date.now() - CONTEXT_TTL - 1000); for (const name of await readdir(directory)) await utimes(join(directory, name), expired, expired);
    expect((await first.create(snapshotInput())).content).toBe('Frozen'); expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toHaveLength(1);
    const id = randomUUID(); await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(directory, `${id}.json`), 'junction');
    await expect(first.read(id)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});
