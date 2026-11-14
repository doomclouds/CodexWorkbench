import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Loader2, X } from 'lucide-react';
import type { CommentPoint } from './comment-target';
import './comments.css';

interface Props { point?: CommentPoint; locate?: () => CommentPoint | undefined; label?: string; draft?: boolean; pinLabel?: string; onClose: () => void; onOutside?: () => void; children: ReactNode }

export function placeCommentPopover(point: CommentPoint, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gutter = 8, pinWidth = point.width ?? 36, pinHeight = point.height ?? 36;
  let left = point.x + pinWidth + 6;
  if (left + size.width > viewport.width - gutter) left = point.x - size.width - 6;
  const above = viewport.height - point.y < 320 && point.y > viewport.height - point.y;
  return { left: Math.max(gutter, Math.min(left, viewport.width - size.width - gutter)), top: Math.max(gutter, Math.min(above ? point.y + pinHeight - size.height : point.y - 2, viewport.height - size.height - gutter)), maxHeight: Math.max(48, Math.min(Math.max(320, viewport.height * .6), viewport.height - gutter * 2)) };
}

/** Positions a comment beside its target without changing the canvas layout. */
export function CommentPopover({ point, locate, label, draft, pinLabel, onClose, onOutside, children }: Props) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const outsideClose = useRef(onOutside || onClose); outsideClose.current = onOutside || onClose;
  const target = useRef({ point, locate }); target.current = { point, locate };
  const [position, setPosition] = useState({ left: point?.x ?? 80, top: point?.y ?? 110, maxHeight: 320 });
  const [pin, setPin] = useState<CommentPoint | undefined>(point);
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const node = root.current; if (!node) return;
      const rect = node.getBoundingClientRect();
      const current = target.current.locate?.() || target.current.point || { x: window.innerWidth / 2, y: window.innerHeight / 3 };
      const next = placeCommentPopover(current, { width: rect.width || 330, height: rect.height || 160 }, { width: window.innerWidth, height: window.innerHeight });
      setPosition(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next);
      setPin(previous => previous?.x === current.x && previous?.y === current.y ? previous : current);
    };
    const tick = () => { place(); frame = window.requestAnimationFrame(tick); };
    place(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    if (root.current) observer?.observe(root.current);
    if (window.requestAnimationFrame) frame = window.requestAnimationFrame(tick);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.cancelAnimationFrame?.(frame); window.removeEventListener('resize', place); };
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Element && event.target.closest('[data-studio-comment-menu]')) return; if (event.target instanceof Node && !root.current?.contains(event.target)) outsideClose.current(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close.current(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, []);
  return <>{draft && pin && <span className="studio-comment-draft-pin" aria-hidden="true" style={{ left: pin.x, top: pin.y }}>{(pinLabel || '我').slice(0, 1)}</span>}<section ref={root} className={`studio-comment-popover${draft ? ' is-draft' : ''}`} role="dialog" aria-label={draft ? '新建备注' : '备注线程'} style={position} onPointerDown={event => event.stopPropagation()}>
    {label && <div className="studio-comment-target"><span title={label}>{label}</span><button type="button" className="studio-icon-button" aria-label="关闭备注" onClick={onClose}><X size={15} /></button></div>}
    {children}
  </section></>;
}

interface ComposerProps {
  text: string; attach: boolean; busy: boolean; saved: boolean; error: string;
  onTextChange: (value: string) => void; onAttachChange: (value: boolean) => void; onSubmit: (event: FormEvent) => void;
}
export function CommentComposer({ text, attach, busy, saved, error, onTextChange, onAttachChange, onSubmit }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <form className="studio-comment-compose" onSubmit={onSubmit}>
    <textarea ref={input} aria-label="批注内容" placeholder="添加备注…" value={text} disabled={busy || saved} onChange={event => onTextChange(event.target.value)} maxLength={16000} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
    {error && <p className="studio-comment-error" role="alert">{error}</p>}
    {saved && <small className="studio-comment-saved">备注已保存，附加失败后可直接重试。</small>}
    <div className="studio-comment-compose-footer"><label><input type="checkbox" checked={attach} disabled={busy || saved} onChange={event => onAttachChange(event.target.checked)} />附加到对话</label><button type="submit" className="studio-comment-submit" title={saved ? '重试附加' : '保存备注'} aria-label={saved ? '重试附加' : '保存备注'} disabled={!text.trim() || busy}>{busy ? <Loader2 size={18} className="studio-spin" /> : <ArrowUp size={20} />}</button></div>
  </form>;
}
