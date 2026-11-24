import type { ReactNode } from 'react';
import './StatePanel.css';

export type StatePanelKind = 'empty' | 'initial-loading' | 'error';

export interface StatePanelProps {
  kind: StatePanelKind;
  title: string;
  detail?: string;
  action?: ReactNode;
}

const messageRoles = {
  empty: undefined,
  'initial-loading': 'status',
  error: 'alert',
} as const;

export function StatePanel({ kind, title, detail, action }: StatePanelProps) {
  return (
    <div className="studio-ui-state-panel" data-kind={kind}>
      <div className="studio-ui-state-panel__message" role={messageRoles[kind]}>
        <p className="studio-ui-state-panel__title">{title}</p>
        {detail && <p className="studio-ui-state-panel__detail">{detail}</p>}
      </div>
      {action != null && <div className="studio-ui-state-panel__action">{action}</div>}
    </div>
  );
}
