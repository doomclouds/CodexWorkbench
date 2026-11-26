import { X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { Button, StatusText } from '../../ui/base/index.js';
import { FeedbackPopup } from './FeedbackPopup.js';

type SaveProgress =
  | { readonly kind: 'saving' }
  | { readonly kind: 'unknown'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

interface FeedbackSaveNoticeProps {
  readonly progress?: SaveProgress;
  readonly onRetry: () => void;
  readonly onCheck: () => void;
}

interface FeedbackPanelProps extends FeedbackSaveNoticeProps {
  readonly anchor?: HTMLElement | null;
  readonly canvas: RefObject<HTMLDivElement | null>;
  readonly onClose: () => void;
  readonly restoreFocus: () => void;
  readonly children: ReactNode;
}

export function FeedbackSaveNotice({ progress, onRetry, onCheck }: FeedbackSaveNoticeProps) {
  switch (progress?.kind) {
    case undefined:
      return null;
    case 'saving':
      return <StatusText message="正在确认备注保存…" announcement="polite" />;
    case 'error':
      return <StatusText message={progress.message} tone="error" announcement="assertive" />;
    case 'unknown':
      return (
        <div className="whiteboard-feedback__notice">
          <StatusText
            message={'尚未确认保存结果。' + progress.message}
            tone="warning"
            announcement="assertive"
          />
          <div className="whiteboard-feedback__actions">
            <Button label="查询原回执" onActivate={onCheck} />
            <Button label="重试本次保存" onActivate={onRetry} />
          </div>
        </div>
      );
  }
}

export function FeedbackPanel({
  anchor,
  canvas,
  onClose,
  restoreFocus,
  progress,
  onRetry,
  onCheck,
  children,
}: FeedbackPanelProps) {
  return (
    <FeedbackPopup
      kind="list"
      label="所有备注"
      anchor={anchor}
      canvas={canvas}
      onClose={onClose}
      restoreFocus={restoreFocus}
    >
      <section className="whiteboard-feedback__panel" aria-label="备注列表面板">
        <header className="whiteboard-feedback__header">
          <h2>所有备注</h2>
          <button
            type="button"
            className="whiteboard-feedback__icon"
            aria-label="关闭所有备注"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <FeedbackSaveNotice progress={progress} onRetry={onRetry} onCheck={onCheck} />
        {children}
      </section>
    </FeedbackPopup>
  );
}
