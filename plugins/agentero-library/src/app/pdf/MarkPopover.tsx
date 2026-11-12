import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ReaderMark } from '../../contracts/reader';
import { KIND_LABEL, markText } from './geometry';
import { messageOf } from '../model';
import { placeMarkPopover, type ScreenBounds } from './mark-pins';

export function MarkPopover({ marks, anchor, viewport, sourceBounds, textBounds, onSelect, onSave, onClose }: { marks: ReaderMark[]; anchor: HTMLElement; viewport: HTMLElement | null; sourceBounds(): ScreenBounds | undefined; textBounds(): ScreenBounds[]; onSelect(mark: ReaderMark): void; onSave?(mark: ReaderMark, text: string): Promise<void>; onClose(): void }) {
  const [id, setId] = useState(marks[0].id); const mark = marks.find(item => item.id === id) ?? marks[0];
  const [draft, setDraft] = useState(mark.kind === 'translate' ? mark.result ?? mark.note : mark.comment ?? mark.note);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const root = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: -10000, top: -10000 });
  useLayoutEffect(() => {
    const position = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const bounds = viewport?.getBoundingClientRect(); const page = anchor.closest('.pdf-page')?.getBoundingClientRect(); const box = root.current?.getBoundingClientRect(); if (!box) return;
      const boundary = { left: Math.max(8, (bounds?.left ?? 0) + 8), top: Math.max(8, (bounds?.top ?? 0) + 8, page?.top ?? 0), right: Math.min(window.innerWidth - 8, (bounds?.right ?? window.innerWidth) - 8), bottom: Math.min(window.innerHeight - 8, (bounds?.bottom ?? window.innerHeight) - 8, page?.bottom ?? window.innerHeight) };
      const next = placeMarkPopover(anchor.getBoundingClientRect(), boundary, box.width, box.height, sourceBounds(), textBounds());
      if (!next) { onSelect(mark); return; }
      setPosition(next);
    };
    position(); window.addEventListener('resize', position); viewport?.addEventListener('scroll', position);
    const observer = new ResizeObserver(position); if (root.current) observer.observe(root.current);
    return () => { window.removeEventListener('resize', position); viewport?.removeEventListener('scroll', position); observer.disconnect(); };
  }, [anchor, viewport, mark.id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { onClose(); anchor.focus(); } };
    const outside = (event: PointerEvent) => { if (!busy && event.target instanceof Node && !root.current?.contains(event.target) && !anchor.contains(event.target)) onClose(); };
    window.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [anchor, busy, onClose]);
  async function save() { if (!onSave || busy) return; setBusy(true); setError(''); try { await onSave(mark, draft); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } }
  return createPortal(<section ref={root} className="pdf-mark-popover" role="dialog" aria-label="页内批注" style={{ ...position, maxWidth: Math.min(310, (viewport?.clientWidth ?? window.innerWidth) - 24), maxHeight: (viewport?.clientHeight ?? window.innerHeight) - 24 }}><header><strong>第 {mark.page} 页 · {KIND_LABEL[mark.kind]}</strong><button className="icon-button" disabled={busy} aria-label="关闭页内批注" onClick={onClose}><X size={14} /></button></header>
    {marks.length > 1 && <label>相邻批注<select aria-label="选择相邻批注" value={mark.id} disabled={busy} onChange={event => { const next = marks.find(item => item.id === event.target.value)!; setId(next.id); setDraft(next.kind === 'translate' ? next.result ?? next.note : next.comment ?? next.note); setError(''); }}>{marks.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {markText(item).slice(0, 38) || item.quote.slice(0, 38) || KIND_LABEL[item.kind]}</option>)}</select></label>}
    <blockquote>{mark.quote || '区域批注'}</blockquote>{mark.question && <p>{mark.question}</p>}
    <label>{mark.kind === 'translate' ? '译文' : '备注'}<textarea autoFocus aria-label="页内批注内容" maxLength={20_000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} /></label>
    {error && <p className="error-text" role="alert">{error}</p>}<footer><button onClick={() => onSelect(mark)} disabled={busy}>在批注面板查看</button>{onSave && <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>}</footer>
  </section>, document.body);
}
