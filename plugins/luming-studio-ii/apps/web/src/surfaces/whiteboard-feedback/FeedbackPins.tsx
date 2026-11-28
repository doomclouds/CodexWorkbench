import { Check } from 'lucide-react';
import { Fragment, useContext, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';
import type { FeedbackPoint, FeedbackThread } from '../../data/feedback/index.js';
import { FeedbackPinCluster } from './FeedbackPinCluster.js';
import type {
  FeedbackCanvasObject,
  FeedbackViewport,
  WhiteboardFeedbackSurfaceProps,
} from './contracts.js';
import {
  feedbackAuthorColors,
  FeedbackAuthorColor,
  FeedbackAuthorGlyph,
  feedbackAuthorName,
} from './feedback-author.js';
import { commentPinSize } from './feedback-layer-position.js';
import { groupFeedbackPins, type PositionedFeedbackPin } from './feedback-pin-groups.js';
import { locateAnchor, screenPoint, worldPoint } from './geometry.js';

interface FeedbackPinsProps {
  readonly canvas: RefObject<HTMLDivElement | null>;
  readonly threads: readonly FeedbackThread[];
  readonly selectedThreadId?: string;
  readonly draftPoint?: FeedbackPoint;
  readonly selectedThreadPoint?: FeedbackPoint;
  readonly viewerActorId?: string;
  readonly objects: ReadonlyMap<string, FeedbackCanvasObject>;
  readonly contentPoints?: ReadonlyMap<string, FeedbackPoint>;
  readonly contentLocations?: WhiteboardFeedbackSurfaceProps['contentLocations'];
  readonly focusedObjectId?: string;
  readonly viewport: FeedbackViewport;
  readonly viewportSize?: WhiteboardFeedbackSurfaceProps['viewportSize'];
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

function pinIntersects(
  { left, top }: ReturnType<typeof screenPoint>,
  size: FeedbackPinsProps['viewportSize'],
) {
  return (
    !size ||
    (left < size.width &&
      left + commentPinSize > 0 &&
      top > 0 &&
      top - commentPinSize < size.height)
  );
}

export function FeedbackPins({
  canvas,
  threads,
  selectedThreadId,
  draftPoint,
  selectedThreadPoint,
  viewerActorId,
  objects,
  contentPoints,
  contentLocations,
  focusedObjectId,
  viewport,
  viewportSize,
  picking,
  onThread,
  onPick,
  onCancelPicking,
}: FeedbackPinsProps) {
  const [openCluster, setOpenCluster] = useState<string>();
  const colorFor = useContext(FeedbackAuthorColor);
  const visibleThreads = threads.flatMap((thread) => {
    const { id, anchor } = thread;
    const { target, targetMissing } = anchor;
    const inView =
      !focusedObjectId || ('objectId' in target && target.objectId === focusedObjectId);
    const clipped =
      target.kind === 'content' &&
      !targetMissing &&
      objects.has(target.objectId) &&
      contentLocations?.get(id)?.point === null;

    if (!inView || clipped) {
      return [];
    }

    const point =
      (id === selectedThreadId ? selectedThreadPoint : undefined) ??
      locateAnchor(anchor, objects, contentLocations?.get(id)?.point ?? contentPoints?.get(id));
    const position = screenPoint(point, viewport);

    return pinIntersects(position, viewportSize) ? [{ thread, position }] : [];
  });
  const draftPosition = draftPoint && screenPoint(draftPoint, viewport);
  const groups = Array.from(groupFeedbackPins(visibleThreads), (pins) => ({
    pins,
    id: pins.length > 1 ? JSON.stringify(pins.map(({ thread }) => thread.id).sort()) : undefined,
    selected: pins.find(({ thread }) => thread.id === selectedThreadId),
  }));

  if (openCluster && !groups.some(({ id, selected }) => id === openCluster && !selected)) {
    setOpenCluster(undefined);
  }

  function handlePickPoint(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    onPick(worldPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewport));
  }

  function renderPin({ thread, position }: PositionedFeedbackPin) {
    return (
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
        style={{ ...position, ...feedbackAuthorColors(colorFor, thread.first.authorId) }}
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
    );
  }

  return (
    <div className="whiteboard-feedback__pin-layer">
      {groups.map(({ id, pins, selected }) => {
        const first = pins[0];
        if (!id) {
          return renderPin(first);
        }

        return (
          <Fragment key={id}>
            <FeedbackPinCluster
              pins={pins}
              position={first.position}
              canvas={canvas}
              hidden={Boolean(selected)}
              open={openCluster === id}
              onToggle={() => setOpenCluster((current) => (current === id ? undefined : id))}
              onClose={() => setOpenCluster((current) => (current === id ? undefined : current))}
              onThread={onThread}
            />
            {selected && renderPin(selected)}
          </Fragment>
        );
      })}
      {draftPosition && pinIntersects(draftPosition, viewportSize) && (
        <span
          className="whiteboard-feedback__pin whiteboard-feedback__draft-pin"
          style={{ ...draftPosition, ...feedbackAuthorColors(colorFor, viewerActorId) }}
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
    </div>
  );
}
