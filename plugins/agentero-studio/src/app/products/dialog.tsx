import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function StudioDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="studio-modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`studio-modal${wide ? ' studio-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]') || [])];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }}>
      <div className="studio-modal-heading"><h2 id={titleId}>{title}</h2><button className="studio-icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}
