import type { ComponentProps } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import HtmlRegion from '../../../../shared/html-region/HtmlRegion.js';
import { anchorBounds, type Point } from '../scene/canvas-model.js';

interface CanvasHtmlObjectProps extends Omit<
  ComponentProps<typeof HtmlRegion>,
  'element' | 'onPointerPosition' | 'preserveScroll'
> {
  element: BoardElement;
  onCursorMove?: (point: Point | null) => void;
}

export function CanvasHtmlObject({ onCursorMove, ...region }: CanvasHtmlObjectProps) {
  function handlePointerPosition(point: Point | null) {
    const position =
      point &&
      anchorBounds(
        { coordinateSpace: 'element', elementIds: [region.element.id], x: point.x, y: point.y },
        [region.element],
      );
    onCursorMove?.(position ? { x: position.x, y: position.y } : null);
  }

  return <HtmlRegion {...region} preserveScroll onPointerPosition={handlePointerPosition} />;
}
