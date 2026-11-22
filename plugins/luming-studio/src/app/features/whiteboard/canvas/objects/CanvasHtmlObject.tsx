import { memo, useMemo, type ComponentProps } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import HtmlRegion from '../../../../shared/html-region/HtmlRegion.js';
import { anchorBounds, type Point } from '../scene/canvas-model.js';
import { useCommittedRef } from '../useCommittedRef.js';

type HtmlRegionProps = ComponentProps<typeof HtmlRegion>;
interface CanvasHtmlObjectProps extends Omit<
  HtmlRegionProps,
  'element' | 'onPointerPosition' | 'preserveScroll'
> {
  element: BoardElement;
  onCursorMove?: (point: Point | null) => void;
}

type HtmlRegionEvents = Pick<
  HtmlRegionProps,
  | 'onAnnotate'
  | 'onNavigation'
  | 'onPointerPosition'
  | 'onReadingScroll'
  | 'onStateChange'
  | 'onToolShortcut'
  | 'onUseSharedState'
>;

const MountedHtmlRegion = memo(HtmlRegion);

export function CanvasHtmlObject({ onCursorMove, ...region }: CanvasHtmlObjectProps) {
  const current = useCommittedRef({ ...region, onCursorMove });
  const events = useMemo<HtmlRegionEvents>(
    () => ({
      onAnnotate: (selection) => current.current.onAnnotate(selection),
      onNavigation: (input) => current.current.onNavigation?.(input),
      onPointerPosition(point) {
        const { element, onCursorMove: cursor } = current.current;
        const position =
          point &&
          anchorBounds(
            { coordinateSpace: 'element', elementIds: [element.id], x: point.x, y: point.y },
            [element],
          );
        cursor?.(position ? { x: position.x, y: position.y } : null);
      },
      onReadingScroll: (point) => current.current.onReadingScroll?.(point),
      onStateChange: async (state, version) => {
        const save = current.current.onStateChange;
        if (!save) {
          throw new Error('当前视图的编辑权限已变更，未继续发送交互修改。');
        }

        return save(state, version);
      },
      onToolShortcut: (key) => current.current.onToolShortcut?.(key),
      onUseSharedState: () => current.current.onUseSharedState?.(),
    }),
    [current],
  );

  return (
    <MountedHtmlRegion
      {...region}
      preserveScroll
      onAnnotate={events.onAnnotate}
      onNavigation={region.onNavigation && events.onNavigation}
      onPointerPosition={events.onPointerPosition}
      onReadingScroll={region.onReadingScroll && events.onReadingScroll}
      onStateChange={region.onStateChange && events.onStateChange}
      onToolShortcut={region.onToolShortcut && events.onToolShortcut}
      onUseSharedState={region.onUseSharedState && events.onUseSharedState}
    />
  );
}
