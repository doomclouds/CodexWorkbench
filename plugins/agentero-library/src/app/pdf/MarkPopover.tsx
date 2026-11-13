import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ReaderMark } from '../../contracts/reader';
import { KIND_LABEL, markText } from './geometry';
import { messageOf } from '../model';
import { placeMarkPopover, type ScreenBounds } from './mark-pins';

const commentText = (mark: ReaderMark) => mark.kind === 'translate' ? mark.result ?? mark.note : mark.comment ?? mark.note;
function previewBoundary(viewport: HTMLElement | null): ScreenBounds {
  const bounds = viewport?.getBoundingClientRect();
  return { left: Math.max(8, (bounds?.left ?? 0) + 8), top: Math.max(8, (bounds?.top ?? 0) + 8), right: Math.min(window.innerWidth - 8, (bounds?.right ?? window.innerWidth) - 8), bottom: Math.min(window.innerHeight - 8, (bounds?.bottom ?? window.innerHeight) - 8) };
}

export function MarkPopover({ marks, anchor, viewport, sourceBounds, textBounds, drafts, onActiveChange, onSelect, onSave, onClose }: { marks: ReaderMark[]; anchor: HTMLElement; viewport: HTMLElement | null; sourceBounds(id: string): ScreenBounds | undefined; textBounds(): ScreenBounds[]; drafts?: Map<string, string>; onActiveChange?(id: string): void; onSelect(mark: ReaderMark, draft?: string): void; onSave?(mark: ReaderMark, text: string): Promise<void>; onClose(): void }) {
  const [id, setId] = useState(marks[0].id); const mark = marks.find(item => item.id === id) ?? marks[0];
  const localDrafts = useRef(new Map<string, string>()); const cache = drafts ?? localDrafts.current;
  const [draft, setDraft] = useState(() => cache.get(mark.id) ?? commentText(mark));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const root = useRef<HTMLElement>(null);
  const saving = useRef(false); const dirty = draft !== commentText(mark);
  const boundary = previewBoundary(viewport);
  const [position, setPosition] = useState({ left: -10000, top: -10000 });
  useLayoutEffect(() => {
    const position = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const box = root.current?.getBoundingClientRect(); if (!box) return;
      const next = placeMarkPopover(anchor.getBoundingClientRect(), previewBoundary(viewport), box.width, box.height, sourceBounds(mark.id), textBounds());
      setPosition(current => current.left === next.left && current.top === next.top ? current : next);
    };
    position(); window.addEventListener('resize', position); viewport?.addEventListener('scroll', position);
    const observer = new ResizeObserver(position); if (root.current) observer.observe(root.current);
    return () => { window.removeEventListener('resize', position); viewport?.removeEventListener('scroll', position); observer.disconnect(); };
  }, [anchor, viewport, mark.id, sourceBounds, textBounds, onClose]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); if (!busy) { onClose(); anchor.focus(); } } };
    const outside = (event: PointerEvent) => { if (!busy && event.target instanceof Node && !root.current?.contains(event.target) && !anchor.contains(event.target)) onClose(); };
    window.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside); };
  }, [anchor, busy, onClose]);
  async function save() { if (!onSave || saving.current) return; saving.current = true; setBusy(true); setError(''); try { await onSave(mark, draft); cache.delete(mark.id); } catch (cause) { setError(messageOf(cause)); } finally { saving.current = false; setBusy(false); } }
  return createPortal(<section ref={root} className="pdf-mark-popover pdf-annotation-preview" role="dialog" aria-label="页内批注" style={{ ...position, maxWidth: Math.max(1, Math.min(310, boundary.right - boundary.left)), maxHeight: Math.max(1, boundary.bottom - boundary.top) }}><header><strong>第 {mark.page} 页 · {KIND_LABEL[mark.kind]}</strong><button className="icon-button" disabled={busy} aria-label="关闭页内批注" onClick={() => { onClose(); anchor.focus(); }}><X size={14} /></button></header>
    {marks.length > 1 && <label>相邻批注<select aria-label="选择相邻批注" value={mark.id} disabled={busy} onChange={event => { const next = marks.find(item => item.id === event.target.value)!; setId(next.id); setDraft(cache.get(next.id) ?? commentText(next)); setError(''); onActiveChange?.(next.id); }}>{marks.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {markText(item).slice(0, 38) || item.quote.slice(0, 38) || KIND_LABEL[item.kind]}</option>)}</select></label>}
    <blockquote>{mark.quote || '区域批注'}</blockquote>{mark.question && <p>{mark.question}</p>}
    <label>{mark.kind === 'translate' ? '译文' : '备注'}<textarea autoFocus aria-label="页内批注内容" maxLength={20_000} value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); if (event.target.value === commentText(mark)) cache.delete(mark.id); else cache.set(mark.id, event.target.value); }} /></label>
    {dirty && <small className="pdf-annotation-draft" role="status">草稿已保留；关闭预览不会丢失</small>}
    {error && <p className="error-text" role="alert">{error}</p>}<footer><button onClick={() => onSelect(mark, dirty ? draft : undefined)} disabled={busy}>在批注面板编辑</button>{onSave && <button className="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? '保存中…' : '保存备注'}</button>}</footer>
  </section>, document.body);
}
