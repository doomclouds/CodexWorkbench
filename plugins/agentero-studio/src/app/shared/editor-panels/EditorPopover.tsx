import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import './editor-panels.css';

export interface EditorPopoverProps {
  title: string;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  id?: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

/** A non-modal popover. Its parent provides the anchor's positioning context. */
export function EditorPopover({ title, onClose, anchorRef, children, className = '', id }: EditorPopoverProps) {
  const generatedId = useId();
  const headingId = `${id || generatedId}-heading`;
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [placement, setPlacement] = useState({ x: 0, maxHeight: 'min(72dvh, 720px)' });

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const place = () => {
      const rect = node.getBoundingClientRect();
      const available = Math.max(120, window.innerHeight - rect.top - 12);
      // Remove the previous translation before calculating the next correction.
      const left = rect.left - Number(node.dataset.shift || 0), right = left + rect.width;
      const x = left < 12 ? 12 - left : right > window.innerWidth - 12 ? window.innerWidth - 12 - right : 0;
      node.dataset.shift = String(x);
      setPlacement(previous => previous.x === x && previous.maxHeight === `${available}px` ? previous : { x, maxHeight: `${available}px` });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  useEffect(() => {
    const node = root.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || node?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
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
  }, [anchorRef]);

  return <div ref={root} id={id} role="dialog" aria-modal="false" aria-labelledby={headingId} tabIndex={-1}
    className={`studio-editor-popover ${className}`} style={{ transform: `translateX(${placement.x}px)`, maxHeight: placement.maxHeight }}>
    <div className="studio-editor-popover-content"><div className="studio-editor-popover-heading"><h2 id={headingId}>{title}</h2><button type="button" className="studio-icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}
