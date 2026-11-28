import { X } from 'lucide-react';
import { useState } from 'react';
import type { RefObject } from 'react';
import type { FeedbackThread } from '../../data/feedback/index.js';
import { FeedbackPopup } from './FeedbackPopup.js';
import { FeedbackAvatar, feedbackAuthorName } from './feedback-author.js';
import { commentPinSize } from './feedback-layer-position.js';
import type { PositionedFeedbackPin } from './feedback-pin-groups.js';

interface FeedbackPinClusterProps {
  readonly pins: readonly PositionedFeedbackPin[];
  readonly position: PositionedFeedbackPin['position'];
  readonly canvas: RefObject<HTMLDivElement | null>;
  readonly hidden: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly onThread: (thread: FeedbackThread, trigger: HTMLButtonElement) => void;
}

function clusterAuthors(pins: readonly PositionedFeedbackPin[]) {
  const authors = new Map<string, FeedbackThread['first']>();
  for (const { thread } of pins) {
    authors.set(thread.first.authorId, thread.first);
    if (authors.size === 2) {
      break;
    }
  }

  return Array.from(authors.values());
}

export function FeedbackPinCluster({
  pins,
  position,
  canvas,
  hidden,
  open,
  onToggle,
  onClose,
  onThread,
}: FeedbackPinClusterProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const label = pins.length + ' 条备注';
  const expanded = open && !hidden;

  function handleThread(thread: FeedbackThread) {
    if (anchor) {
      onClose();
      onThread(thread, anchor);
    }
  }

  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        className="whiteboard-feedback__pin-cluster"
        hidden={hidden}
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        style={{
          left: `clamp(0px, ${position.left}px, calc(100% - 104px))`,
          top: Math.max(commentPinSize, position.top),
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onToggle}
      >
        <span className="whiteboard-feedback__cluster-authors">
          {clusterAuthors(pins).map((author) => (
            <FeedbackAvatar key={author.authorId} author={author} />
          ))}
        </span>
        <span>{pins.length} 条</span>
      </button>
      {expanded && anchor && (
        <FeedbackPopup
          kind="cluster"
          label={label}
          anchor={anchor}
          canvas={canvas}
          onClose={onClose}
          onOutside={onClose}
          restoreFocus={() => {
            if (anchor.isConnected && !anchor.hidden) {
              anchor.focus({ preventScroll: true });
            }
          }}
        >
          <div className="whiteboard-feedback__cluster-content">
            <header className="whiteboard-feedback__cluster-heading">
              <h2>{label}</h2>
              <button
                type="button"
                className="whiteboard-feedback__icon"
                aria-label="关闭重叠备注"
                onClick={onClose}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </header>
            <ul className="whiteboard-feedback__cluster-list" aria-label="重叠的备注">
              {pins.map(({ thread }) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="whiteboard-feedback__cluster-row"
                    onClick={() => handleThread(thread)}
                  >
                    <FeedbackAvatar author={thread.first} />
                    <span className="whiteboard-feedback__cluster-summary">
                      <strong>{feedbackAuthorName(thread.first)}</strong>
                      <span title={thread.first.text}>{thread.first.text}</span>
                      {thread.status === 'resolved' && <small>已解决</small>}
                      {thread.attachment?.state === 'pending' && <small>待附加</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </FeedbackPopup>
      )}
    </>
  );
}
