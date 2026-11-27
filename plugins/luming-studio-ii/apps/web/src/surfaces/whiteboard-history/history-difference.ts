import type { WhiteboardObject, WhiteboardPayload } from '../../data/whiteboard/index.js';
import type { HistoryChange } from './history-records.js';

interface DiffLine {
  readonly kind: ' ' | '+' | '-';
  readonly text: string;
}

type DisplayLine = DiffLine | { readonly kind: 'skip'; readonly text: string };

interface HistoryDifference {
  readonly added: number;
  readonly removed: number;
  readonly lines: readonly DisplayLine[];
  readonly large?: boolean;
  readonly truncated?: boolean;
}

const maxTextLength = 1024 * 1024;
const maxComparisonCells = 1_000_000;
const maxDisplayLines = 3000;
const contextLines = 3;
const maxLineLength = 2000;

function printable(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  return ArrayBuffer.isView(value) ? '二进制 · ' + value.byteLength + ' 字节' : value;
}

function bodyValue(payload?: WhiteboardPayload) {
  return payload?.body.kind === 'ink' ? payload.body.points : payload?.body.value;
}

function bodyWithoutText(value: Readonly<Record<string, unknown>>, field: string) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function textChange(
  before: WhiteboardPayload['body'] | undefined,
  after: WhiteboardPayload['body'] | undefined,
): readonly [string, string] | undefined {
  if (!before || !after || before.kind !== after.kind) {
    return;
  }
  if (before.kind === 'ink' || after.kind === 'ink') {
    return;
  }

  const field = before.kind === 'embed' ? 'html' : 'text';
  const first = before.value[field];
  const last = after.value[field];
  if (typeof first !== 'string' || typeof last !== 'string') {
    return;
  }

  const detailsBefore = JSON.stringify(bodyWithoutText(before.value, field), printable);
  const detailsAfter = JSON.stringify(bodyWithoutText(after.value, field), printable);
  if (detailsBefore === detailsAfter) {
    return [first, last];
  }
}

function sceneText(
  object: WhiteboardObject | undefined,
  body: unknown,
  layer: number | undefined,
): string {
  if (!object) {
    return '';
  }

  return JSON.stringify(
    {
      kind: object.kind,
      label: object.label,
      geometry: object.geometry,
      locked: object.locked,
      parentId: object.parentId,
      groupId: object.groupId,
      appearance: object.appearance,
      detail: object.detail,
      layer,
      body,
    },
    printable,
    2,
  );
}

function canCompareBody(
  change: HistoryChange,
  beforePayload?: WhiteboardPayload,
  afterPayload?: WhiteboardPayload,
): boolean {
  const beforeComplete = change.before?.payloadVersion === undefined || beforePayload !== undefined;
  const afterComplete = change.after?.payloadVersion === undefined || afterPayload !== undefined;
  const hasBody = beforePayload !== undefined || afterPayload !== undefined;

  return beforeComplete && afterComplete && hasBody;
}

export function historyTexts(
  change: HistoryChange,
  beforePayload?: WhiteboardPayload,
  afterPayload?: WhiteboardPayload,
): readonly [string, string] {
  const { before, after, order } = change;
  const hasBodies = canCompareBody(change, beforePayload, afterPayload);
  if (hasBodies && !order && before?.geometryVersion === after?.geometryVersion) {
    return (
      textChange(beforePayload?.body, afterPayload?.body) ?? [
        JSON.stringify(bodyValue(beforePayload), printable, 2) ?? '',
        JSON.stringify(bodyValue(afterPayload), printable, 2) ?? '',
      ]
    );
  }

  return [
    sceneText(before, hasBodies ? bodyValue(beforePayload) : undefined, order?.before),
    sceneText(after, hasBodies ? bodyValue(afterPayload) : undefined, order?.after),
  ];
}

function split(text: string): string[] {
  return text ? text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') : [];
}

function sequenceLengths(left: readonly string[], right: readonly string[]): Uint16Array {
  const width = right.length + 1;
  const lengths = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const cell = i * width + j;
      lengths[cell] =
        left[i] === right[j]
          ? (lengths[cell + width + 1] ?? 0) + 1
          : Math.max(lengths[cell + width] ?? 0, lengths[cell + 1] ?? 0);
    }
  }

  return lengths;
}

function compareLines(left: readonly string[], right: readonly string[]): readonly DiffLine[] {
  const lengths = sequenceLengths(left, right);
  const width = right.length + 1;
  let i = 0;
  let j = 0;
  const result: DiffLine[] = [];
  while (i < left.length && j < right.length) {
    const before = left[i] ?? '';
    const after = right[j] ?? '';
    const cell = i * width + j;
    if (before === after) {
      result.push({ kind: ' ', text: before });
      i++;
      j++;
    } else if ((lengths[cell + width] ?? 0) >= (lengths[cell + 1] ?? 0)) {
      result.push({ kind: '-', text: before });
      i++;
    } else {
      result.push({ kind: '+', text: after });
      j++;
    }
  }

  return [
    ...result,
    ...left.slice(i).map((text): DiffLine => ({ kind: '-', text })),
    ...right.slice(j).map((text): DiffLine => ({ kind: '+', text })),
  ];
}

function visibleContext(lines: readonly DiffLine[]): Uint8Array {
  const keep = new Uint8Array(lines.length);
  lines.forEach((line, index) => {
    if (line.kind !== ' ') {
      keep.fill(1, Math.max(0, index - contextLines), index + contextLines + 1);
    }
  });

  return keep;
}

function clipContext(lines: readonly DiffLine[]): readonly DisplayLine[] {
  const keep = visibleContext(lines);
  let hidden = 0;
  const visible: DisplayLine[] = [];
  for (const [index, line] of lines.entries()) {
    if (!keep[index]) {
      hidden += 1;
      continue;
    }

    if (hidden) {
      visible.push({ kind: 'skip', text: String(hidden) });
      hidden = 0;
    }

    const text =
      line.text.length > maxLineLength ? line.text.slice(0, maxLineLength) + '…' : line.text;
    visible.push({ kind: line.kind, text });
  }
  if (hidden) {
    visible.push({ kind: 'skip', text: String(hidden) });
  }

  return visible;
}

export function diffHistoryText(before: string, after: string): HistoryDifference {
  const large = { added: 0, removed: 0, lines: [], large: true };
  if (before.length > maxTextLength || after.length > maxTextLength) {
    return large;
  }

  const left = split(before);
  const right = split(after);
  const cells = (left.length + 1) * (right.length + 1);
  if (cells > maxComparisonCells || left.length + right.length > maxDisplayLines * 2) {
    return large;
  }

  const lines = compareLines(left, right);
  const visible = clipContext(lines);

  return {
    added: lines.filter(({ kind }) => kind === '+').length,
    removed: lines.filter(({ kind }) => kind === '-').length,
    lines: visible.slice(0, maxDisplayLines),
    truncated: visible.length > maxDisplayLines,
  };
}
