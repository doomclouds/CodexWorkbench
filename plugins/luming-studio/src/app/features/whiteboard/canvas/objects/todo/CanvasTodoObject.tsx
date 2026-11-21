import type { ComponentProps } from 'react';
import type { Feedback } from '../../../../../../contracts/studio.js';
import { CommentPin } from '../../../../../shared/comments/CommentPin.js';
import { TODO_OVERVIEW_PIN_INSET } from '../../../../../shared/comments/comment-target.js';
import TodoRegion, { type TodoRegionProps } from './TodoRegion.js';

interface CanvasTodoObjectProps extends Omit<
  TodoRegionProps,
  'overview' | 'uiScale' | 'renderItemAdornment' | 'renderOutsideRows'
> {
  size: { w: number; h: number };
  zoom: number;
  activities: Feedback[];
  onFeedbackSelect: ComponentProps<typeof CommentPin>['onSelect'];
}

export function CanvasTodoObject({
  size,
  zoom,
  activities,
  onFeedbackSelect,
  ...todo
}: CanvasTodoObjectProps) {
  const rowFeedback = activities.filter(
    (item) =>
      item.anchor.coordinateSpace === 'todo' &&
      item.anchor.elementIds?.[0] === todo.element.id &&
      item.anchor.pin?.coordinateSpace !== 'board',
  );

  function renderItemAdornment(itemId: string) {
    return rowFeedback
      .filter((feedback) => feedback.anchor.itemId === itemId)
      .map((feedback) => {
        const pin =
          feedback.anchor.pin?.coordinateSpace === 'todo'
            ? feedback.anchor.pin
            : { x: 0.97, y: 0.9 };

        return (
          <CommentPin
            key={feedback.id}
            feedback={feedback}
            left={`${pin.x * 100}%`}
            top={`${pin.y * 100}%`}
            zoom={zoom}
            onSelect={onFeedbackSelect}
          />
        );
      });
  }

  function renderOutsideRows(ids: readonly string[]) {
    return rowFeedback
      .filter((feedback) => !ids.includes(feedback.anchor.itemId ?? ''))
      .map((feedback) => (
        <CommentPin
          key={feedback.id}
          feedback={feedback}
          left={`max(0px, calc(100% - ${TODO_OVERVIEW_PIN_INSET.right / zoom}px))`}
          top={`max(0px, calc(100% - ${TODO_OVERVIEW_PIN_INSET.bottom / zoom}px))`}
          zoom={zoom}
          onSelect={onFeedbackSelect}
        />
      ));
  }

  return (
    <TodoRegion
      {...todo}
      overview={size.w < 228 || size.h < 110}
      uiScale={Math.min(1 / zoom, 1.8)}
      renderItemAdornment={renderItemAdornment}
      renderOutsideRows={renderOutsideRows}
    />
  );
}
