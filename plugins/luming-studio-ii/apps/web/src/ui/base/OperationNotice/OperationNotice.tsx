import { Button } from '../Button/Button.js';
import { Glyph } from '../Glyph/Glyph.js';
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
  presentation?: 'card' | 'banner' | 'toast';
  actions?: readonly OperationNoticeAction[];
  dismissible?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
}

type NoticeIcon = 'error' | 'success' | 'close';

function NoticeMark({ icon, size }: { readonly icon: NoticeIcon; readonly size: number }) {
  return (
    <Glyph size={size}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon === 'error' && (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </>
        )}
        {icon === 'success' && <path d="m20 6-11 11-5-5" />}
        {icon === 'close' && <path d="M18 6 6 18M6 6l12 12" />}
      </svg>
    </Glyph>
  );
}

interface NoticeDismissProps {
  readonly compact: boolean;
  readonly label: string;
  readonly onDismiss: () => void;
}

function NoticeDismiss({ compact, label, onDismiss }: NoticeDismissProps) {
  if (compact) {
    return (
      <button
        type="button"
        className="studio-ui-operation-notice__compact-close"
        aria-label={label}
        onClick={onDismiss}
      >
        <NoticeMark icon="close" size={14} />
      </button>
    );
  }

  return <Button label={label} variant="ghost" onActivate={onDismiss} />;
}

export function OperationNotice({
  id,
  level,
  message,
  presentation = 'card',
  actions = [],
  dismissible = false,
  dismissLabel = '关闭通知',
  onDismiss,
}: OperationNoticeProps) {
  const canDismiss = dismissible && onDismiss !== undefined;
  const hasControls = actions.length > 0 || canDismiss;
  const compact = presentation !== 'card';
  const statusIcon = level === 'error' || level === 'success' ? level : undefined;

  return (
    <div
      id={id}
      data-level={level}
      data-presentation={compact ? presentation : undefined}
      className="studio-ui-operation-notice"
    >
      {compact && statusIcon && (
        <NoticeMark icon={statusIcon} size={presentation === 'banner' ? 17 : 15} />
      )}
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
          {canDismiss && (
            <NoticeDismiss compact={compact} label={dismissLabel} onDismiss={onDismiss} />
          )}
        </div>
      )}
    </div>
  );
}
