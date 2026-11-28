import {
  ArrowLeft,
  ChevronDown,
  Clock3,
  Maximize,
  MessageSquare,
  Moon,
  Share2,
  Sun,
} from 'lucide-react';
import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type { GeometryToolbarProps } from './GeometryToolbar.js';
import type { WhiteboardEditorFeatures } from './board-features.js';
import type { BoardTitleEditor } from './use-board-title.js';
import './board-chrome.css';

export { GeometryToolbar as BoardToolbar } from './GeometryToolbar.js';

export type BoardTool = GeometryToolbarProps['tool'];

interface BoardHeaderProps {
  readonly title: string;
  readonly status: ReactNode;
  readonly participants?: ReactNode;
  readonly canManage?: boolean;
  readonly onBack?: () => void;
  readonly titleEditor?: BoardTitleEditor;
  readonly theme?: WhiteboardEditorFeatures['theme'];
  readonly onOpenHistory?: (trigger: HTMLButtonElement) => void;
  readonly historyOpen?: boolean;
  readonly onOpenShare?: (trigger: HTMLButtonElement) => void;
  readonly shareOpen?: boolean;
  readonly lanSharing?: boolean;
  readonly consumeShareEntry?: () => boolean;
  readonly onToggleFeedback?: (trigger: HTMLButtonElement) => void;
  readonly feedbackOpen?: boolean;
  readonly annotationActive?: boolean;
  readonly onToggleAnnotation?: () => void;
  readonly unresolvedFeedback?: boolean;
}

type BoardTitleProps = Pick<BoardHeaderProps, 'title' | 'titleEditor'>;
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
const lanSharingLabel = '局域网共享已开启';
const titleLimit = 200;

function BoardTitle({ title, titleEditor }: BoardTitleProps) {
  const skipBlur = useRef(false);

  function handleTitleBlur() {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }

    titleEditor?.submit();
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !titleEditor || titleEditor.saving) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      skipBlur.current = true;
      titleEditor.submit(true);
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      skipBlur.current = true;
      titleEditor.discard();
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
      value={titleEditor?.draft ?? title}
      readOnly={!titleEditor || titleEditor.saving}
      onChange={(event) => titleEditor?.change(event.currentTarget.value)}
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

function BoardThemeButton({ theme }: Pick<BoardHeaderProps, 'theme'>) {
  if (!theme) {
    return null;
  }

  const dark = theme.resolvedTheme === 'dark';
  const label = dark ? '切换为明亮主题' : '切换为暗色主题';

  return (
    <button
      className="whiteboard-chrome__action"
      aria-label={label}
      title={label}
      type="button"
      onClick={() => theme.onThemeChange(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

export function BoardHeader({
  title,
  status,
  participants,
  onBack,
  titleEditor,
  theme,
  canManage = onBack !== undefined || titleEditor !== undefined,
  onOpenHistory,
  historyOpen = false,
  onOpenShare,
  shareOpen = false,
  lanSharing = false,
  consumeShareEntry,
  onToggleFeedback,
  feedbackOpen,
  annotationActive,
  onToggleAnnotation,
  unresolvedFeedback,
}: BoardHeaderProps) {
  const shareButton = useRef<HTMLButtonElement>(null);
  const canOpenOnEntry = Boolean(onOpenShare && consumeShareEntry);
  const shareHint = onOpenShare ? '分享（可导出本地副本）' : '当前白板服务暂未接通分享';
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
            aria-label="返回 Luming Studio II"
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        {!canManage && <Share2 className="whiteboard-chrome__guest" size={22} aria-hidden="true" />}
        <BoardTitle title={title} titleEditor={canManage ? titleEditor : undefined} />
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
        <BoardThemeButton theme={theme} />
        <button
          ref={shareButton}
          className="whiteboard-chrome__action whiteboard-chrome__share"
          aria-label="分享"
          aria-description={lanSharing ? lanSharingLabel : undefined}
          title={lanSharing ? lanSharingLabel : shareHint}
          aria-expanded={onOpenShare ? shareOpen : undefined}
          aria-haspopup={onOpenShare ? 'dialog' : undefined}
          type="button"
          disabled={!onOpenShare}
          onClick={(event) => onOpenShare?.(event.currentTarget)}
        >
          <Share2 size={19} />
          <span className="whiteboard-chrome__share-label">分享</span>
          {lanSharing && <span className="whiteboard-chrome__lan-dot" aria-hidden="true" />}
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
