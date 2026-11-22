import type { ComponentProps, ReactNode } from 'react';
import { FileText } from 'lucide-react';
import type {
  Anchor,
  BoardElement,
  ElementType,
  Feedback,
  Presence,
} from '../../../../../contracts/studio.js';
import { readableText } from '../../../../../shared/theme.js';
import { getBoardSticker } from '../../../../../shared/whiteboard-stickers.js';
import { CommentPin } from '../../../../shared/comments/CommentPin.js';
import { CommentClusters } from '../../../../shared/comments/CommentClusters.js';
import { commentBoardTip } from '../../../../shared/comments/comment-target.js';
import { participantColor } from '../../../../shared/presence-members.js';
import type { PeerGesture } from '../../../../shared/useNativeGestureSync.js';
import type { Tool } from '../controls/CanvasEditingControls.js';
import type { Gesture } from '../interaction/canvas-gesture-placement.js';
import { anchorBounds, makeElement, type Point, type Rect } from './canvas-model.js';
import { geometryBounds, selectionBounds, type AlignmentGuide } from './native-geometry.js';

interface PeerPreviewProps {
  frames: readonly { peer: PeerGesture; bounds: Rect }[];
  presence: readonly Presence[];
  zoom: number;
}

export function CanvasPeerPreviews({ frames, presence, zoom }: PeerPreviewProps) {
  return frames.map(({ peer, bounds }) => {
    const page = presence.find((candidate) => candidate.peerId === peer.peerId);
    const color = participantColor(peer.actor, page?.color);
    return (
      <div
        key={`${peer.peerId}:${peer.id}`}
        aria-label={`${peer.actor.name}${peer.kind === 'upload' ? '正在上传' : '正在调整对象'}`}
        style={{
          position: 'absolute',
          left: bounds.x,
          top: bounds.y,
          width: bounds.w,
          height: bounds.h,
          border: `${1 / zoom}px dashed ${color}`,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            bottom: '100%',
            fontSize: 12 / zoom,
            whiteSpace: 'nowrap',
            color: readableText(color),
            background: color,
          }}
        >
          {peer.actor.name} · {peer.kind === 'upload' ? '正在上传…' : '正在调整'}
        </span>
      </div>
    );
  });
}

interface PlacementProps {
  reading: boolean;
  canEdit: boolean;
  annotating: boolean;
  gesture: Gesture | null;
  pointer: Point | null;
  editing: boolean;
  tool: Tool;
  shapeKind: string;
  sticker: string;
  renderElement: (element: BoardElement) => ReactNode;
}

function renderDocumentPlacement({
  reading,
  canEdit,
  annotating,
  gesture,
  tool,
  pointer,
}: PlacementProps) {
  if (reading || !canEdit || annotating) {
    return null;
  }

  const placingDocument = gesture?.kind === 'create' && gesture.element.type === 'document';
  const showingGhost = tool === 'document' && pointer && !gesture;
  let placement: BoardElement | null = null;
  if (placingDocument) {
    placement = gesture.element;
  } else if (showingGhost) {
    placement = makeElement('document', pointer, { id: 'document-placement-preview' });
  }

  return (
    placement && (
      <div
        className="studio-document-placement"
        data-document-placement="true"
        aria-hidden="true"
        style={{ left: placement.x, top: placement.y, width: placement.w, height: placement.h }}
      >
        <FileText size={18} />
        <span>文档</span>
      </div>
    )
  );
}

function renderPlacementGhost(props: PlacementProps) {
  const {
    pointer,
    gesture,
    editing,
    annotating,
    canEdit,
    tool,
    shapeKind,
    sticker,
    renderElement,
  } = props;

  return (
    pointer &&
    !gesture &&
    !editing &&
    !annotating &&
    canEdit &&
    ['text', 'shape', 'note', 'container', 'table', 'sticker', 'todo'].includes(tool) && (
      <div className="studio-placement-ghost" aria-hidden="true">
        {renderElement(
          makeElement(tool as ElementType, pointer, {
            id: 'placement-ghost',
            text: tool === 'text' ? '文字' : '',
            ...(tool === 'shape' ? { kind: shapeKind } : {}),
            ...(tool === 'sticker'
              ? { text: getBoardSticker(sticker)?.label, data: { stickerIconId: sticker } }
              : {}),
          }),
        )}
      </div>
    )
  );
}

export function CanvasPlacementOverlays(props: PlacementProps) {
  return (
    <>
      {renderDocumentPlacement(props)}
      {renderPlacementGhost(props)}
    </>
  );
}

