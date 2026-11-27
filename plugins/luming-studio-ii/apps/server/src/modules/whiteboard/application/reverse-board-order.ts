import { sameReversalValue } from './reverse-board-fields.js';

interface OrderChange {
  readonly current: readonly string[];
  readonly desired: readonly string[];
  readonly expected?: readonly string[];
  readonly existing: ReadonlySet<string>;
}

function reverseExplicitOrder({ current, desired, expected = [], existing }: OrderChange) {
  const originallyPresent = new Set(expected);
  const live = new Set(current);
  const actual = current.filter((id) => originallyPresent.has(id));
  if (
    !sameReversalValue(
      actual,
      expected.filter((id) => live.has(id)),
    )
  ) {
    return undefined;
  }

  const replacement = desired.filter((id) => live.has(id) && existing.has(id));
  const sequence = replacement.values();
  const order: string[] = [];
  for (const id of current) {
    if (originallyPresent.has(id)) {
      const next = sequence.next().value;
      if (next !== undefined) {
        order.push(next);
      }
    } else if (existing.has(id)) {
      order.push(id);
    }
  }

  return reinsertRestoredObjects({ current: [...order, ...sequence], desired, existing });
}

function reinsertRestoredObjects({ current, desired, existing }: OrderChange) {
  const live = new Set(current);
  const restored = new Map<string | undefined, string[]>();
  let anchor: string | undefined;
  for (const id of desired) {
    if (!existing.has(id)) {
      continue;
    }

    if (live.has(id)) {
      anchor = id;
      continue;
    }

    const related = restored.get(anchor) ?? [];
    related.push(id);
    restored.set(anchor, related);
  }

  return [
    ...(restored.get(undefined) ?? []),
    ...current.filter((id) => existing.has(id)).flatMap((id) => [id, ...(restored.get(id) ?? [])]),
  ];
}

export function planReverseOrder(change: OrderChange) {
  return change.expected ? reverseExplicitOrder(change) : reinsertRestoredObjects(change);
}
