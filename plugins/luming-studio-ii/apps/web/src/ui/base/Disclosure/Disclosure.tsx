import { useId, type ReactNode } from 'react';

import './Disclosure.css';

export interface DisclosureProps {
  label: string;
  open: boolean;
  disabled?: boolean;
  children: ReactNode;
  onOpenChange: (next: boolean) => void;
}

export function Disclosure({ label, open, disabled, children, onOpenChange }: DisclosureProps) {
  const contentId = useId() + '-content';

  return (
    <div className="studio-ui-disclosure">
      <button
        type="button"
        className="studio-ui-disclosure__trigger"
        aria-expanded={open}
        aria-controls={contentId}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        {label}
      </button>
      <div id={contentId} className="studio-ui-disclosure__content" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
