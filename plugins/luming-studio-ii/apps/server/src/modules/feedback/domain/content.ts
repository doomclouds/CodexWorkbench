import type {
  FeedbackContentSource,
  FeedbackContentTarget,
  FeedbackContentUnit,
  FeedbackRejected,
} from './model.js';

const maximumUnits = 64;
const maximumUnitIdLength = 192;
const maximumExcerpt = 512;
const maximumBlockNodes = 20_000;
const maximumInlineDepth = 12;
const control = /\p{Cc}/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validId(id: string): boolean {
  return id.length <= maximumUnitIdLength && Boolean(id.trim()) && !control.test(id);
}

function validIds(ids: readonly string[]): boolean {
  return (
    ids.length > 0 &&
    ids.length <= maximumUnits &&
    new Set(ids).size === ids.length &&
    ids.every(validId)
  );
}

export function validFeedbackContentUnit(unit: FeedbackContentUnit): boolean {
  switch (unit.kind) {
    case 'document':
      return validIds(unit.blockIds);
    case 'todo':
      return validId(unit.itemId);
    case 'html':
      return unit.sourceRevision >= 0n && validIds(unit.nodeIds);
  }
}

function excerpt(value: unknown, maximum = maximumExcerpt, depth = 0): string {
  if (depth > maximumInlineDepth || maximum <= 0) {
    return '';
  }
  if (typeof value === 'string') {
    return value.slice(0, maximum);
  }

  if (!Array.isArray(value)) {
    const part = record(value);

    return part ? excerpt(part.text ?? part.content, maximum, depth + 1) : '';
  }

  let text = '';
  for (const item of value) {
    text += excerpt(item, maximum - text.length, depth + 1);
    if (text.length >= maximum) {
      break;
    }
  }

  return text;
}

function documentUnits(data: Record<string, unknown>, ids: readonly string[]): string | undefined {
  if (data.schemaVersion !== 1 || !Array.isArray(data.blocks)) {
    return undefined;
  }

  const targets = new Set(ids);
  const found = new Map<string, string>();
  const blocks: unknown[] = [...data.blocks];
  for (let index = 0; index < blocks.length && index < maximumBlockNodes; index += 1) {
    const block = record(blocks[index]);
    if (!block) {
      continue;
    }

    if (typeof block.blockId === 'string' && targets.has(block.blockId)) {
      found.set(block.blockId, excerpt(block.content).trim());
    }
    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        blocks.push(child);
      }
    }
  }

  return found.size === targets.size
    ? ids
        .map((id) => found.get(id))
        .filter(Boolean)
        .join('\n')
        .slice(0, maximumExcerpt)
    : undefined;
}

function todoUnit(data: Record<string, unknown>, itemId: string): string | undefined {
  if (!Array.isArray(data.items)) {
    return undefined;
  }

  for (const raw of data.items) {
    const item = record(raw);
    if (item?.itemId === itemId && typeof item.text === 'string') {
      return excerpt(item.text).trim();
    }
  }
}

function storedSourceRevision(value: unknown): bigint | undefined {
  if (value === undefined) {
    return 0n;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d{1,20}$/u.test(value)) {
    return BigInt(value);
  }
}

function contentExcerpt(
  unit: FeedbackContentUnit,
  source: FeedbackContentSource,
): string | undefined {
  const data = record(source.data);
  if (!data) {
    return undefined;
  }

  switch (unit.kind) {
    case 'document':
      return source.kind === 'document' ? documentUnits(data, unit.blockIds) : undefined;
    case 'todo':
      return source.kind === 'todo' ? todoUnit(data, unit.itemId) : undefined;
    case 'html': {
      const sameSource =
        source.kind === 'embed' &&
        storedSourceRevision(data.sourceRevision) === unit.sourceRevision;
      const nodes = new Set(source.htmlNodeIds);

      return sameSource && unit.nodeIds.every((id) => nodes.has(id)) ? '' : undefined;
    }
  }
}

export function hasFeedbackContent(
  unit: FeedbackContentUnit,
  source: FeedbackContentSource,
): boolean {
  return contentExcerpt(unit, source) !== undefined;
}

export function freezeFeedbackContent(
  target: FeedbackContentTarget,
  objectKind: string,
  source: FeedbackContentSource | undefined,
): { readonly frozenExcerpt?: string } | FeedbackRejected {
  if (!validFeedbackContentUnit(target.content)) {
    return { kind: 'rejected', reason: 'invalidAnchor' };
  }
  if (source?.payloadVersion !== target.payloadVersion) {
    return { kind: 'rejected', reason: 'targetChanged', currentVersion: source?.payloadVersion };
  }

  const compatible =
    target.content.kind === 'html'
      ? htmlObjectKinds.has(objectKind)
      : objectKind === target.content.kind;

  if (!compatible) {
    return { kind: 'rejected', reason: 'invalidAnchor' };
  }

  const text = contentExcerpt(target.content, source);

  return text === undefined
    ? { kind: 'rejected', reason: 'targetChanged', currentVersion: source.payloadVersion }
    : { frozenExcerpt: text || undefined };
}

const htmlObjectKinds = new Set(['html', 'diagram', 'chart']);
