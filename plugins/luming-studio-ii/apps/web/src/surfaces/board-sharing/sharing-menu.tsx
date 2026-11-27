import { useState, type ReactNode } from 'react';

import { ActionMenu, type ActionMenuItem } from '../../ui/base/index.js';

export interface SharingMenuItem extends ActionMenuItem {
  readonly run: (trigger: HTMLButtonElement) => void;
}

interface SharingMenuProps {
  readonly label: string;
  readonly items: readonly SharingMenuItem[];
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function SharingMenu({ label, items, disabled, className, children }: SharingMenuProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        disabled={disabled}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {children}
      </button>
      <ActionMenu
        open={anchor !== null}
        anchor={anchor}
        items={items}
        label={label}
        onAction={(id) => {
          setAnchor(null);
          if (anchor) {
            items.find((item) => item.id === id)?.run(anchor);
          }
        }}
        onRequestClose={() => setAnchor(null)}
      />
    </>
  );
}
