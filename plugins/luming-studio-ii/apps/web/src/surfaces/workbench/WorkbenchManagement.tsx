import { useEffect, useEffectEvent, useId, useRef, useState, type SubmitEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Dialog, OperationNotice } from '../../ui/base/index.js';
import type { useBoardManagement } from './useBoardManagement.js';

type BoardManagement = ReturnType<typeof useBoardManagement>;

const notificationDuration = 6_000;
const maxTitleLength = 200;

export function ManagementStatus({ management }: { readonly management: BoardManagement }) {
  const { state } = management;
  const dismiss = useEffectEvent(management.dismiss);

  useEffect(() => {
    if (state.kind !== 'changed' || !state.message) {
      return;
    }

    const timer = setTimeout(dismiss, notificationDuration);

    return () => clearTimeout(timer);
  }, [state]);

  if (state.kind === 'managing' || state.kind === 'checking') {
    const message = state.kind === 'managing' ? '正在更新作品' : '正在查询操作回执';

    return (
      <span className="studio-workbench-sr-only" role="status">
        {message}
      </span>
    );
  }
  if (state.kind === 'changed' && state.message) {
    return (
      <div className="studio-workbench-management-notice">
        <OperationNotice
          id="workbench-management-status"
          level="success"
          message={state.message}
          presentation="toast"
          dismissible
          onDismiss={management.dismiss}
        />
      </div>
    );
  }

  if (state.kind === 'rejected' || state.kind === 'unknown') {
    const unknown = state.kind === 'unknown';
    const message = unknown ? '操作结果未知。' : '作品修改失败。';

    return (
      <div className="studio-workbench-error" role="alert">
        <AlertCircle size={16} />
        <span>
          {message}
          {state.detail}
        </span>
        {unknown && (
          <>
            <button type="button" onClick={management.query}>
              查询回执
            </button>
            <button type="button" onClick={management.retry}>
              重试原操作
            </button>
          </>
        )}
      </div>
    );
  }

  return null;
}

interface RenameBoardDialogProps {
  readonly initialTitle: string;
  readonly blocked: boolean;
  readonly management: BoardManagement;
  readonly onClose: () => void;
  readonly onSave: (title: string) => void;
  readonly restoreFocus: () => void;
}

export function RenameBoardDialog({
  initialTitle,
  blocked,
  management,
  onClose,
  onSave,
  restoreFocus,
}: RenameBoardDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const canSave = !blocked && title.trim().length > 0;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSave) {
      onSave(title.trim());
    }
  }

  return (
    <div className="studio-workbench-rename-dialog">
      <Dialog
        open
        title="重命名作品"
        closeLabel="关闭弹窗"
        initialFocus={() => input.current?.focus()}
        restoreFocus={restoreFocus}
        dismissPolicy={{ backdrop: true }}
        onRequestClose={onClose}
      >
        <form onSubmit={handleSubmit}>
          <ManagementStatus management={management} />
          <label className="studio-workbench-rename-label" htmlFor={inputId}>
            作品名称
          </label>
          <input
            ref={input}
            className="studio-workbench-rename-field"
            id={inputId}
            maxLength={maxTitleLength}
            value={title}
            readOnly={management.blocked}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              management.dismiss();
            }}
          />
          <div className="studio-workbench-rename-actions">
            <Button label="取消" onActivate={onClose} />
            <Button label="保存" type="submit" variant="primary" disabled={!canSave} />
          </div>
        </form>
      </Dialog>
    </div>
  );
}
