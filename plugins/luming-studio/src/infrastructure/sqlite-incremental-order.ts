export interface UnitReference {
  id: string;
  hash: string;
}

export interface OrderedUnitReference extends UnitReference {
  ordinal: number;
}

const ORDER_GAP = 1024;

function orderAnchors(units: readonly UnitReference[], previous: ReadonlyMap<string, number>) {
  const ends: number[] = [];
  const ordinals: number[] = [];
  const parents: number[] = [];
  for (const [index, unit] of units.entries()) {
    const ordinal = previous.get(unit.id);
    if (ordinal === undefined) {
      continue;
    }

    let left = 0;
    let right = ordinals.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (ordinals[middle]! < ordinal) {
        left = middle + 1;
      } else {
        right = middle;
      }
    }
    parents[index] = left ? ends[left - 1]! : -1;
    ordinals[left] = ordinal;
    ends[left] = index;
  }

  const anchors: number[] = [];
  for (let last = ends.at(-1) ?? -1; last >= 0; last = parents[last]!) {
    anchors.push(last);
  }

  return anchors.reverse();
}

function labelRange(
  labels: number[],
  left: number,
  right: number,
  low: number,
  high: number | undefined,
): void {
  const step =
    high === undefined ? ORDER_GAP : Math.min(ORDER_GAP, Math.floor((high - low) / (right - left)));

  for (let index = left + 1; index < right; index++) {
    labels[index] = low + (index - left) * step;
  }
}

export function orderUnits(
  units: readonly UnitReference[],
  baseline: readonly OrderedUnitReference[],
): OrderedUnitReference[] {
  const previous = new Map(baseline.map((unit) => [unit.id, unit.ordinal]));
  const anchors = orderAnchors(units, previous);
  const labels: number[] = [];
  let left = -1;
  let low = anchors.length
    ? previous.get(units[anchors[0]!]!.id)! - (anchors[0]! + 1) * ORDER_GAP
    : 0;

  for (const right of anchors) {
    const high = previous.get(units[right]!.id)!;
    if (high - low < right - left) {
      continue;
    }

    labelRange(labels, left, right, low, high);
    labels[right] = high;
    left = right;
    low = high;
  }
  labelRange(labels, left, units.length, low, undefined);

  const safe = labels.every(Number.isSafeInteger);
  return units.map((unit, index) => ({
    ...unit,
    ordinal: safe ? labels[index]! : (index + 1) * ORDER_GAP,
  }));
}
