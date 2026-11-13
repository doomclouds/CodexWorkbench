import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './anchored-menu.css';

export type MenuAnchor = { element: HTMLElement } | { point: { x: number; y: number } };
interface Props { anchor: MenuAnchor; onClose(): void; children: ReactNode; ariaLabel?: string; className?: string }
let closeCurrentMenu: (() => void) | null = null;

export function menuPosition(anchor: { left: number; top: number; bottom: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const margin = 8, gap = 4;
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - size.width - margin));
  const below = anchor.bottom + gap;
  const top = below + size.height <= viewport.height - margin ? below : anchor.top - size.height - gap;
  return { left, top: Math.max(margin, Math.min(top, viewport.height - size.height - margin)) };
}

/** Menus stay inside the app document, including when rendered in an embedded host. */
export function AnchoredMenu({ anchor, onClose, children, ariaLabel = '操作', className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const owner = 'element' in anchor ? anchor.element.ownerDocument : document;
  useLayoutEffect(() => {
    const menu = ref.current, view = owner.defaultView;
    if (!menu || !view) return;
    const previous = owner.activeElement as HTMLElement | null;
    const restore = 'element' in anchor ? anchor.element : previous;
    const requestClose = () => close.current();
    closeCurrentMenu?.(); closeCurrentMenu = requestClose;
    const place = () => {
      if ('element' in anchor && !anchor.element.isConnected) { requestClose(); return; }
      const rect = 'element' in anchor ? anchor.element.getBoundingClientRect() : { left: anchor.point.x, top: anchor.point.y, bottom: anchor.point.y };
      if ('element' in anchor && (rect.bottom <= 0 || rect.top >= view.innerHeight || rect.left >= view.innerWidth || ('right' in rect && Number(rect.right) <= 0))) { requestClose(); return; }
      setPosition(menuPosition(rect, menu.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight }));
    };
    const items = () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    place();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); requestClose(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const entries = items(), index = entries.indexOf(owner.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
        entries[next]?.focus();
      } else if (event.key === 'Tab') requestClose();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.contains(target) && !('element' in anchor && anchor.element.contains(target))) requestClose();
    };
    const scroll = (event: Event) => {
      if (menu.contains(event.target as Node)) return;
      if ('element' in anchor) place(); else requestClose();
    };
    view.addEventListener('keydown', key, true); owner.addEventListener('pointerdown', outside, true);
    owner.addEventListener('scroll', scroll, true); view.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place); observer?.observe(menu);
    return () => {
      view.removeEventListener('keydown', key, true); owner.removeEventListener('pointerdown', outside, true);
      owner.removeEventListener('scroll', scroll, true); view.removeEventListener('resize', place); observer?.disconnect();
      if (closeCurrentMenu === requestClose) closeCurrentMenu = null;
      if (restore?.isConnected && (menu.contains(owner.activeElement) || owner.activeElement === owner.body)) restore.focus({ preventScroll: true });
    };
  }, [anchor, owner]);
  const positioned = position !== null;
  useLayoutEffect(() => {
    // The measurement update must commit visibility before the browser can focus an item.
    if (!positioned) return;
    const menu = ref.current;
    const first = menu?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
    (first || menu)?.focus({ preventScroll: true });
  }, [anchor, owner, positioned]);
  return createPortal(<div ref={ref} role="menu" aria-label={ariaLabel} tabIndex={-1} className={`anchored-menu ${className}`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>{children}</div>, owner.body);
}
