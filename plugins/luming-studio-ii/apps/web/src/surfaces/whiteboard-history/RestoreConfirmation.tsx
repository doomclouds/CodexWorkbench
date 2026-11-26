import { useRef } from 'react';
import type { RestoreBoardVersionCommand } from '../../data/whiteboard/index.js';
import { Button, Dialog, StatusText, type ButtonHandle } from '../../ui/base/index.js';

interface RestoreConfirmationProps {
  readonly command: RestoreBoardVersionCommand;
  readonly unknownResult: boolean;
  readonly pending: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly restoreFocus: () => void;
}

export function RestoreConfirmation({
  command,
  unknownResult,
  pending,
  error,
  onCancel,
  onConfirm,
  restoreFocus,
}: RestoreConfirmationProps) {
  const cancelButton = useRef<ButtonHandle>(null);
  const whole = command.scope.kind === 'whole';
  const oneObject = command.scope.kind === 'selection' && command.scope.objectIds.length === 1;
  const range = whole
    ? '将整个作品恢复到版本 '
    : '将所选 ' + command.scope.objectIds.length + ' 个对象恢复到版本 ';

  return (
    <Dialog
      open
      title={oneObject ? '只恢复这一处？' : '恢复此版本？'}
      description={range + command.revision + '。'}
      closeLabel="关闭恢复确认"
      dismissPolicy={{ backdrop: true }}
      initialFocus={() => cancelButton.current?.focus()}
      restoreFocus={restoreFocus}
      onRequestClose={onCancel}
    >
      <p className="whiteboard-history__note">恢复会创建新版本，已有历史记录将保留。</p>
      {pending && <StatusText message="正在恢复版本…" announcement="polite" busy />}
      {error && <StatusText message={error} tone="error" announcement="polite" />}
      <div className="whiteboard-history-preview__confirmation-actions">
        <Button
          ref={cancelButton}
          label={pending || unknownResult ? '关闭确认' : '取消'}
          onActivate={onCancel}
        />
        <Button
          label={unknownResult ? '核对并重试' : '确认恢复'}
          variant="primary"
          busy={pending}
          onActivate={onConfirm}
        />
      </div>
    </Dialog>
  );
}
