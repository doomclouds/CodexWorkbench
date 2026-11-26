import { useEffect } from 'react';

import { OperationNotice } from '../../../ui/base/index.js';
import './operation-notice.css';

export interface ShellOperationNotice {
  readonly kind: 'error' | 'success';
  readonly message: string;
}

interface OperationNoticeSlotProps {
  readonly notice: ShellOperationNotice;
  readonly onDismiss: () => void;
}

const successNoticeDuration = 6_000;

export function OperationNoticeSlot({ notice, onDismiss }: OperationNoticeSlotProps) {
  useEffect(() => {
    if (notice.kind !== 'success') {
      return;
    }

    const timer = setTimeout(onDismiss, successNoticeDuration);

    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  const failed = notice.kind === 'error';

  return (
    <div className="studio-shell-operation-notice" data-placement={failed ? 'banner' : 'toast'}>
      <OperationNotice
        id="studio-operation-notice"
        level={notice.kind}
        message={notice.message}
        presentation={failed ? 'banner' : 'toast'}
        dismissible
        dismissLabel={failed ? '关闭错误' : '关闭通知'}
        onDismiss={onDismiss}
      />
    </div>
  );
}
