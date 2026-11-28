import { useImperativeHandle, useRef, type MouseEvent, type ReactNode, type Ref } from 'react';
import './Button.css';

export interface ButtonHandle {
  focus(): void;
}

export interface ButtonProps {
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  tone?: 'danger';
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  busy?: boolean;
  onActivate?: () => void;
  ref?: Ref<ButtonHandle>;
}

export function Button({
  label,
  icon,
  iconOnly = false,
  variant = 'secondary',
  tone,
  type = 'button',
  disabled = false,
  busy = false,
  onActivate,
  ref,
}: ButtonProps) {
  const button = useRef<HTMLButtonElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        button.current?.focus();
      },
    }),
    [],
  );

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled || busy) {
      event.preventDefault();
      return;
    }

    if (type === 'button') {
      onActivate?.();
    }
  }

  return (
    <button
      ref={button}
      type={type}
      className="studio-ui-button"
      data-variant={variant}
      data-tone={tone}
      data-icon-only={iconOnly || undefined}
      aria-label={iconOnly ? label : undefined}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      disabled={disabled}
      onClick={handleClick}
    >
      {icon != null && (
        <span aria-hidden="true" className="studio-ui-button__icon">
          {icon}
        </span>
      )}
      {!iconOnly && label}
    </button>
  );
}
