import { ArrowLeft, ChevronDown, Clock3, Maximize, MessageSquare, Share2 } from 'lucide-react';
import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type { GeometryToolbarProps } from './GeometryToolbar.js';
import './board-chrome.css';

export { GeometryToolbar as BoardToolbar } from './GeometryToolbar.js';

export type BoardTool = GeometryToolbarProps['tool'];

interface BoardHeaderProps {
  readonly title: string;
  readonly status: ReactNode;
  readonly participants?: ReactNode;
  readonly canManage?: boolean;
  readonly onBack?: () => void;
  readonly onRename?: (title: string) => void;
  readonly onOpenHistory?: (trigger: HTMLButtonElement) => void;
  readonly historyOpen?: boolean;
  readonly onOpenShare?: (trigger: HTMLButtonElement) => void;
  readonly shareOpen?: boolean;
  readonly consumeShareEntry?: () => boolean;
  readonly onToggleFeedback?: (trigger: HTMLButtonElement) => void;
  readonly feedbackOpen?: boolean;
  readonly annotationActive?: boolean;
  readonly onToggleAnnotation?: () => void;
  readonly unresolvedFeedback?: boolean;
}

type BoardTitleProps = Pick<BoardHeaderProps, 'title' | 'onRename'>;
type FeedbackToolsProps = Pick<
  BoardHeaderProps,
  | 'onToggleFeedback'
  | 'feedbackOpen'
  | 'annotationActive'
  | 'onToggleAnnotation'
  | 'unresolvedFeedback'
>;

export function BoardDocumentChrome(props: FeedbackToolsProps) {
  return (
    <header className="whiteboard-chrome whiteboard-chrome--document">
      <FeedbackTools {...props} />
    </header>
  );
}

const unavailable = '当前白板服务暂未提供此操作';
const titleLimit = 200;

function BoardTitle({ title, onRename }: BoardTitleProps) {
  const [edit, setEdit] = useState({ title, draft: title });
  const cancelled = useRef(false);
  if (edit.title !== title) {
    setEdit({ title, draft: title });
  }

  function changeTitle(draft: string) {
    setEdit({ title, draft });
  }

  function handleTitleBlur() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (!onRename) {
      return;
    }

    const normalized = edit.draft.trim();
    changeTitle(title);
    if (normalized && normalized !== title) {
      onRename(normalized);
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !onRename) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      changeTitle(title);
      event.currentTarget.blur();
    }
  }

  return (
    <input
      className="whiteboard-chrome__name"
      type="text"
      aria-label="白板名称"
      title={title}
      maxLength={titleLimit}
      value={onRename ? edit.draft : title}
      readOnly={!onRename}
      onChange={(event) => changeTitle(event.currentTarget.value)}
      onBlur={handleTitleBlur}
      onKeyDown={handleTitleKeyDown}
    />
  );
}

function handleAnnotationPointer(event: PointerEvent<HTMLButtonElement>) {
  if (event.button === 0) {
    event.preventDefault();
  }
}

function FeedbackTools({
  onToggleFeedback,
  feedbackOpen = false,
  annotationActive = false,
  onToggleAnnotation,
  unresolvedFeedback = false,
}: FeedbackToolsProps) {
  return (
    <div className="whiteboard-chrome__comments">
      <button
        className="whiteboard-chrome__action whiteboard-chrome__annotation"
        aria-label="备注"
        title={onToggleAnnotation ? '备注（9）：点击目标添加备注' : unavailable}
        aria-keyshortcuts="9"
        aria-pressed={annotationActive}
        type="button"
        disabled={!onToggleAnnotation}
        onPointerDown={handleAnnotationPointer}
        onClick={onToggleAnnotation}
      >
        <MessageSquare size={20} fill={annotationActive ? 'currentColor' : 'none'} />
      </button>
      <button
        className="whiteboard-chrome__action whiteboard-chrome__comment-list"
        aria-label="备注列表"
        aria-description={unresolvedFeedback ? '有未解决备注' : undefined}
        aria-expanded={feedbackOpen}
        title={onToggleFeedback ? '备注列表' : unavailable}
        type="button"
        disabled={!onToggleFeedback}
        onClick={(event) => onToggleFeedback?.(event.currentTarget)}
      >
        <ChevronDown size={15} />
        {unresolvedFeedback && (
          <span className="whiteboard-chrome__comment-dot" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function BoardHeader({
  title,
  status,
  participants,
  onBack,
  onRename,
  canManage = onBack !== undefined || onRename !== undefined,
  onOpenHistory,
  historyOpen = false,
  onOpenShare,
  shareOpen = false,
  consumeShareEntry,
  onToggleFeedback,
  feedbackOpen,
  annotationActive,
  onToggleAnnotation,
  unresolvedFeedback,
}: BoardHeaderProps) {
  const shareButton = useRef<HTMLButtonElement>(null);
  const canOpenOnEntry = Boolean(onOpenShare && consumeShareEntry);
  const openShareEntry = useEffectEvent(() => {
    const anchor = shareButton.current;
    if (anchor && onOpenShare && consumeShareEntry?.()) {
      onOpenShare(anchor);
    }
  });

  useLayoutEffect(() => {
    if (canOpenOnEntry) {
      openShareEntry();
    }
  }, [canOpenOnEntry]);

  return (
    <header className="whiteboard-chrome">
      <div className="whiteboard-chrome__identity">
        {canManage && onBack && (
          <button
            className="whiteboard-chrome__action whiteboard-chrome__back"
            type="button"
            aria-label="返回 Luming Studio"
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        {!canManage && <Share2 className="whiteboard-chrome__guest" size={22} aria-hidden="true" />}
        <BoardTitle title={title} onRename={canManage ? onRename : undefined} />
        <div className="whiteboard-chrome__status">{status}</div>
      </div>
      <div className="whiteboard-chrome__actions">
        {participants}
        <button
          className="whiteboard-chrome__action"
          aria-label="版本历史"
          aria-expanded={historyOpen}
          title={onOpenHistory ? '版本历史' : unavailable}
          type="button"
          disabled={!onOpenHistory}
          onClick={(event) => onOpenHistory?.(event.currentTarget)}
        >
          <Clock3 size={20} />
        </button>
        <button
          ref={shareButton}
          className="whiteboard-chrome__action whiteboard-chrome__share"
          aria-label="分享"
          title={onOpenShare ? '分享（可导出本地副本）' : '当前白板服务暂未接通分享'}
          aria-expanded={onOpenShare ? shareOpen : undefined}
          aria-haspopup={onOpenShare ? 'dialog' : undefined}
          type="button"
          disabled={!onOpenShare}
          onClick={(event) => onOpenShare?.(event.currentTarget)}
        >
          <Share2 size={19} />
          <span>分享</span>
        </button>
        <FeedbackTools
          onToggleFeedback={onToggleFeedback}
          feedbackOpen={feedbackOpen}
          annotationActive={annotationActive}
          onToggleAnnotation={onToggleAnnotation}
          unresolvedFeedback={unresolvedFeedback}
        />
      </div>
    </header>
  );
}

interface SelectionViewingProps {
  readonly onOpen: (trigger: HTMLButtonElement) => void;
}

export function BoardSelectionViewing({ onOpen }: SelectionViewingProps) {
  return (
    <button
      className="whiteboard-chrome__action whiteboard-chrome__selection-viewing"
      type="button"
      aria-label="全屏观看选区"
      title="全屏观看选区"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <Maximize size={18} />
    </button>
  );
}
