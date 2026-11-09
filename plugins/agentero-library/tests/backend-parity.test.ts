import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, degrees } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliRequest, CliRunner } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { editBookmarks } from '../src/infrastructure/pdf-edit.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
class Cli implements CliRunner {
  calls: CliRequest[] = [];
  pdfImportResult: unknown = { papers: [], errors: [] };
  tagColor = 'blue';
  async run(request: CliRequest) {
    this.calls.push(request); const a = request.args;
    if (a.includes('--version')) return { code: 0, stdout: 'agentero 0.15.2', stderr: '' };
    let data: unknown = {};
    if (a.includes('describe')) data = { id: 'paper.list' };
    if (a.includes('list') && a.includes('paper')) data = [{ path: 'papers/a', title: 'A', authors: ['Z'], tags: [{ name: 'Color tag', color: '#123456' }] }, { path: 'papers/b', title: 'B', authors: ['A'], tags: [{ name: 'Other', color: '#abcdef' }] }];
    if (a.includes('get') && a.includes('paper')) data = { paper: { path: a.at(-1), title: 'CLI title', tags: [{ name: 'Color tag', color: this.tagColor }] } };
    if (a.includes('translate')) data = { text: `translated:${a.at(-1)}` };
    if (a.includes('export')) data = { content: '@article{isolated,title={Owned}}', count: 1 };
    if (a.includes('import') && a.includes('bib')) data = { imported: await readFile(a.at(-1)!, 'utf8') };
    if (a.includes('import') && a.includes('pdf')) data = this.pdfImportResult;
    if (a.includes('delete')) data = { batchId: 'trash-owned', count: 1 };
    return { code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '' };
  }
}
async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-parity-owned-')), vault = join(root, 'Vault 空格');
  cleanup.push(async () => { expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-parity-owned-')).toBe(true); await rm(root, { recursive: true, force: true }); });
  await Promise.all(['.agentero', 'papers/a', 'papers/b', 'notes'].map(p => mkdir(join(vault, p), { recursive: true })));
  await writeFile(join(vault, '.agentero/catalog.sqlite'), 'owned mock');
  const document = await PDFDocument.create(); document.addPage([600, 800]); document.addPage([500, 700]).setRotation(degrees(90));
  document.getPage(0).setCropBox(20, 30, 500, 700);
  await writeFile(join(vault, 'papers/a/a.pdf'), await document.save());
  const nativeCalls: { name: string; args: Record<string, unknown> }[] = [];
  const cli = new Cli(), service = new LibraryService({ dataRoot: join(root, 'data'), cliRunner: cli, nativeFactory: async () => ({
    async close() {}, async call(name, args) {
      nativeCalls.push({ name, args });
      if (name === 'paper_get') return { id: 'a', path: 'papers/a', title: 'Native title', authors: ['Author'], tags: ['Color tag'] };
      if (name === 'paper_paths') return { paths: ['papers/a/a.pdf'] };
      if (name === 'file_move') {
        await mkdir(dirname(join(vault, String(args.to))), { recursive: true });
        await rename(join(vault, String(args.from)), join(vault, String(args.to)));
        return { from: args.from, to: args.to, updatedSources: ['notes/backlink.md'], skipped: [] };
      }
      const p = name.startsWith('paper_notes') ? `${args.ref}/NOTES.md` : String(args.path);
      if (name === 'file_read' || name === 'paper_notes_get') return { content: await readFile(join(vault, p), 'utf8') };
      return {};
    },
  }) });
  cleanup.push(() => service.close());
  const { vaultId } = await service.updateSettings({ cliPath: 'fake', vaultPath: vault });
  const paper = { vaultId: vaultId!, paperPath: 'papers/a' };
  return { root, vault, cli, service, paper, nativeCalls };
}
const geometry = { page: 1, pageSize: { width: 500, height: 700 }, rects: [{ x: 10, y: 20, w: 80, h: 12 }], quote: 'Original selection' };

describe('backend DSH parity', () => {
  it('persists exact native highlight/underline geometry and rejects stale aggregate revisions', async () => {
    const { service, vault, paper } = await fixture();
    let marks = await service.listMarks(paper), stale = marks.revision;
    marks = await service.addMark({ ...paper, ...geometry, revision: marks.revision, kind: 'highlight', color: 'blue', comment: '中文批注' });
    expect(marks.items[0]).toMatchObject({ page: 1, space: 'pt', rects: geometry.rects, quote: geometry.quote, note: '中文批注', color: 'blue' });
    const raw = JSON.parse(await readFile(join(vault, 'papers/a/marks/annotations.json'), 'utf8'));
    expect(raw[0].annotation).toMatchObject({ type: 9, pageIndex: 0, strokeColor: '#7dd3fc', opacity: 0.4, segmentRects: [{ origin: { x: 10, y: 20 }, size: { width: 80, height: 12 } }] });
    await expect(service.addMark({ ...paper, ...geometry, revision: stale, kind: 'underline' })).rejects.toMatchObject({ code: 'MARK_CONFLICT' });
    marks = await service.addMark({ ...paper, ...geometry, revision: marks.revision, kind: 'underline' });
    expect(marks.items[1].kind).toBe('underline');
    const id = marks.items[0].id;
    marks = await service.updateMark({ ...paper, revision: marks.revision, id, color: 'purple', comment: '', reply: { role: 'assistant', content: 'Saved reply' } });
    expect(marks.items[0]).toMatchObject({ color: 'purple', note: '', messages: [{ content: 'Saved reply' }] });
    marks = await service.deleteMark({ ...paper, revision: marks.revision, id });
    expect(marks.items.map(m => m.kind)).toEqual(['underline']);
    await expect(service.addMark({ ...paper, ...geometry, rects: [{ x: 490, y: 10, w: 20, h: 10 }], revision: marks.revision, kind: 'highlight' })).rejects.toMatchObject({ code: 'INVALID_MARK' });
  });
  it('keeps Agentero per-id ask/translate/visual formats, replies, and safe screenshot assets across reloads', async () => {
    const { service, vault, paper } = await fixture();
    let marks = await service.listMarks(paper);
    marks = await service.addMark({ ...paper, ...geometry, revision: marks.revision, kind: 'ask', question: 'Why?' });
    expect(marks.items[0]).toMatchObject({ kind: 'ask', space: 'norm', rects: [{ x: .02, y: 20 / 700, w: .16, h: 12 / 700 }], messages: [{ role: 'user', content: 'Why?' }] });
    marks = await service.updateMark({ ...paper, revision: marks.revision, id: marks.items[0].id, reply: { role: 'assistant', content: 'Because' } });
    marks = await service.addMark({ ...paper, ...geometry, revision: marks.revision, kind: 'translate', result: '译文' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kKqkAAAAASUVORK5CYII=', 'base64');
    marks = await service.addMark({ ...paper, ...geometry, revision: marks.revision, kind: 'visual', comment: 'Region', asset: { mediaType: 'image/png', data: png.toString('base64') } });
    const visual = marks.items.find(m => m.kind === 'visual')!;
    expect(Buffer.from((await service.readMarkAsset({ ...paper, id: visual.id })).base64, 'base64')).toEqual(png);
    await expect(service.readMarkAsset({ ...paper, id: '../a' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const files = (await readdir(join(vault, 'papers/a/marks'))).filter(n => n.endsWith('.json'));
    const raws = await Promise.all(files.map(n => readFile(join(vault, 'papers/a/marks', n), 'utf8').then(JSON.parse)));
    expect(raws.find(r => r.kind === 'ask')).toMatchObject({ version: 1, status: 'open', anchor: { page: 1, trigger: 'selection' }, messages: [{ content: 'Why?' }, { content: 'Because' }] });
    expect(raws.find(r => r.kind === 'translate')).toMatchObject({ version: 1, page: 1, result: '译文', geometry: 'resolved' });
    expect(raws.find(r => r.kind === 'visual')).toMatchObject({ version: 2, page: 1, rects: [{ x: .02, y: 20 / 700, w: .16, h: 12 / 700 }], comment: 'Region', image: { path: `assets/${visual.id}.png`, mimeType: 'image/png' } });
    marks = await service.deleteMark({ ...paper, revision: marks.revision, id: visual.id });
    expect(marks.items).toHaveLength(2);
    expect(await readdir(join(vault, 'papers/a/marks/assets'))).toEqual([]);
    expect((await service.listMarks({ ...paper, query: 'Because' })).items).toHaveLength(1);
  });
  it('preserves unknown annotation fields and refuses malformed files instead of overwriting them', async () => {
    const { service, vault, paper } = await fixture(); const dir = join(vault, 'papers/a/marks'); await mkdir(dir);
    const unknown = { annotation: { type: 2, id: 'external', arbitrary: { preserve: true } } };
    await writeFile(join(dir, 'annotations.json'), JSON.stringify([unknown]));
    const list = await service.listMarks(paper);
    await service.addMark({ ...paper, ...geometry, revision: list.revision, kind: 'highlight' });
    expect(JSON.parse(await readFile(join(dir, 'annotations.json'), 'utf8'))[0]).toEqual(unknown);
    await writeFile(join(dir, 'broken.json'), '{bad');
    await expect(service.addMark({ ...paper, ...geometry, revision: (await service.listMarks(paper)).revision, kind: 'highlight' })).rejects.toMatchObject({ code: 'MARKS_INVALID' });
    expect(await readFile(join(dir, 'broken.json'), 'utf8')).toBe('{bad');
  });
  it('writes outline changes into PDF with revision checks and preserves original destinations', async () => {
    const { service, vault, paper } = await fixture(); let chunk = await service.readPdfChunk(paper);
    const result = await service.writePdfBookmarks({ ...paper, revision: chunk.revision, nodes: [{ title: '中文目录', pageIndex: 1, origin: null, children: [{ title: 'Child', pageIndex: 0, origin: null, children: [] }] }] });
    expect(result.saved).toBe(true); expect(result.revision).not.toBe(chunk.revision);
    let pdf = await PDFDocument.load(await readFile(join(vault, 'papers/a/a.pdf')));
    const outline = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict), first = outline.lookup(PDFName.of('First'), PDFDict);
    expect(first.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('中文目录');
    const dest = first.get(PDFName.of('Dest'))!.toString();
    await expect(service.writePdfBookmarks({ ...paper, revision: chunk.revision, nodes: [] })).rejects.toMatchObject({ code: 'PDF_CHANGED' });
    chunk = await service.readPdfChunk(paper);
    await service.writePdfBookmarks({ ...paper, revision: chunk.revision, nodes: [{ title: 'Renamed', origin: '0', originalTitle: '中文目录', children: [] }] });
    pdf = await PDFDocument.load(await readFile(join(vault, 'papers/a/a.pdf')));
    expect(pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict).get(PDFName.of('Dest'))!.toString()).toBe(dest);
    await service.writePdfBookmarks({ ...paper, revision: (await service.readPdfChunk(paper)).revision, nodes: [] });
    pdf = await PDFDocument.load(await readFile(join(vault, 'papers/a/a.pdf'))); expect(pdf.catalog.has(PDFName.of('Outlines'))).toBe(false);
  });
  it('exports standard PDF QuadPoints using crop offsets, Markdown and JSON without modifying the source', async () => {
    const { service, vault, paper, root } = await fixture(), source = join(vault, 'papers/a/a.pdf'), before = await readFile(source);
    const marks = await service.listMarks(paper); await service.addMark({ ...paper, ...geometry, revision: marks.revision, kind: 'highlight', comment: '注释' });
    const output = await service.exportPaper({ ...paper, format: 'pdf' }); const pdf = await PDFDocument.load(Buffer.from(output.base64!, 'base64'));
    const a = pdf.context.lookup(pdf.getPage(0).node.Annots()!.get(0), PDFDict);
    expect(a.get(PDFName.of('Subtype'))).toBe(PDFName.of('Highlight'));
    expect(a.lookup(PDFName.of('QuadPoints'), PDFArray).asArray().map(v => (v as PDFNumber).asNumber())).toEqual([30,710,110,710,30,698,110,698]);
    expect(a.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe('注释');
    expect(await readFile(source)).toEqual(before);
    expect((await service.exportPaper({ ...paper, format: 'markdown' })).content).toContain('Original selection');
    expect(JSON.parse((await service.exportPaper({ ...paper, format: 'json' })).content!).items).toHaveLength(1);
    const target = join(root, 'export.pdf'); expect((await service.exportPaper({ ...paper, format: 'pdf', filePath: target })).savedPath).toBe(target); expect((await stat(target)).size).toBeGreaterThan(0);
    await expect(service.exportPaper({ ...paper, format: 'pdf', filePath: source })).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('rejects signed PDF rewriting', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.context.register(pdf.context.obj({ FT: 'Sig', ByteRange: [0,1,2,3] }));
    await expect(editBookmarks(await pdf.save(), [])).rejects.toMatchObject({ code: 'PDF_PROTECTED' });
  });
  it('imports note images, resolves relative previews, backlinks and rename conflicts safely', async () => {
    const { service, vault, paper, nativeCalls } = await fixture();
    await writeFile(join(vault, 'notes/one.md'), '[[two]]\n[Two](two.md)'); await writeFile(join(vault, 'notes/two.md'), '[One](one.md)');
    const asset = await service.importNoteAsset({ vaultId: paper.vaultId, notePath: 'notes/one.md', base64: Buffer.from('owned image bytes').toString('base64'), fileName: '图.png', mimeType: 'image/png' });
    const read = await service.readNoteAsset({ vaultId: paper.vaultId, notePath: 'notes/one.md', assetPath: asset.markdownPath }); expect(Buffer.from(read.base64, 'base64').toString()).toBe('owned image bytes');
    await expect(service.readNoteAsset({ vaultId: paper.vaultId, notePath: 'notes/one.md', assetPath: '../../outside.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.importNoteAsset({ vaultId: paper.vaultId, notePath: 'notes/one.md', base64: 'aGVsbG8=', fileName: 'x.svg', mimeType: 'image/svg+xml' })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    const links = await service.noteLinks({ vaultId: paper.vaultId, path: 'notes/one.md' }); expect(links.outgoing).toEqual([{ path: 'notes/two.md', title: 'two' }]); expect(links.backlinks).toEqual([{ path: 'notes/two.md', title: 'two' }]);
    const note = await service.readNote({ vaultId: paper.vaultId, path: 'notes/one.md' });
    await expect(service.renameNote({ vaultId: paper.vaultId, path: note.path, newPath: 'notes/two.md', revision: note.revision! })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await expect(service.renameNote({ vaultId: paper.vaultId, path: note.path, newPath: 'notes/new.md', revision: 'wrong' })).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    const renamed = await service.renameNote({ vaultId: paper.vaultId, path: note.path, newPath: 'notes/new.md', revision: note.revision! }); expect(renamed.content).toBe(note.content); expect(renamed.renamedFrom).toBe(note.path);
    expect(nativeCalls.find(call => call.name === 'file_move')).toMatchObject({ name: 'file_move', args: { from: 'notes/one.md', to: 'notes/new.md' } });
    expect(renamed.updatedSources).toEqual(['notes/backlink.md']);
  });
  it('delegates multiple PDF paths to one CLI operation and preserves partial success/error results', async () => {
    const { service, cli, paper, root } = await fixture();
    const first = join(root, 'One 空格.pdf'), second = join(root, 'Two.pdf');
    await writeFile(first, '%PDF-owned'); await writeFile(second, 'corrupt but existing PDF');
    cli.pdfImportResult = { papers: [{ path: 'papers/one', title: 'One' }], errors: [{ path: second, message: 'invalid PDF' }] };
    const operation = await service.importPaper({ vaultId: paper.vaultId, filePaths: [first, second], noRecognize: true });
    let state = await service.getOperation(operation); while (['queued', 'running'].includes(state.status)) { await new Promise(r => setTimeout(r, 1)); state = await service.getOperation(operation); }
    expect(state).toMatchObject({ status: 'succeeded', result: { data: cli.pdfImportResult } });
    const calls = cli.calls.filter(call => call.args.includes('import') && call.args.includes('pdf'));
    expect(calls).toHaveLength(1); expect(calls[0].args.slice(calls[0].args.indexOf('--') + 1)).toEqual([first, second]);
    await expect(service.importPaper({ vaultId: paper.vaultId, filePaths: [] })).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    await expect(service.importPaper({ vaultId: paper.vaultId, filePath: first, filePaths: [second] })).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    await expect(service.importPaper({ vaultId: paper.vaultId, text: '10.1234/owned', filePaths: [first] })).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
  });
  it('keeps tag color details, sorts all four columns and delegates non-destructive catalog operations', async () => {
    const { service, cli, paper } = await fixture();
    expect((await service.listPapers({ vaultId: paper.vaultId, sortBy: 'authors' })).items.map(p => p.path)).toEqual(['papers/b', 'papers/a']);
    expect((await service.listPapers({ vaultId: paper.vaultId, sortBy: 'tags' })).items[0].tagDetails).toEqual([{ name: 'Color tag', color: '#123456' }]);
    await service.changeTag({ ...paper, op: 'add', tag: 'Test:blue' });
    await service.deletePaper(paper); expect(cli.calls.at(-1)!.args).toEqual(['--json', '--vault', expect.any(String), 'paper', 'delete', 'papers/a']); expect(cli.calls.at(-1)!.args).not.toContain('--files');
    const operation = await service.downloadPaper(paper); expect(operation.type).toBe('download');
    while (['queued','running'].includes((await service.getOperation(operation)).status)) await new Promise(r => setTimeout(r, 1));
  });
  it('preserves current tag colors when refreshing single-paper native metadata without a library scan', async () => {
    const { service, cli, paper } = await fixture();
    // A previously loaded list has an older color. Detail refresh must use the
    // current single-paper CLI record while retaining native metadata fields.
    await service.listPapers({ vaultId: paper.vaultId });
    const countBefore = cli.calls.filter(call => call.args.includes('list')).length;
    let detail = await service.getPaper(paper);
    expect(detail).toMatchObject({ title: 'Native title', tags: ['Color tag'], tagDetails: [{ name: 'Color tag', color: 'blue' }], hasPdf: true });
    cli.tagColor = 'green';
    detail = await service.getPaper(paper);
    expect(detail.tagDetails).toEqual([{ name: 'Color tag', color: 'green' }]);
    expect(cli.calls.filter(call => call.args.includes('list'))).toHaveLength(countBefore);
    expect(cli.calls.filter(call => call.args.includes('get'))).toHaveLength(2);
  });
  it('chunks CLI translations below upstream 5000 character cap and imports/exports BibTeX through CLI', async () => {
    const { service, cli, paper, root } = await fixture();
    const result = await service.translateText({ vaultId: paper.vaultId, text: 'x'.repeat(9000), provider: 'google' }); expect(result.text.match(/translated:/g)).toHaveLength(3);
    expect(cli.calls.filter(c => c.args.includes('translate')).every(c => c.args.at(-1)!.length <= 4000)).toBe(true);
    await expect(service.translateText({ vaultId: paper.vaultId, text: 'secret', provider: 'unknown' })).rejects.toMatchObject({ code: 'INVALID_TRANSLATION' });
    const operation = await service.importBibliography({ vaultId: paper.vaultId, text: '@article{test}' });
    let status = await service.getOperation(operation); while (['queued','running'].includes(status.status)) { await new Promise(r => setTimeout(r, 1)); status = await service.getOperation(operation); }
    expect(status).toMatchObject({ status: 'succeeded', result: { imported: '@article{test}' } });
    const exported = await service.exportBibliography({ vaultId: paper.vaultId, filePath: join(root, 'saved.bib') }); expect(exported.content).toContain('@article'); expect(await readFile(join(root, 'saved.bib'), 'utf8')).toBe(exported.content);
  });
  it('persists reader state independently and reads bounded native layout without requiring model body access', async () => {
    const { service, vault, paper } = await fixture();
    expect(await service.readReaderState(paper)).toEqual({ state: {} });
    await service.writeReaderState({ ...paper, state: { pageNumber: 2, zoom: 1.5, rotation: 90, tone: 'dark' } }); expect(await service.readReaderState(paper)).toEqual({ state: { pageNumber: 2, zoom: 1.5, rotation: 90, tone: 'dark' } });
    await expect(service.writeReaderState({ ...paper, state: { rotation: 77 } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await service.readLayout(paper)).toEqual({ regions: [] });
    expect(await service.readPaperMarkdown(paper)).toMatchObject({ exists: false, content: '' });
    await writeFile(join(vault, 'papers/a/PAPER.md'), '# Actual paper body');
    expect(await service.readPaperMarkdown(paper)).toMatchObject({ exists: true, path: 'papers/a/PAPER.md', content: '# Actual paper body' });
    await expect(service.readPaper({ ...paper, source: 'markdown' })).rejects.toMatchObject({ code: 'TEXT_ACCESS_DISABLED' });
    await mkdir(join(vault, 'papers/a/source')); await writeFile(join(vault, 'papers/a/source/layout.json'), JSON.stringify({ schemaVersion: 3, regions: [{ id: 'r', pageIndex: 0, kind: 'figure' }] }));
    expect(await service.readLayout(paper)).toMatchObject({ schemaVersion: 3, regions: [{ id: 'r' }] });
  });
});
