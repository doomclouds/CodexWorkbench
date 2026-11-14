import { useLayoutEffect, useRef, useState } from 'react';
import { LibraryMenu } from '../LibraryArtifactMenu.js';
export type CanvasCommand = 'cut' | 'copy' | 'paste' | 'duplicate' | 'front' | 'back' | 'forward' | 'backward' | 'group' | 'ungroup' | 'tidy' | 'delete' | 'lock' | 'select-all' | 'fit';
const rows: { id: CanvasCommand; label: string; shortcut?: string; edit?: boolean; selection?: boolean; geometry?: boolean }[] = [
  { id: 'cut', label: '剪切', shortcut: 'Ctrl/⌘ X', edit: true, selection: true, geometry: true }, { id: 'copy', label: '复制', shortcut: 'Ctrl/⌘ C', selection: true }, { id: 'paste', label: '粘贴', shortcut: 'Ctrl/⌘ V', edit: true }, { id: 'duplicate', label: '重复', shortcut: 'Ctrl/⌘ D', edit: true, selection: true },
  { id: 'front', label: '置于顶层', edit: true, selection: true, geometry: true }, { id: 'back', label: '置于底层', edit: true, selection: true, geometry: true }, { id: 'forward', label: '上移一层', edit: true, selection: true, geometry: true }, { id: 'backward', label: '下移一层', edit: true, selection: true, geometry: true },
  { id: 'group', label: '组合', edit: true, selection: true, geometry: true }, { id: 'ungroup', label: '取消组合', edit: true, selection: true, geometry: true }, { id: 'tidy', label: '整理', edit: true, selection: true, geometry: true }, { id: 'lock', label: '锁定', shortcut: 'Ctrl/⌘ Shift L', edit: true, selection: true }, { id: 'delete', label: '删除', shortcut: 'Delete', edit: true, selection: true, geometry: true }, { id: 'select-all', label: '全选' }, { id: 'fit', label: '适应白板', shortcut: 'Shift 1' },
];
export default function CanvasActionsMenu({ point, canEdit, selected, locked, hasClipboard, onCommand, onClose }: { point: { x: number; y: number }; canEdit: boolean; selected: number; locked: boolean; hasClipboard: boolean; onCommand: (command: CanvasCommand) => void; onClose: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => { setReady(true); }, []);
  return <><span ref={anchor} aria-hidden="true" style={{ position: 'absolute', left: point.x, top: point.y, width: 0, height: 0, pointerEvents: 'none' }} />{ready && <LibraryMenu anchorRef={anchor} label="白板操作" className="studio-canvas-actions-menu" atPoint onClose={onClose}>
    {rows.filter(row => selected > 0 || !row.selection).map(row => <button type="button" role="menuitem" key={row.id} disabled={row.edit && !canEdit || row.selection && !selected || row.geometry && locked || row.id === 'paste' && !hasClipboard || row.id === 'group' && selected < 2 || row.id === 'tidy' && selected < 2} onClick={() => { onCommand(row.id); onClose(); }}><span>{row.id === 'lock' && locked ? '解锁' : row.label}</span><small>{row.shortcut}</small></button>)}
  </LibraryMenu>}</>;
}
