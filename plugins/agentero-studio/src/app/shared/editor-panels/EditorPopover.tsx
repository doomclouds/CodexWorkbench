import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './editor-panels.css';

export interface EditorPopoverProps {
  title: string;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  id?: string;
  hideHeading?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

/** A non-modal popover. Its parent provides the anchor's positioning context. */
export function EditorPopover({ title, onClose, anchorRef, children, className = '', id, hideHeading = false }: EditorPopoverProps) {
  const generatedId = useId();
  const headingId = `${id || generatedId}-heading`;
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number; arrow: number; above: boolean } | null>(null);
  const host = anchorRef?.current?.closest<HTMLElement>('.studio');

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const place = () => {
      const rect = node.getBoundingClientRect(), anchor = anchorRef?.current?.getBoundingClientRect() || rect;
      if (anchor.width > 0 && anchor.height > 0 && (anchor.bottom <= 0 || anchor.top >= window.innerHeight || anchor.right <= 0 || anchor.left >= window.innerWidth)) { close.current(); return; }
      const height = (node.firstElementChild?.scrollHeight || rect.height) + 2;
      const below = Math.max(0, window.innerHeight - anchor.bottom - 22), above = Math.max(0, anchor.top - 22);
      const useAbove = height > below && above > below, maxHeight = useAbove ? above : below;
      const left = Math.max(12, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 12));
      const next = { left, top: useAbove ? anchor.top - 10 - Math.min(height, maxHeight) : anchor.bottom + 10, maxHeight, arrow: Math.max(16, Math.min(rect.width - 16, anchor.left + anchor.width / 2 - left)), above: useAbove };
      setPlacement(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); observer?.disconnect(); };
  }, [anchorRef, children, host]);

  useEffect(() => {
    const node = root.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-studio-comment-menu], .studio-editor-submenu')) return;
      if (!(event.target instanceof Node) || root.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
      close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
      event.stopPropagation();
      close.current();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
      if (document.activeElement === document.body || (document.activeElement && node?.contains(document.activeElement))) {
        const target = anchorRef?.current || previousFocus;
        if (target?.isConnected) target.focus({ preventScroll: true });
      }
    };
  }, [anchorRef, host]);

  const content = <div ref={root} id={id} role="dialog" aria-modal="false" aria-labelledby={hideHeading ? undefined : headingId} aria-label={hideHeading ? title : undefined} tabIndex={-1}
    className={`studio-editor-popover ${placement?.above ? 'is-above ' : ''}${className}`} style={{ position: 'fixed', left: placement?.left || 0, top: placement?.top || 0, maxHeight: placement?.maxHeight, visibility: placement ? 'visible' : 'hidden', '--studio-popover-arrow': `${placement?.arrow || 16}px` } as CSSProperties}>
    <div className="studio-editor-popover-content">{!hideHeading && <div className="studio-editor-popover-heading"><h2 id={headingId}>{title}</h2><button type="button" className="studio-icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={18} /></button></div>}
      {children}
    </div>
  </div>;
  return host ? createPortal(content, host) : content;
}
