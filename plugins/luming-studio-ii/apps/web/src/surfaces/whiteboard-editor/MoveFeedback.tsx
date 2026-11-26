import { Check } from 'lucide-react';
import { OperationNotice, StatusText } from '../../ui/base/index.js';
import type { useMoveSession } from './move-session.js';

interface MoveFeedbackProps {
  readonly controls: ReturnType<typeof useMoveSession>;
}

export function MoveStatus({ controls }: MoveFeedbackProps) {
  switch (controls.state.kind) {
    case 'saving':
      return <StatusText message="保存中" busy announcement="polite" />;
    case 'checking':
      return <StatusText message="正在查询回执" busy announcement="polite" />;
    case 'idle':
    case 'saved':
      return (
        <span className="whiteboard-editor__saved" role="status">
          <Check size={13} />
          已保存
        </span>
      );
    case 'conflict':
    case 'rejected':
    case 'unknown':
    case 'unsupported':
      return null;
  }
}

export function MoveNotice({ controls }: MoveFeedbackProps) {
  const { state, retryMove, checkReceipt, canRetry } = controls;

  switch (state.kind) {
    case 'unknown':
      return (
        <OperationNotice
          id="whiteboard-move-unknown"
          level="warning"
          message={'保存结果未知。' + state.detail}
          actions={[
            { id: 'check-receipt', label: '查询回执', onActivate: checkReceipt },
            { id: 'retry-move', label: '重试原移动', disabled: !canRetry, onActivate: retryMove },
          ]}
        />
      );
    case 'conflict':
      return (
        <OperationNotice
          id="whiteboard-move-conflict"
          level="warning"
          message={'移动冲突。' + state.detail}
        />
      );
    case 'rejected':
      return (
        <OperationNotice
          id="whiteboard-move-rejected"
          level="error"
          message={'移动未保存。' + state.detail}
        />
      );
    case 'unsupported':
      return (
        <OperationNotice id="whiteboard-edit-unsupported" level="info" message={state.detail} />
      );
    case 'checking':
    case 'idle':
    case 'saved':
    case 'saving':
      return null;
  }
}
