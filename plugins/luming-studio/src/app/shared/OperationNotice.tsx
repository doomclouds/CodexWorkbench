import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './operation-notice.css';

export const OperationNoticeTarget = createContext<HTMLDivElement | null>(null);

interface Props {
  source: string;
  message: string;
  actions?: ReactNode;
  closeLabel?: string;
  onClose?: () => void;
  fallbackClass?: string;
  fallbackStyle?: CSSProperties;
}

export default function OperationNotice({
  source,
  message,
  actions,
  closeLabel = '关闭通知',
  onClose,
  fallbackClass,
  fallbackStyle,
}: Props) {
  const target = useContext(OperationNoticeTarget);
  const [closedMessage, setClosedMessage] = useState<string>();
  const closed = closedMessage === message;
  const handleClose = () => {
    if (actions) {
      setClosedMessage(message);
    } else if (onClose) {
      onClose();
    } else {
      setClosedMessage(message);
    }
  };

  if (closed && !actions) {
    return null;
  }

  const body = closed ? (
    <button
      type="button"
      className="studio-operation-notice-reopen"
      onClick={() => setClosedMessage(undefined)}
    >
      查看{source}通知
    </button>
  ) : (
    <div
      role="alert"
      data-native-interactive="true"
      className={target ? 'studio-operation-notice' : fallbackClass || 'studio-operation-notice'}
      style={target ? undefined : fallbackStyle}
    >
      <div className="studio-operation-notice-copy">
        <strong>{source}</strong>
        <span>{message}</span>
      </div>
      {actions && <div className="studio-operation-notice-actions">{actions}</div>}
      <button
        type="button"
        className="studio-icon-button studio-operation-notice-close"
        aria-label={closeLabel}
        onClick={handleClose}
      >
        <X size={16} />
      </button>
    </div>
  );

  return target ? createPortal(body, target) : body;
}
