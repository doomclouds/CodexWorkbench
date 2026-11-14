import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Loader2, X } from 'lucide-react';
import './comments.css';

interface Props { point?: { x: number; y: number }; label: string; onClose: () => void; children: ReactNode }

/** Positions a comment beside its target without changing the canvas layout. */
export function CommentPopover({ point, label, onClose, children }: Props) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState({ left: point?.x || 80, top: point?.y || 110 });
  useLayoutEffect(() => {
    const place = () => {
      const node = root.current; if (!node) return;
      const rect = node.getBoundingClientRect();
      const x = point?.x ?? window.innerWidth / 2, y = point?.y ?? window.innerHeight / 3;
      setPosition({ left: Math.max(12, Math.min(x + 10, window.innerWidth - rect.width - 12)), top: Math.max(12, Math.min(y, window.innerHeight - rect.height - 12)) });
    };
    place(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    if (root.current) observer?.observe(root.current);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [point?.x, point?.y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close.current(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); close.current(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, []);
  return <section ref={root} className="studio-comment-popover" role="dialog" aria-label="目标备注" style={position} onPointerDown={event => event.stopPropagation()}>
    <div className="studio-comment-target"><span title={label}>{label}</span><button type="button" className="studio-icon-button" aria-label="关闭备注" onClick={onClose}><X size={15} /></button></div>
    {children}
  </section>;
}

interface ComposerProps {
  text: string; attach: boolean; busy: boolean; saved: boolean; error: string;
  onTextChange: (value: string) => void; onAttachChange: (value: boolean) => void; onSubmit: (event: FormEvent) => void;
}
export function CommentComposer({ text, attach, busy, saved, error, onTextChange, onAttachChange, onSubmit }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <form className="studio-comment-compose" onSubmit={onSubmit}>
    <textarea ref={input} aria-label="批注内容" placeholder="添加备注…" value={text} disabled={busy || saved} onChange={event => onTextChange(event.target.value)} maxLength={16000} rows={3} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
    {error && <p className="studio-comment-error" role="alert">{error}</p>}
    {saved && <small className="studio-comment-saved">备注已保存，附加失败后可直接重试。</small>}
    <div className="studio-comment-compose-footer"><label><input type="checkbox" checked={attach} disabled={busy || saved} onChange={event => onAttachChange(event.target.checked)} />附加到对话</label><button type="submit" className="studio-comment-submit" title={saved ? '重试附加' : '保存备注'} aria-label={saved ? '重试附加' : '保存备注'} disabled={!text.trim() || busy}>{busy ? <Loader2 size={18} className="studio-spin" /> : <ArrowUp size={20} />}</button></div>
  </form>;
}
