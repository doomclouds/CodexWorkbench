import type { ReactNode } from 'react';

import { OperationNoticeSlot, type ShellOperationNotice } from './operation-notice/index.js';

interface AppShellProps {
  readonly resolvedTheme?: 'light' | 'dark';
  readonly notice?: ShellOperationNotice;
  readonly onDismissNotice: () => void;
  readonly children: ReactNode;
}

export function AppShell({ resolvedTheme, notice, onDismissNotice, children }: AppShellProps) {
  return (
    <div className="studio-whiteboard-app" data-theme={resolvedTheme}>
      {notice && <OperationNoticeSlot notice={notice} onDismiss={onDismissNotice} />}
      <div className="studio-app-page">{children}</div>
    </div>
  );
}
