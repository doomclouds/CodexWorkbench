import type { ReactNode } from 'react';

import './Group.css';

export interface GroupProps {
  label: string;
  orientation?: 'horizontal' | 'vertical';
  children: ReactNode;
}

export function Group({ label, orientation = 'horizontal', children }: GroupProps) {
  return (
    <div className="studio-ui-group" role="group" aria-label={label} data-orientation={orientation}>
      {children}
    </div>
  );
}
