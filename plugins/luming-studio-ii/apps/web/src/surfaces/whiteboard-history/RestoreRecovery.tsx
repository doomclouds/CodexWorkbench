import { Button, StatusText } from '../../ui/base/index.js';
import type { VersionRestore } from './useVersionRestore.js';

interface RestoreRecoveryProps {
  readonly restore: VersionRestore;
  readonly canEdit: boolean;
}

export function RestoreRecovery({ restore, canEdit }: RestoreRecoveryProps) {
  const { recovery, pending, notice, handleCheckReceipt, handleRetryRestore } = restore;
  if (!recovery) {
    return notice ? (
      <StatusText message={notice.message} tone={notice.tone} announcement="polite" />
    ) : null;
  }

  const waiting = pending !== undefined;
  const pendingMessage = pending === 'check' ? '正在核对恢复回执…' : '正在恢复版本…';

  return (
    <div className="whiteboard-history__recovery">
      <p>待核对版本 {recovery.revision.toString()} 的恢复结果</p>
      {waiting && <StatusText message={pendingMessage} announcement="polite" busy />}
      {notice && <StatusText message={notice.message} tone={notice.tone} announcement="polite" />}
      <div className="whiteboard-history__recovery-actions">
        <Button label="核对原回执" disabled={waiting} onActivate={handleCheckReceipt} />
        {canEdit && (
          <Button label="重试原恢复" disabled={waiting} onActivate={handleRetryRestore} />
        )}
      </div>
    </div>
  );
}
