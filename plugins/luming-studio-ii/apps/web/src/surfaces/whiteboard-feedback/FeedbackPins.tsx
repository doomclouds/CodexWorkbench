import { Check } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { FeedbackPoint, FeedbackTarget, FeedbackThread } from '../../data/feedback/index.js';
import type { FeedbackCanvasObject, FeedbackViewport } from './contracts.js';
import {
  feedbackAuthorColors,
  FeedbackAuthorGlyph,
  feedbackAuthorName,
} from './feedback-author.js';
import { locateAnchor, locateDraft, screenPoint, worldPoint } from './geometry.js';

interface FeedbackPinsProps {
  readonly threads: readonly FeedbackThread[];
  readonly selectedThreadId?: string;
  readonly draft?: FeedbackTarget;
  readonly objects: ReadonlyMap<string, FeedbackCanvasObject>;
  readonly viewport: FeedbackViewport;
  readonly picking: boolean;
  readonly onThread: (thread: FeedbackThread, trigger: HTMLButtonElement) => void;
  readonly onPick: (point: FeedbackPoint) => void;
  readonly onCancelPicking: () => void;
}

function pinLabel(thread: FeedbackThread) {
  const author = feedbackAuthorName(thread.first);
  const status = thread.status === 'resolved' ? '（已解决）' : '';

  return author + status + '：' + thread.first.text.slice(0, 80);
}

export function FeedbackPins({
  threads,
  selectedThreadId,
  draft,
  objects,
  viewport,
  picking,
  onThread,
  onPick,
  onCancelPicking,
}: FeedbackPinsProps) {
  const draftPoint = draft && locateDraft(draft, objects);

  function handlePickPoint(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    onPick(worldPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewport));
  }

  return (
    <>
      {threads.map((thread) => (
        <button
          type="button"
          className="whiteboard-feedback__pin"
          data-resolved={thread.status === 'resolved' || undefined}
          data-selected={thread.id === selectedThreadId || undefined}
          data-feedback-pin={thread.id}
          data-comment-author={feedbackAuthorName(thread.first)}
          key={thread.id}
          aria-label={'备注 ' + pinLabel(thread)}
          title={pinLabel(thread)}
          style={{
            ...screenPoint(locateAnchor(thread.anchor, objects), viewport),
            ...feedbackAuthorColors(thread.first.authorId),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => onThread(thread, event.currentTarget)}
        >
          <FeedbackAuthorGlyph author={thread.first} />
          {thread.status === 'resolved' && (
            <span className="whiteboard-feedback__pin-check" aria-hidden="true">
              <Check size={9} strokeWidth={3} />
            </span>
          )}
        </button>
      ))}
      {draftPoint && (
        <span
          className="whiteboard-feedback__pin whiteboard-feedback__draft-pin"
          style={screenPoint(draftPoint, viewport)}
          aria-hidden="true"
        >
          <FeedbackAuthorGlyph />
        </span>
      )}
      {picking && (
        <button
          type="button"
          className="whiteboard-feedback__pick-area"
          tabIndex={-1}
          aria-label="在白板选取备注位置"
          onClick={handlePickPoint}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onCancelPicking();
            }
          }}
        />
      )}
    </>
  );
}