interface FeedbackOverlayProps {
  activities: readonly Feedback[];
  elements: readonly BoardElement[];
  hover?: BoardElement | null;
  target?: Anchor | null;
  fallbackTarget?: Anchor | null;
  guides: readonly AlignmentGuide[];
  zoom: number;
  onSelect?: ComponentProps<typeof CommentPin>['onSelect'];
}

function renderAnnotationHover({ hover, elements, zoom }: FeedbackOverlayProps) {
  if (!hover || hover.type === 'arrow') {
    return null;
  }

  const bounds = hover.type === 'stroke' ? geometryBounds(hover, elements) : hover;
  return (
    <div
      className="studio-annotation-hover"
      data-annotation-hover={hover.id}
      aria-hidden="true"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        borderWidth: 2 / zoom,
        transform:
          hover.type !== 'stroke' && hover.rotation ? `rotate(${hover.rotation}deg)` : undefined,
      }}
    />
  );
}

function renderCurrentCommentTarget({
  target,
  fallbackTarget,
  elements,
  zoom,
}: FeedbackOverlayProps) {
  const anchor = target ?? fallbackTarget;
  if (!anchor || anchor.regionId || anchor.coordinateSpace === 'html') {
    return null;
  }

  const ids = anchor.elementIds ?? [];
  const nativeElement =
    ids.length === 1
      ? elements.find(
          (element) =>
            element.id === ids[0] && element.type !== 'arrow' && element.type !== 'stroke',
        )
      : undefined;
  const bounds =
    nativeElement ?? (ids.length ? selectionBounds(elements, ids) : anchorBounds(anchor, elements));

  return (
    bounds && (
      <div
        className="studio-current-comment-target"
        data-comment-target="true"
        aria-hidden="true"
        style={{
          left: bounds.x,
          top: bounds.y,
          width: Math.max(bounds.w, 12 / zoom),
          height: Math.max(bounds.h, 12 / zoom),
          borderWidth: 2 / zoom,
          transform: nativeElement?.rotation ? `rotate(${nativeElement.rotation}deg)` : undefined,
        }}
      />
    )
  );
}

function renderSnapGuides(guides: readonly AlignmentGuide[], zoom: number) {
  return guides.map((guide, index) => (
    <div
      key={index}
      className="studio-snap-guide"
      style={
        guide.axis === 'x'
          ? {
              left: guide.at,
              top: guide.from,
              height: guide.to - guide.from,
              width: 1 / zoom,
            }
          : {
              top: guide.at,
              left: guide.from,
              width: guide.to - guide.from,
              height: 1 / zoom,
            }
      }
    />
  ));
}

function renderProcessingFeedback({ activities, elements, zoom }: FeedbackOverlayProps) {
  return activities
    .filter((activity) => activity.status === 'processing')
    .map((activity) => {
      const area = (activity.anchor as Anchor & { area?: Rect }).area;
      const frame = area ?? anchorBounds(activity.anchor, elements);
      if (!frame) {
        return null;
      }

      const processor = activity.processingBy?.name || 'Codex';
      return (
        <div
          key={activity.id}
          className="studio-processing-frame"
          data-feedback-id={activity.id}
          role="status"
          aria-label={`${processor} 正在处理此范围`}
          style={{
            left: frame.x - 8,
            top: frame.y - 8,
            width: frame.w + 16,
            height: frame.h + 16,
            borderWidth: 1.5 / zoom,
          }}
        >
          <span style={{ transform: `scale(${1 / zoom})` }}>{processor} 正在处理</span>
        </div>
      );
    });
}

function renderCommentPins({ activities, elements, zoom, onSelect }: FeedbackOverlayProps) {
  return activities.map((feedback) => {
    const tip = commentBoardTip(feedback.anchor, elements);
    return (
      tip && (
        <CommentPin
          key={feedback.id}
          feedback={feedback}
          left={tip.x}
          top={tip.y}
          zoom={zoom}
          onSelect={onSelect}
        />
      )
    );
  });
}

export function CanvasFeedbackOverlays(props: FeedbackOverlayProps) {
  return (
    <>
      {renderAnnotationHover(props)}
      {renderCurrentCommentTarget(props)}
      {renderSnapGuides(props.guides, props.zoom)}
      {renderProcessingFeedback(props)}
      {renderCommentPins(props)}
    </>
  );
}

export function CanvasFeedbackClusters(props: ComponentProps<typeof CommentClusters>) {
  return props.onSelect && props.activities.length > 1 && <CommentClusters {...props} />;
}
