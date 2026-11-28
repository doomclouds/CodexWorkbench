import type { FeedbackPoint } from '../../data/feedback/index.js';

export const commentPinSize = 28;
export const commentPopupGutter = 8;
export const commentsPanelWidth = 360;
export const commentPopupWidth = 330;

interface LayerSize {
  readonly width: number;
  readonly height: number;
}

interface ListPlacement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
  readonly arrow: number;
  readonly above: boolean;
}

export function placeCommentsList(
  anchor: DOMRectReadOnly,
  size: LayerSize,
  viewport: LayerSize,
): ListPlacement {
  const margin = 12;
  const availableGap = 22;
  const anchorGap = 10;
  const below = Math.max(0, viewport.height - anchor.bottom - availableGap);
  const above = Math.max(0, anchor.top - availableGap);
  const useAbove = size.height > below && above > below;
  const maxHeight = useAbove ? above : below;
  const left = Math.max(
    margin,
    Math.min(anchor.right - size.width, viewport.width - size.width - margin),
  );

  return {
    left,
    top: useAbove
      ? anchor.top - anchorGap - Math.min(size.height, maxHeight)
      : anchor.bottom + anchorGap,
    maxHeight,
    arrow: Math.max(16, Math.min(size.width - 16, anchor.left + anchor.width / 2 - left)),
    above: useAbove,
  };
}

export function placeComment(point: FeedbackPoint, size: LayerSize, viewport: LayerSize) {
  const gutter = commentPopupGutter;
  const gap = 6;
  const pinTop = point.y - commentPinSize;
  const right = point.x + commentPinSize + gap;
  const left = point.x - size.width - gap;
  const fitsRight = right + size.width + gutter <= viewport.width;
  const fitsLeft = left >= gutter;
  const maxHeight = Math.max(
    0,
    Math.min(Math.max(320, viewport.height * 0.6), viewport.height - gutter * 2),
  );

  if (fitsRight || fitsLeft) {
    const roomBelow = viewport.height - pinTop;
    const above = roomBelow < 320 && pinTop > roomBelow;
    const top = above ? point.y - size.height : pinTop - 2;

    return {
      left: fitsRight
        ? Math.max(gutter, right)
        : Math.min(left, viewport.width - size.width - gutter),
      top: Math.max(gutter, Math.min(top, viewport.height - size.height - gutter)),
      maxHeight,
    };
  }

  const roomAbove = pinTop - gap - gutter;
  const roomBelow = viewport.height - point.y - gap - gutter;
  const above = roomBelow < size.height && roomAbove > roomBelow;
  const heightLimit = Math.min(maxHeight, Math.max(48, above ? roomAbove : roomBelow));
  const height = Math.min(size.height, heightLimit);
  const top = above ? pinTop - gap - height : point.y + gap;

  return {
    left: Math.max(gutter, Math.min(point.x, viewport.width - size.width - gutter)),
    top: Math.max(gutter, Math.min(top, viewport.height - height - gutter)),
    maxHeight: heightLimit,
  };
}
