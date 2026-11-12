import type { NoteTree } from '../../contracts/notes';

export type NoteTreeItem = NoteTree['items'][number];
export interface WorkspaceNode {
  key: string;
  path?: string;
  name: string;
  kind: 'group' | 'directory' | 'file';
  paperPath?: string;
  revision?: string;
  children: WorkspaceNode[];
  count: number;
}

export function noteTitle(path: string): string { return path.split('/').at(-1)!.replace(/\.md$/i, ''); }
export function parentFolder(path: string): string { return path.split('/').slice(0, -1).join('/') || 'notes'; }
export function validEntryName(value: string): string | null {
  const name = value.trim();
  return !name || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^\.{1,2}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? null : name;
}
export function renamedPath(path: string, name: string, kind: 'file' | 'directory'): string | null {
  const valid = validEntryName(kind === 'file' ? name.replace(/\.md$/i, '') : name);
  return valid ? `${parentFolder(path)}/${valid}${kind === 'file' ? '.md' : ''}` : null;
}
export function movedPath(path: string, folder: string): string | null {
  if (folder !== 'notes' && !folder.startsWith('notes/')) return null;
  if (folder === path || folder.startsWith(`${path}/`)) return null;
  const next = `${folder}/${path.split('/').at(-1)}`;
  return next === path ? null : next;
}

function addPath(root: WorkspaceNode, item: NoteTreeItem, base: string, items: Map<string, NoteTreeItem>) {
  const relative = item.path.slice(base.length).replace(/^\//, '');
  if (!relative) return;
  let node = root; let path = base;
  for (const [index, name] of relative.split('/').entries()) {
    path += `/${name}`;
    const leaf = index === relative.split('/').length - 1;
    let next = node.children.find(child => child.path === path);
    if (!next) {
      const source = items.get(path);
      next = { key: `${root.key}:${path}`, path, name: leaf && item.kind === 'file' ? noteTitle(name) : name, kind: leaf ? item.kind : 'directory', paperPath: source?.paperPath, revision: source?.revision ?? undefined, children: [], count: 0 };
      node.children.push(next);
    }
    node = next;
  }
}
function finish(node: WorkspaceNode): number {
  node.children.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name, 'zh-CN'));
  node.count = node.kind === 'file' ? 1 : node.children.reduce((sum, child) => sum + finish(child), 0);
  return node.count;
}

/** Association determines the group; physical directory names never establish ownership. */
export function buildWorkspaceTree(items: NoteTreeItem[], filter = ''): WorkspaceNode[] {
  const map = new Map(items.map(item => [item.path, item]));
  const papers: WorkspaceNode = { key: 'papers', name: '论文笔记', kind: 'group', children: [], count: 0 };
  const themes: WorkspaceNode = { key: 'themes', name: '主题笔记', kind: 'group', children: [], count: 0 };
  const groups = new Map<string, WorkspaceNode>();
  for (const item of items) {
    if (!item.paperPath) continue;
    let group = groups.get(item.paperPath);
    if (!group) {
      group = { key: `paper:${item.paperPath}`, name: item.paperTitle || item.paperPath.split('/').at(-1)!, paperPath: item.paperPath, kind: 'group', children: [], count: 0 };
      groups.set(item.paperPath, group); papers.children.push(group);
    }
    if (item.kind === 'directory' && item.parentPath === 'notes/论文') { group.path = item.path; group.revision = item.revision ?? undefined; }
  }
  for (const item of items) {
    const root = item.paperPath ? groups.get(item.paperPath)! : themes;
    if (item.kind === 'directory' && (item.path === 'notes/论文' || item.path === 'notes/主题' || item.path === root.path)) continue;
    // Directories already represented under a paper are not repeated as theme folders.
    if (!item.paperPath && item.kind === 'directory' && items.some(child => child.path.startsWith(`${item.path}/`) && child.paperPath)) {
      if (!items.some(child => child.kind === 'file' && !child.paperPath && child.path.startsWith(`${item.path}/`))) continue;
    }
    const base = root.path && item.path.startsWith(`${root.path}/`) ? root.path : !item.paperPath && item.path.startsWith('notes/主题/') ? 'notes/主题' : 'notes';
    addPath(root, item, base, map);
  }
  const roots = [papers, themes]; roots.forEach(finish);
  const query = filter.trim().toLocaleLowerCase();
  if (!query) return roots;
  const match = (node: WorkspaceNode): WorkspaceNode | null => {
    if (node.name.toLocaleLowerCase().includes(query)) return node;
    const children = node.children.map(match).filter((child): child is WorkspaceNode => child !== null);
    return children.length ? { ...node, children } : null;
  };
  return roots.map(match).filter((node): node is WorkspaceNode => node !== null);
}

export function descendantNoteCount(items: NoteTreeItem[], path: string): number {
  return items.filter(item => item.kind === 'file' && (item.path === path || item.path.startsWith(`${path}/`))).length;
}
