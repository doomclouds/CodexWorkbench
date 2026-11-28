import type { FeedbackThread } from '../../data/feedback/index.js';
import { commentPinSize } from './feedback-layer-position.js';
import type { screenPoint } from './geometry.js';

export interface PositionedFeedbackPin {
  readonly thread: FeedbackThread;
  readonly position: ReturnType<typeof screenPoint>;
}

type FeedbackPinGroup = [PositionedFeedbackPin, ...PositionedFeedbackPin[]];

export function groupFeedbackPins(pins: readonly PositionedFeedbackPin[]) {
  const parents = pins.map((_, index) => index);
  const byLeft = pins
    .map(({ position }, index) => ({ ...position, index }))
    .sort((a, b) => a.left - b.left);

  function root(index: number) {
    let parent = parents[index] ?? index;
    while (parent !== index) {
      index = parent;
      parent = parents[index] ?? index;
    }

    return index;
  }

  for (const [index, pin] of byLeft.entries()) {
    for (let next = index + 1; next < byLeft.length; next++) {
      const neighbor = byLeft[next];
      if (!neighbor || neighbor.left - pin.left >= commentPinSize) {
        break;
      }

      if (Math.abs(neighbor.top - pin.top) < commentPinSize) {
        parents[root(neighbor.index)] = root(pin.index);
      }
    }
  }

  const groups = new Map<number, FeedbackPinGroup>();
  for (const [index, pin] of pins.entries()) {
    const id = root(index);
    const group = groups.get(id);
    if (group) {
      group.push(pin);
    } else {
      groups.set(id, [pin]);
    }
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.thread.first.createdAt - b.thread.first.createdAt);
  }

  return groups.values();
}
