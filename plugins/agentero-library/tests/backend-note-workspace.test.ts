import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliRequest, CliRunner } from '../src/contracts/types.js';
import { LibraryService } from '../src/core/library-service.js';
import { NOTE_ASSOCIATION_KEY, readNoteAssociation } from '../src/infrastructure/note-workspace.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-note-workspace-owned-')), vault = join(root, 'Vault 中文 空格');
  cleanups.push(async () => {
    expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-note-workspace-owned-')).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['.agentero', 'papers/a', 'papers/b', 'notes'].map(path => mkdir(join(vault, path), { recursive: true })));
  await writeFile(join(vault, '.agentero/catalog.sqlite'), 'isolated mock');
  await writeFile(join(vault, 'papers/a/NOTES.md'), 'Internal original content');
  const papers = [{ id: 'stable:a', path: 'papers/a', title: 'A: Windows / macOS', authors: [], tags: [] }, { id: 'stable:b', path: 'papers/b', title: '第二篇', authors: [], tags: [] }];
  const cliRunner: CliRunner = { async run(request: CliRequest) {
    return { code: 0, stderr: '', stdout: request.args.includes('--version') ? 'agentero 0.15.2' : JSON.stringify({ ok: true, data: request.args.includes('describe') ? { id: 'paper.list' } : {} }) };
  } };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let beforeWrite: (() => Promise<void>) | undefined;
  const service = new LibraryService({ dataRoot: join(root, 'data'), cliRunner, nativeFactory: async () => ({
    async close() {},
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'paper_get') {
        const paper = papers.find(paper => paper.id === args.ref || paper.path === args.ref);
        if (!paper) throw new Error('paper missing');
        return { ...paper };
      }
      const path = name.startsWith('paper_notes') ? `${args.ref}/NOTES.md` : String(args.path);
      if (name === 'file_read' || name === 'paper_notes_get') return { content: await readFile(join(vault, path), 'utf8') };
      if (name === 'file_write' || name === 'paper_notes_write') {
        await beforeWrite?.();
        await mkdir(dirname(join(vault, path)), { recursive: true });
        const prefix = args.mode === 'append' ? await readFile(join(vault, path), 'utf8').catch(() => '') : '';
        await writeFile(join(vault, path), prefix + String(args.content));
        return { path };
      }
      if (name === 'file_move') {
        await mkdir(dirname(join(vault, String(args.to))), { recursive: true });
        await rename(join(vault, String(args.from)), join(vault, String(args.to)));
        return { updatedSources: ['notes/backlink.md'], skipped: [] };
      }
      if (name === 'file_delete') {
        expect(args.permanent).toBe(false);
        const paths = args.paths as string[];
        await mkdir(join(vault, '.agentero/trash'), { recursive: true });
        await rename(join(vault, paths[0]), join(vault, '.agentero/trash', basename(paths[0])));
        return { permanent: false, count: 1, batchId: 'owned-batch' };
      }
      return {};
    },
  }) });
  cleanups.push(() => service.close());
  const settings = await service.updateSettings({ cliPath: 'fake', vaultPath: vault }), vaultId = settings.vaultId!;
  return { root, vault, service, vaultId, calls, papers, blockWrite: (fn?: () => Promise<void>) => { beforeWrite = fn; } };
}

