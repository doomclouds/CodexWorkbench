import { Button } from '../Button/Button.js';
import { StatusText } from '../StatusText/StatusText.js';
import './OperationNotice.css';

export type OperationNoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface OperationNoticeAction {
  id: string;
  label: string;
  disabled?: boolean;
  onActivate: () => void;
}

export interface OperationNoticeProps {
  id: string;
  level: OperationNoticeLevel;
  message: string;
  actions?: readonly OperationNoticeAction[];
  dismissible?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
}

export function OperationNotice({
  id,
  level,
  message,
  actions = [],
  dismissible = false,
  dismissLabel = '关闭通知',
  onDismiss,
}: OperationNoticeProps) {
  const canDismiss = dismissible && onDismiss !== undefined;
  const hasControls = actions.length > 0 || canDismiss;

  return (
    <div id={id} data-level={level} className="studio-ui-operation-notice">
      <div className="studio-ui-operation-notice__message">
        <StatusText
          message={message}
          tone={level === 'info' ? 'neutral' : level}
          announcement={level === 'error' ? 'assertive' : 'polite'}
        />
      </div>
      {hasControls && (
        <div className="studio-ui-operation-notice__controls">
          {actions.map((action) => (
            <Button
              key={action.id}
              label={action.label}
              disabled={action.disabled}
              onActivate={action.onActivate}
            />
          ))}
          {canDismiss && <Button label={dismissLabel} variant="ghost" onActivate={onDismiss} />}
        </div>
      )}
    </div>
  );
}
