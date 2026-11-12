import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/app/api', () => ({ callTool: vi.fn() }));
import { buildWorkspaceTree, descendantNoteCount, movedPath, renamedPath, validEntryName, type NoteTreeItem } from '../src/app/notes/workspace-model';
import { FolderPicker, NewNoteDialog } from '../src/app/notes/NoteDialogs';

const association = { paperId: 'paper-id', paperPath: 'papers/architecture', paperTitle: '架构整洁之道' };
const entries: NoteTreeItem[] = [
  { path: 'notes/论文', parentPath: 'notes', name: '论文', kind: 'directory', revision: 'd0' },
  { path: 'notes/论文/architecture--abc', parentPath: 'notes/论文', name: 'architecture--abc', kind: 'directory', revision: 'd1', ...association },
  { path: 'notes/论文/architecture--abc/架构原则', parentPath: 'notes/论文/architecture--abc', name: '架构原则', kind: 'directory', revision: 'd2', ...association },
  { path: 'notes/论文/architecture--abc/架构原则/职责与边界.md', parentPath: 'notes/论文/architecture--abc/架构原则', name: '职责与边界.md', kind: 'file', revision: 'n1', ...association },
  { path: 'notes/论文/architecture--abc/依赖规则.md', parentPath: 'notes/论文/architecture--abc', name: '依赖规则.md', kind: 'file', revision: 'n2', ...association },
  { path: 'notes/主题', parentPath: 'notes', name: '主题', kind: 'directory', revision: 'd3' },
  { path: 'notes/主题/软件设计', parentPath: 'notes/主题', name: '软件设计', kind: 'directory', revision: 'd4' },
  { path: 'notes/主题/软件设计/比较笔记.md', parentPath: 'notes/主题/软件设计', name: '比较笔记.md', kind: 'file', revision: 'n3' },
];

describe('paper-linked note tree', () => {
  it('groups by association and preserves expandable nested folders without a fixed overview note', () => {
    const [papers, themes] = buildWorkspaceTree(entries);
    expect(papers.name).toBe('论文笔记'); expect(papers.count).toBe(2);
    const paper = papers.children[0]; expect(paper.name).toBe('架构整洁之道');
    expect(paper.path).toBe('notes/论文/architecture--abc');
    expect(paper.children.map(node => node.name)).toEqual(['架构原则', '依赖规则']);
    expect(paper.children[0].children[0].path).toBe(entries[3].path);
    expect(themes.children[0].name).toBe('软件设计'); expect(themes.count).toBe(1);
    expect(JSON.stringify([papers, themes])).not.toContain('论文概览');
  });
  it('retains ancestors when a note matches the filter and uses metadata after a paper title change', () => {
    const nodes = buildWorkspaceTree(entries.map(entry => entry.paperId ? { ...entry, paperTitle: '新标题' } : entry), '职责');
    expect(nodes).toHaveLength(1); expect(nodes[0].children[0].name).toBe('新标题');
    expect(nodes[0].children[0].children[0].name).toBe('架构原则');
    expect(descendantNoteCount(entries, 'notes/论文/architecture--abc')).toBe(2);
  });
  it('does not infer a paper association from a directory name', () => {
    const tree = buildWorkspaceTree([{ path: 'notes/论文/unknown/read.md', parentPath: 'notes/论文/unknown', name: 'read.md', kind: 'file' }]);
    expect(tree[0].children).toEqual([]); expect(tree[1].count).toBe(1);
  });
});

describe('note organization dialogs', () => {
  it('chooses a title, paper and folder instead of requiring a path', () => {
    const html = renderToStaticMarkup(<NewNoteDialog vaultId="test" items={entries} folderPath={entries[2].path} paperPath={association.paperPath} paperTitle={association.paperTitle} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(html).toContain('笔记名称'); expect(html).toContain('所属论文'); expect(html).toContain('目标文件夹');
    expect(html).toContain('aria-label="目标文件夹"'); expect(html).not.toContain('笔记路径'); expect(html).not.toContain('新路径');
    expect(html).toContain('架构原则'); expect(html).toContain('架构整洁之道');
  });
  it('excludes a moving folder and every descendant from destination choices', () => {
    const html = renderToStaticMarkup(<FolderPicker items={entries} value="notes" exclude={entries[1].path} onChange={vi.fn()} />);
    expect(html).not.toContain('架构整洁之道'); expect(html).not.toContain('架构原则'); expect(html).toContain('软件设计');
  });
  it('validates ordinary names and prevents moving a folder into itself', () => {
    expect(renamedPath('notes/topic/old.md', '新名称.md', 'file')).toBe('notes/topic/新名称.md');
    expect(movedPath('notes/topic', 'notes/topic/sub')).toBeNull();
    expect(movedPath('notes/topic/read.md', 'notes/other')).toBe('notes/other/read.md');
    for (const name of ['../bad', 'bad/name', 'CON', 'lpt1.md', 'bad.', '']) expect(validEntryName(name)).toBeNull();
  });
});