describe('linked Markdown note workspace', () => {
  it('creates multiple linked notes, nested empty folders and bounded paper-filtered trees without touching NOTES', async () => {
    const { service, vaultId, vault } = await fixture();
    const first = await service.createNote({ vaultId, paperPath: 'papers/a', title: '职责与边界', content: '# Notes\n' });
    expect(first).toMatchObject({ paperId: 'stable:a', paperPath: 'papers/a', paperTitle: 'A: Windows / macOS', exists: true, saved: true });
    expect(first.path).toMatch(/^notes\/论文\/A_ Windows _ macOS--[a-f0-9]{12}\/职责与边界.md$/);
    const root = dirname(first.path).replaceAll('\\', '/');
    const folder = await service.createNoteFolder({ vaultId, parentPath: root, name: '架构原则' });
    await service.createNote({ vaultId, title: '依赖规则', folderPath: folder.path, paperPath: 'papers/a' });
    await service.createNoteFolder({ vaultId, parentPath: folder.path, name: '待验证' });
    await service.createNote({ vaultId, title: 'Unrelated', paperPath: 'papers/b' });
    await service.createNote({ vaultId, title: 'Theme' });
    const tree = await service.noteTree({ vaultId, paperPath: 'papers/a' });
    expect(tree.truncated).toBe(false); expect(tree.paperFolderPath).toBe(root);
    expect(tree.items.filter(item => item.kind === 'file')).toHaveLength(2);
    expect(tree.items.find(item => item.path === root)).toMatchObject({ kind: 'directory', paperId: 'stable:a', revision: expect.stringMatching(/^folder:/) });
    expect(tree.items.find(item => item.name === '待验证')).toMatchObject({ kind: 'directory', paperId: 'stable:a' });
    const bounded = await service.noteTree({ vaultId, limit: 1 }); expect(bounded.items).toHaveLength(1); expect(bounded.truncated).toBe(true);
    expect(await readFile(join(vault, 'papers/a/NOTES.md'), 'utf8')).toBe('Internal original content');
    expect((await service.readNote({ vaultId, paperPath: 'papers/a' })).content).toBe('Internal original content');
  });

  it('preserves user frontmatter and main association during replacement, append, and explicit reassociation', async () => {
    const { service, vaultId } = await fixture();
    const userHeader = 'aliases: ["保留别名"]\r\ncustom:\r\n  keep: true\r\n_codexworkbench_note_other: preserved\r\n';
    let note = await service.createNote({ vaultId, paperPath: 'papers/a', title: 'Frontmatter', content: `---\r\n${userHeader}---\r\n# Original\r\n` });
    expect(note.content).toContain(userHeader);
    note = await service.writeNote({ vaultId, path: note.path, revision: note.revision, content: `---\r\n${userHeader}---\r\n# Edited\r\n` });
    expect(note.content).toContain(userHeader); expect(readNoteAssociation(note.content)?.paperId).toBe('stable:a');
    note = await service.writeNote({ vaultId, path: note.path, revision: note.revision, content: '\nAppend', mode: 'append' });
    expect(note.content.endsWith('\nAppend')).toBe(true); expect(note.content.match(new RegExp(`${NOTE_ASSOCIATION_KEY}:`, 'g'))).toHaveLength(1);
    note = await service.associateNote({ vaultId, path: note.path, paperPath: 'papers/b', revision: note.revision! });
    expect(note.paperId).toBe('stable:b'); expect(note.content).toContain(userHeader);
    note = await service.associateNote({ vaultId, path: note.path, paperPath: null, revision: note.revision! });
    expect(note.paperId).toBeUndefined(); expect(note.content).toContain(userHeader); expect(readNoteAssociation(note.content)).toBeUndefined();
  });

  it('resolves paper moves and changed titles by stable identity while keeping old folders', async () => {
    const { service, vaultId, papers, vault } = await fixture();
    const first = await service.createNote({ vaultId, title: 'One', paperPath: 'papers/a' });
    await rename(join(vault, 'papers/a'), join(vault, 'papers/moved'));
    papers[0].path = 'papers/moved'; papers[0].title = 'Renamed paper';
    const reopened = await service.readNote({ vaultId, path: first.path });
    expect(reopened).toMatchObject({ paperId: 'stable:a', paperPath: 'papers/moved', paperTitle: 'Renamed paper' });
    const second = await service.createNote({ vaultId, title: 'Two', paperPath: 'papers/moved' });
    expect(dirname(second.path)).toBe(dirname(first.path));
    expect((await service.noteTree({ vaultId, paperPath: 'papers/moved' })).items.filter(item => item.kind === 'file')).toHaveLength(2);
    papers.splice(0, 1);
    expect((await service.readNote({ vaultId, path: first.path })).paperId).toBe('stable:a');
  });

  it('keeps note collisions and external conflicts as recoverable drafts', async () => {
    const { service, vaultId, vault, root } = await fixture();
    const note = await service.createNote({ vaultId, title: 'Collision', content: 'First' });
    await expect(service.createNote({ vaultId, title: 'Collision', content: 'Second' })).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    expect(await readFile(join(vault, note.path), 'utf8')).toBe('First');
    await writeFile(join(vault, note.path), 'External edit');
    await expect(service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'My draft' })).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    const files = await readdir(join(root, 'data/state/drafts')), draft = files.find(name => name.endsWith('.draft.json'))!;
    expect(JSON.parse(await readFile(join(root, 'data/state/drafts', draft), 'utf8'))).toMatchObject({ path: note.path, content: 'My draft' });
  });

  it('refuses damaged reserved metadata and rejects writes with a different expected association', async () => {
    const { service, vaultId, vault } = await fixture();
    const note = await service.createNote({ vaultId, title: 'Identity', paperPath: 'papers/a', content: 'User body' });
    await expect(service.readNote({ vaultId, path: note.path, paperId: 'stable:b' })).rejects.toMatchObject({ code: 'NOTE_ASSOCIATION_INVALID' });
    await expect(service.writeNote({ vaultId, path: note.path, paperId: 'stable:b', revision: note.revision, content: 'Wrong paper draft' })).rejects.toMatchObject({ code: 'NOTE_ASSOCIATION_INVALID' });
    expect(await readFile(join(vault, note.path), 'utf8')).toBe(note.content);
    const damaged = `---\n${NOTE_ASSOCIATION_KEY}: {not-json}\n---\nUser body`;
    await writeFile(join(vault, note.path), damaged);
    await expect(service.readNote({ vaultId, path: note.path })).rejects.toMatchObject({ code: 'NOTE_ASSOCIATION_INVALID' });
    await expect(service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'Replacement' })).rejects.toMatchObject({ code: 'NOTE_ASSOCIATION_INVALID' });
    expect(await readFile(join(vault, note.path), 'utf8')).toBe(damaged);
  });

  it('delegates file and folder moves to public native operations, preserving associations and rejecting overwrite', async () => {
    const { service, vaultId, calls } = await fixture();
    const note = await service.createNote({ vaultId, title: 'One', paperPath: 'papers/a' });
    const moved = await service.renameNote({ vaultId, path: note.path, newPath: 'notes/主题/One.md', revision: note.revision! });
    expect(moved).toMatchObject({ paperId: 'stable:a', path: 'notes/主题/One.md', updatedSources: ['notes/backlink.md'] });
    const tree = await service.noteTree({ vaultId }), folder = tree.items.find(item => item.path === 'notes/主题')!;
    await expect(service.moveNoteFolder({ vaultId, path: folder.path, newPath: `${folder.path}/nested`, revision: folder.revision! })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const result = await service.moveNoteFolder({ vaultId, path: folder.path, newPath: 'notes/主题改名', revision: folder.revision! });
    expect(result).toMatchObject({ renamedFrom: 'notes/主题', updatedSources: ['notes/backlink.md'] });
    expect((await service.readNote({ vaultId, path: 'notes/主题改名/One.md' })).paperId).toBe('stable:a');
    expect(calls.filter(call => call.name === 'file_move').map(call => call.args)).toMatchObject([{ from: note.path, to: 'notes/主题/One.md' }, { from: 'notes/主题', to: 'notes/主题改名' }]);
    const target = await service.createNoteFolder({ vaultId, parentPath: 'notes', name: 'Exists' });
    await expect(service.moveNoteFolder({ vaultId, path: result.path, newPath: target.path, revision: result.revision })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
  });

  it('checks recursive folder content revisions, including assets, before trash and never deletes permanently', async () => {
    const { service, vaultId, vault, calls } = await fixture();
    const folder = await service.createNoteFolder({ vaultId, parentPath: 'notes', name: 'Owned' });
    const note = await service.createNote({ vaultId, folderPath: folder.path, title: 'One' });
    await expect(service.trashNote({ vaultId, path: folder.path, revision: folder.revision! })).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    let current = (await service.noteTree({ vaultId })).items.find(item => item.path === folder.path)!;
    await mkdir(join(vault, folder.path, 'assets')); await writeFile(join(vault, folder.path, 'assets/image.png'), 'owned bytes');
    await expect(service.trashNote({ vaultId, path: folder.path, revision: current.revision! })).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    current = (await service.noteTree({ vaultId })).items.find(item => item.path === folder.path)!;
    expect(await service.trashNote({ vaultId, path: folder.path, revision: current.revision! })).toMatchObject({ trashed: true, path: folder.path });
    expect(await readFile(join(vault, '.agentero/trash/Owned/One.md'), 'utf8')).toBe(note.content);
    expect(calls.filter(call => call.name === 'file_delete')).toMatchObject([{ name: 'file_delete', args: { paths: [folder.path], permanent: false } }]);
    expect(await readFile(join(vault, 'papers/a/NOTES.md'), 'utf8')).toBe('Internal original content');
  });

  it('rejects arbitrary paths, reserved Windows names, symlink aliases and folder links before mutation', async () => {
    const { service, vaultId, vault, calls, root } = await fixture();
    for (const folderPath of ['papers/a', 'notes/../papers/a', 'notes/a:stream', 'notes/CON', 'notes/trailing.']) await expect(service.createNote({ vaultId, title: 'x', folderPath })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    for (const title of ['../escape', 'NUL.md', 'bad/name', 'bad\\name']) await expect(service.createNote({ vaultId, title })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    for (const path of ['notes', 'papers/a/NOTES.md', '.agentero/catalog.sqlite']) await expect(service.trashNote({ vaultId, path, revision: 'x' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await mkdir(join(root, 'Outside')); await symlink(join(root, 'Outside'), join(vault, 'notes/outside'), 'junction');
    await symlink(join(vault, 'papers/a'), join(vault, 'notes/paper-alias'), 'junction');
    await expect(service.createNote({ vaultId, title: 'outside', folderPath: 'notes/outside' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.createNote({ vaultId, title: 'internal', folderPath: 'notes/paper-alias' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const folder = await service.createNoteFolder({ vaultId, parentPath: 'notes', name: 'HasLink' });
    await symlink(join(vault, 'papers/a'), join(vault, folder.path, 'link'), 'junction');
    await expect(service.trashNote({ vaultId, path: folder.path, revision: folder.revision! })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect((await service.noteTree({ vaultId })).truncated).toBe(true);
    expect(calls.some(call => ['file_delete', 'file_move', 'file_write'].includes(call.name))).toBe(false);
    expect(await readdir(join(root, 'Outside'))).toEqual([]);
  });

  it('serializes folder mutations behind pending saves and rejects the stale folder revision', async () => {
    const { service, vaultId, blockWrite, calls } = await fixture();
    const folder = await service.createNoteFolder({ vaultId, parentPath: 'notes', name: 'Serial' });
    const note = await service.createNote({ vaultId, title: 'One', folderPath: folder.path });
    const before = (await service.noteTree({ vaultId })).items.find(item => item.path === folder.path)!;
    let release!: () => void, started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }), writing = new Promise<void>(resolve => { started = resolve; });
    blockWrite(async () => { started(); await blocked; });
    const save = service.writeNote({ vaultId, path: note.path, revision: note.revision, content: 'Changed during pending move' });
    await writing;
    const move = service.moveNoteFolder({ vaultId, path: folder.path, newPath: 'notes/Moved', revision: before.revision! });
    release(); await save;
    await expect(move).rejects.toMatchObject({ code: 'NOTE_CONFLICT' });
    expect(calls.some(call => call.name === 'file_move')).toBe(false);
  });
});
