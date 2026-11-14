import { useEffect, useRef, useState } from 'react';
import './participants.css';

export function CursorChat({ enabled, live, color, onMessage }: { enabled: boolean; live: boolean; color: string; onMessage: (text: string, expiresAt: number) => void }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [point, setPoint] = useState({ x: 80, y: 100 }), [fading, setFading] = useState(false);
  const position = useRef(point), input = useRef<HTMLInputElement>(null), previous = useRef<HTMLElement | null>(null);
  const expire = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ enabled, live, onMessage }); current.current = { enabled, live, onMessage };
  useEffect(() => {
    const move = (event: PointerEvent) => { position.current = { x: event.clientX, y: event.clientY }; };
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing || target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]') || !current.current.enabled || !current.current.live) return;
      event.preventDefault(); previous.current = document.activeElement as HTMLElement | null; setPoint(position.current); setFading(false); setOpen(true); queueMicrotask(() => input.current?.focus());
    };
    const blur = () => setOpen(false);
    window.addEventListener('pointermove', move); window.addEventListener('keydown', key); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); clearTimeout(expire.current); clearTimeout(hide.current); };
  }, []);
  function update(value: string) {
    const next = [...value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ')].slice(0, 50).join('');
    setText(next); setFading(false); onMessage(next, Date.now() + 5000); clearTimeout(expire.current); clearTimeout(hide.current);
    expire.current = setTimeout(() => setFading(true), 5000);
    hide.current = setTimeout(() => { setOpen(false); setText(''); current.current.onMessage('', 0); }, 5600);
  }
  if (!open || !enabled) return null;
  return <form className={`studio-cursor-chat-floating${fading ? ' is-fading' : ''}`} style={{ left: Math.max(8, Math.min(point.x + 12, window.innerWidth - 250)), top: Math.max(8, Math.min(point.y + 18, window.innerHeight - 60)), background: color, color: color === '#fbb315' ? '#201b0c' : '#fff' }} onSubmit={event => { event.preventDefault(); setOpen(false); setText(''); previous.current?.focus({ preventScroll: true }); }}><input ref={input} autoFocus aria-label="光标聊天" autoComplete="off" maxLength={100} value={text} placeholder="说点什么…" onChange={event => update(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); update(''); setOpen(false); previous.current?.focus({ preventScroll: true }); } }} /><span aria-hidden="true">↵</span></form>;
}
