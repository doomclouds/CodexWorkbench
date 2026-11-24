import { useEffectEvent, useId, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, ReactNode, SyntheticEvent } from 'react';
import { Button } from '../Button/Button.js';
import './Dialog.css';

export type DialogCloseReason = 'escape' | 'backdrop' | 'close-button';

export interface DialogDismissPolicy {
  escape?: boolean;
  backdrop?: boolean;
}

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
  initialFocus?: () => void;
  restoreFocus?: () => void;
  dismissPolicy?: DialogDismissPolicy;
  onRequestClose: (reason: DialogCloseReason) => void;
}

export function Dialog({
  open,
  title,
  description,
  closeLabel,
  children,
  initialFocus,
  restoreFocus,
  dismissPolicy,
  onRequestClose,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const titleId = useId();
  const descriptionId = titleId + '-description';
  const focusOnOpen = useEffectEvent(() => initialFocus?.());
  const focusOnClose = useEffectEvent(() => restoreFocus?.());

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !element) {
      return;
    }

    backdropPressed.current = false;
    element.showModal();
    focusOnOpen();

    return () => {
      element.close();
      focusOnClose();
    };
  }, [open]);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    if (dismissPolicy?.escape !== false) {
      onRequestClose('escape');
    }
  }

  function handleBackdropStart(event: PointerEvent<HTMLDialogElement>) {
    backdropPressed.current = event.target === event.currentTarget;
  }

  function handleBackdropCancel() {
    backdropPressed.current = false;
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    const beganOnBackdrop = backdropPressed.current;
    backdropPressed.current = false;

    if (beganOnBackdrop && event.target === event.currentTarget && dismissPolicy?.backdrop) {
      onRequestClose('backdrop');
    }
  }

  function handleCloseButton() {
    onRequestClose('close-button');
  }

  return (
    <dialog
      ref={dialog}
      className="studio-ui-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onPointerDown={handleBackdropStart}
      onPointerCancel={handleBackdropCancel}
      onClick={handleBackdropClick}
    >
      <div className="studio-ui-dialog__body">
        <div className="studio-ui-dialog__header">
          <h2 id={titleId} className="studio-ui-dialog__title">
            {title}
          </h2>
          <Button label={closeLabel} variant="ghost" onActivate={handleCloseButton} />
        </div>
        {description && (
          <p id={descriptionId} className="studio-ui-dialog__description">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
