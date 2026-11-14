import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Copy, FileCode2, MoreHorizontal, Pin, Share2, Trash2 } from 'lucide-react';
import type { Artifact } from '../contracts/studio';
import './library.css';

interface MenuPlacement { left: number; top: number; maxHeight: number; maxWidth: number; side: 'above' | 'below' }
export interface LibraryMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  initialFocus?: 'first' | 'last' | 'selected';
  id?: string;
}

/** Menus leave the scrolling library pane, while inheriting its Studio theme. */
export function LibraryMenu({ anchorRef, label, onClose, children, className = '', initialFocus = 'selected', id }: LibraryMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const host = anchorRef.current?.closest<HTMLElement>('.studio');

  function place(closeWhenHidden = false) {
    const anchor = anchorRef.current, menu = menuRef.current;
    if (!anchor || !menu || !host) return;
    const anchorRect = anchor.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const bounds = { left: Math.max(0, hostRect.width ? hostRect.left : 0), right: Math.min(window.innerWidth, hostRect.width ? hostRect.right : window.innerWidth), top: Math.max(0, hostRect.height ? hostRect.top : 0), bottom: Math.min(window.innerHeight, hostRect.height ? hostRect.bottom : window.innerHeight) };
    const scrollRect = anchor.closest('.studio-library-main')?.getBoundingClientRect();
    if (closeWhenHidden && scrollRect && scrollRect.height > 0 && (anchorRect.bottom <= Math.max(bounds.top, scrollRect.top) || anchorRect.top >= Math.min(bounds.bottom, scrollRect.bottom) || anchorRect.right <= bounds.left || anchorRect.left >= bounds.right)) { closeRef.current(); return; }
    const inset = 8, gap = 6, maxWidth = Math.max(0, bounds.right - bounds.left - inset * 2);
    const menuRect = menu.getBoundingClientRect(), width = Math.min(menuRect.width, maxWidth);
    const height = menu.scrollHeight || menuRect.height;
    const below = Math.max(0, bounds.bottom - inset - anchorRect.bottom - gap), above = Math.max(0, anchorRect.top - gap - bounds.top - inset);
    const side = height <= below || below >= above ? 'below' : 'above';
    const maxHeight = side === 'below' ? below : above;
    const left = Math.max(bounds.left + inset, Math.min(anchorRect.right - width, bounds.right - inset - width));
    const top = side === 'below' ? anchorRect.bottom + gap : anchorRect.top - gap - Math.min(height, maxHeight);
    const next: MenuPlacement = { left, top, maxHeight, maxWidth, side };
    setPlacement(previous => previous && Object.keys(next).every(key => previous[key as keyof MenuPlacement] === next[key as keyof MenuPlacement]) ? previous : next);
  }

  useLayoutEffect(() => { place(); });
  useEffect(() => {
    const menu = menuRef.current;
    const items = menu ? [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')] : [];
    (initialFocus === 'last' ? items.at(-1) : initialFocus === 'selected' ? menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') || items[0] : items[0])?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu?.contains(event.target) && !anchorRef.current?.contains(event.target)) closeRef.current(); };
    const reposition = (event: Event) => { if (event.target instanceof Node && menu?.contains(event.target)) return; place(true); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [anchorRef]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); anchorRef.current?.focus(); return; }
    if (event.key === 'Tab') { closeRef.current(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); items[next]?.focus();
  }

  if (!host) return null;
  return createPortal(<div id={id} ref={menuRef} role="menu" aria-label={label} data-placement={placement?.side} className={`studio-menu studio-library-floating-menu ${className}`} onKeyDown={navigate}
    style={{ position: 'fixed', left: placement?.left || 0, top: placement?.top || 0, maxWidth: placement?.maxWidth, maxHeight: placement?.maxHeight, visibility: placement ? 'visible' : 'hidden' }}>{children}</div>, host);
}

export interface LibraryArtifactMenuProps {
  artifact: Artifact;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPin: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}

export function LibraryArtifactMenu({ artifact, open, busy, onOpenChange, onPin, onRename, onCopyLink, onDuplicate, onTrash }: LibraryArtifactMenuProps) {
  const anchorRef = useRef<HTMLButtonElement>(null), menuId = useId();
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
  function select(action: () => void) { onOpenChange(false); anchorRef.current?.focus(); action(); }
  return <div className="studio-menu-anchor">
    <button ref={anchorRef} type="button" className="studio-icon-button" aria-label={`管理作品：${artifact.title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={busy}
      onClick={() => { setInitialFocus('first'); onOpenChange(!open); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setInitialFocus(event.key === 'ArrowUp' ? 'last' : 'first'); onOpenChange(true); } }}><MoreHorizontal size={20} /></button>
    {open && <LibraryMenu id={menuId} anchorRef={anchorRef} label={`管理作品：${artifact.title}`} initialFocus={initialFocus} onClose={() => onOpenChange(false)}>
      <button type="button" role="menuitem" disabled={busy} onClick={() => select(onPin)}><Pin size={16} />{artifact.pinned ? '取消固定' : '固定'}</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => select(onRename)}><FileCode2 size={16} />重命名</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => select(onCopyLink)}><Share2 size={16} />复制链接</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => select(onDuplicate)}><Copy size={16} />复制作品</button>
      <div className="studio-menu-rule" role="separator" />
      <button type="button" role="menuitem" className="studio-danger-text" disabled={busy} onClick={() => select(onTrash)}><Trash2 size={16} />移入回收站</button>
    </LibraryMenu>}
  </div>;
}
