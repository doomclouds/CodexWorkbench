import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, MoreHorizontal } from 'lucide-react';
import type { WorkspaceNode } from './workspace-model';

export function NoteTree({ nodes, selectedPath, folderPath, filter, onOpen, onFolder, onMenu }: {
  nodes: WorkspaceNode[]; selectedPath?: string; folderPath: string; filter: string;
  onOpen(path: string): void; onFolder(path: string, paperPath?: string): void;
  onMenu(node: WorkspaceNode): void;
}) {
  const [expanded, setExpanded] = useState(() => new Set(['papers', 'themes']));
  useEffect(() => {
    if (!selectedPath) return;
    setExpanded(previous => {
      const next = new Set(previous);
      const visit = (node: WorkspaceNode): boolean => {
        const contains = node.path === selectedPath || node.children.some(visit);
        if (contains && node.kind !== 'file') next.add(node.key);
        return contains;
      };
      nodes.forEach(visit); return next;
    });
  }, [selectedPath, nodes]);
  const render = (node: WorkspaceNode, depth: number) => {
    const open = !!filter || expanded.has(node.key); const leaf = node.kind === 'file';
    const selected = leaf ? selectedPath === node.path : !!node.path && folderPath === node.path;
    return <li key={node.key} role="none"><div className={`note-tree-row ${selected ? 'is-selected' : ''}`} style={{ '--note-depth': depth } as React.CSSProperties} onContextMenu={event => { if (node.path && node.revision) { event.preventDefault(); onMenu(node); } }}>
      <button className="note-tree-entry" role="treeitem" aria-selected={selected} aria-expanded={leaf ? undefined : open} title={node.path || node.name} onClick={() => {
        if (leaf) { if (node.path) onOpen(node.path); }
        else { setExpanded(previous => { const next = new Set(previous); if (next.has(node.key)) next.delete(node.key); else next.add(node.key); return next; }); if (node.path || node.paperPath || node.key === 'themes') onFolder(node.path || 'notes', node.paperPath); }
      }}>{leaf ? <span className="note-tree-chevron" /> : open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{leaf ? <FileText size={15} /> : open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{node.name}</span>{node.kind === 'group' && <small>{node.count}</small>}</button>
      {node.path && node.revision && <button className="note-tree-menu icon-button" aria-label={`${node.name}的操作`} onClick={() => onMenu(node)}><MoreHorizontal size={15} /></button>}
    </div>{!leaf && open && node.children.length > 0 && <ul role="group">{node.children.map(child => render(child, depth + 1))}</ul>}</li>;
  };
  return <ul className="note-tree" role="tree" aria-label="笔记文件夹树">{nodes.map(node => render(node, 0))}</ul>;
}
