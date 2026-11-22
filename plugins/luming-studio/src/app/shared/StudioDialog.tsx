import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { registerEscapeLayer } from './escape';

export function StudioDialog({
  title,
  children,
  onClose,
  wide = false,
  portalRoot,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  portalRoot?: HTMLElement | null;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    const unregister = registerEscapeLayer(ref.current!, () => close(), 20);
    return () => {
      unregister();
      previous?.focus();
    };
  }, []);
  function handleBackdropPress(event: PointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }
  function handleFocusTrap(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, textarea, select, [tabindex="0"]',
      ),
    ];

    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault();
      controls[0]?.focus();
    }
  }
  const dialog = (
    <div className="studio-modal-backdrop" onPointerDown={handleBackdropPress}>
      <div
        className={`studio-modal${wide ? ' studio-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        onCopy={(event) => event.stopPropagation()}
        onCut={(event) => event.stopPropagation()}
        onPaste={(event) => event.stopPropagation()}
        onKeyDown={handleFocusTrap}
      >
        <div className="studio-modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="studio-icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  return portalRoot ? createPortal(dialog, portalRoot) : dialog;
}
