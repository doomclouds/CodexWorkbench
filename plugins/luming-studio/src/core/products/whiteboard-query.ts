import { Buffer } from 'node:buffer';
import { documentBlockText, flattenDocumentBlocks } from '../../contracts/document.js';
import type { Artifact, Board, BoardElement } from '../../contracts/studio.js';
import { workspaceElementBounds } from '../shared/agent-workspaces.js';
import { object, StudioError } from '../shared/common.js';
import { parseRichText } from '../../shared/rich-text.js';

type Bounds = ReturnType<typeof workspaceElementBounds>;
type Location = { blockId?: string; rowId?: string; columnId?: string; itemId?: string };
export interface WhiteboardQueryOptions {
  query?: string;
  type?: string;
  parentId?: string;
  rect?: Bounds;
  ids?: readonly string[];
  offset?: number;
  limit?: number;
  maxBytes?: number;
}
export interface WhiteboardQueryItem extends Location {
  id: string;
  type: BoardElement['type'];
  version: number;
  bounds: Bounds;
  label?: string;
  snippet?: string;
  sourceRevision?: number;
}
export interface WhiteboardQueryPage {
  artifact: Pick<Artifact, 'id' | 'title' | 'revision'>;
  items: WhiteboardQueryItem[];
  offset: number;
  nextOffset?: number;
}

const MAX_ITEMS = 20;
const MAX_LABEL_BYTES = 160;
const MAX_SNIPPET_BYTES = 240;
const RAW_TAGS = new Set(['script', 'style', 'iframe', 'noscript', 'textarea', 'xmp', 'title']);
const HIDDEN_TAGS = new Set([...RAW_TAGS, 'head', 'template', 'object']);
const BREAK_TAGS = new Set([
  'br',
  'div',
  'p',
  'li',
  'td',
  'th',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
  'text',
]);
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  quot: '"',
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|apos|quot|nbsp);/gi, (match, raw: string) => {
    const name = raw.toLowerCase();
    if (!name.startsWith('#')) {
      return ENTITIES[name] ?? match;
    }

    const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    const outsideSurrogates = code < 0xd800 || code > 0xdfff;

    return code > 0 && code <= 0x10ffff && outsideSurrogates
      ? String.fromCodePoint(code)
      : '\uFFFD';
  });
}

function htmlText(source: string): string {
  const parts: string[] = [];
  const hidden: string[] = [];
  const tokens =
    /<!--[\s\S]*?(?:-->|$)|<![^>]*(?:>|$)|<\/?([a-z][a-z0-9:-]*)(?=[\s/>]|$)(?:[^"'<>]|"[^"]*(?:"|$)|'[^']*(?:'|$))*(?:>|$)/gi;
  let position = 0;
  for (const match of source.matchAll(tokens)) {
    const name = match[1]?.toLowerCase();
    const closing = match[0].startsWith('</');
    const active = hidden.at(-1);
    if (!active) {
      parts.push(decodeEntities(source.slice(position, match.index)));
    }

    position = match.index + match[0].length;
    if (!name) {
      continue;
    }

    if (active && RAW_TAGS.has(active)) {
      if (closing && name === active) {
        hidden.pop();
      }

      continue;
    }
    if (HIDDEN_TAGS.has(name)) {
      if (!closing) {
        hidden.push(name);
      } else if (active === name) {
        hidden.pop();
      }
    } else if (!active && BREAK_TAGS.has(name)) {
      parts.push(' ');
    }
  }

  if (!hidden.length) {
    parts.push(decodeEntities(source.slice(position)));
  }

  return parts.join('');
}

const normalizeText = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const textBytes = (text: string) => Buffer.byteLength(text, 'utf8');
const jsonBytes = (value: unknown) => textBytes(JSON.stringify(value));

function excerpt(text: string, maxBytes: number): string {
  if (textBytes(text) <= maxBytes) {
    return text;
  }

  const ellipsis = '…';
  let size = textBytes(ellipsis);
  let end = 0;
  for (const character of text) {
    size += textBytes(character);
    if (size > maxBytes) {
      break;
    }

    end += character.length;
  }

  return text.slice(0, end).trimEnd() + ellipsis;
}

function matchExcerpt(raw: string, query: string): string | undefined {
  const text = normalizeText(raw);
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) {
    return undefined;
  }

  let start = Math.max(0, index - 30);
  const code = text.charCodeAt(start);
  if (start && code >= 0xdc00 && code <= 0xdfff) {
    start--;
  }

  return excerpt((start ? '…' : '') + text.slice(start), MAX_SNIPPET_BYTES);
}

const visibleText = (text: string) =>
  parseRichText(text)
    .map((line) => line.segments.map((segment) => segment.text).join(''))
    .join('\n');

function labelOf(element: BoardElement): string {
  const text = element.type === 'arrow' ? element.label : element.text;

  return typeof text === 'string' ? visibleText(text) : '';
}

type ContentSource = Location & { text: string };

function* tableSources({
  rows,
  rowIds,
  columnIds,
}: Record<string, unknown>): Generator<ContentSource> {
  if (!Array.isArray(rows)) {
    return;
  }

  for (const [rowIndex, row] of rows.entries()) {
    if (!Array.isArray(row)) {
      continue;
    }

    const rowId = Array.isArray(rowIds) ? rowIds[rowIndex] : undefined;
    for (const [columnIndex, value] of row.entries()) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        continue;
      }

      const columnId = Array.isArray(columnIds) ? columnIds[columnIndex] : undefined;
      const location =
        typeof rowId === 'string' && typeof columnId === 'string' ? { rowId, columnId } : {};
      yield { text: visibleText(String(value)), ...location };
    }
  }
}

function* contentSources(element: BoardElement): Generator<ContentSource> {
  if (element.document) {
    for (const block of flattenDocumentBlocks(element.document.blocks)) {
      yield { text: documentBlockText(block), blockId: block.id };
    }
  }
  if (element.type === 'table') {
    yield* tableSources(element.data ?? {});
  }
  if (element.type === 'todo' && Array.isArray(element.data?.items)) {
    for (const item of element.data.items) {
      if (object(item) && typeof item.id === 'string' && typeof item.text === 'string') {
        yield { text: item.text, itemId: item.id };
      }
    }
  }
  if ((element.type === 'html' || element.type === 'diagram') && typeof element.html === 'string') {
    yield { text: htmlText(element.html) };
  }
}

const inside = (bounds: Bounds, parent: Bounds) =>
  bounds.x >= parent.x &&
  bounds.y >= parent.y &&
  bounds.x + bounds.w <= parent.x + parent.w &&
  bounds.y + bounds.h <= parent.y + parent.h;
const intersects = (left: Bounds, right: Bounds) =>
  left.x <= right.x + right.w &&
  left.x + left.w >= right.x &&
  left.y <= right.y + right.h &&
  left.y + left.h >= right.y;

function resolveParentScope(elements: readonly BoardElement[], parentId?: string) {
  if (!parentId) {
    return {};
  }

  const parent = elements.find((element) => element.id === parentId);
  if (!parent) {
    throw new StudioError('NOT_FOUND', '指定的白板分区或父对象不存在。');
  }

  const area = parent.type === 'container' ? workspaceElementBounds(parent, elements) : undefined;

  return { parent, area };
}

function* queryCandidates(
  elements: readonly BoardElement[],
  options: WhiteboardQueryOptions,
): Generator<{ element: BoardElement; getBounds: () => Bounds }> {
  const ids = options.ids ? new Set(options.ids) : undefined;
  const { parent, area } = resolveParentScope(elements, options.parentId);
  for (const element of elements) {
    const excludedId = ids && !ids.has(element.id);
    const wrongType = options.type && element.type !== options.type;
    if (excludedId || wrongType || element.id === parent?.id) {
      continue;
    }

    const explicitChild = parent && element.parentId === parent.id;
    const canMatchByBounds = area && !element.parentId;
    if (parent && !explicitChild && !canMatchByBounds) {
      continue;
    }

    let bounds: Bounds | undefined;
    const getBounds = () => (bounds ??= workspaceElementBounds(element, elements));
    if (options.rect && !intersects(getBounds(), options.rect)) {
      continue;
    }
    if (area && !explicitChild && !inside(getBounds(), area)) {
      continue;
    }

    yield { element, getBounds };
  }
}

function* matchingItems(
  elements: readonly BoardElement[],
  options: WhiteboardQueryOptions,
): Generator<WhiteboardQueryItem> {
  const query = normalizeText(options.query ?? '').toLowerCase();
  for (const { element, getBounds } of queryCandidates(elements, options)) {
    const label = normalizeText(labelOf(element));
    const item = (): WhiteboardQueryItem => ({
      id: element.id,
      type: element.type,
      version: element.version,
      bounds: getBounds(),
      ...(label ? { label: excerpt(label, MAX_LABEL_BYTES) } : {}),
      ...(Number.isSafeInteger(element.sourceRevision)
        ? { sourceRevision: element.sourceRevision }
        : {}),
    });

    if (!query) {
      yield item();
      continue;
    }

    const inTitle = matchExcerpt(label, query);
    if (inTitle) {
      yield { ...item(), snippet: inTitle };
    }

    let unanchored = Boolean(inTitle);
    for (const { text, ...location } of contentSources(element)) {
      const anchored = location.blockId || location.rowId || location.itemId;
      if (!anchored && unanchored) {
        continue;
      }

      const snippet = matchExcerpt(text, query);
      if (!snippet) {
        continue;
      }

      yield { ...item(), ...location, snippet };
      if (!anchored) {
        unanchored = true;
      }
    }
  }
}

function validateQueryRange(offset: number, limit: number, maxBytes: number, rect?: Bounds): void {
  const validOffset = Number.isSafeInteger(offset) && offset >= 0;
  const validLimit = Number.isSafeInteger(limit) && limit > 0;
  const validBudget = Number.isSafeInteger(maxBytes) && maxBytes > 0;
  if (!validOffset || !validLimit || !validBudget) {
    throw new StudioError('INVALID_ARGUMENT', '查询分页范围无效。');
  }

  if (rect) {
    const finiteBounds = [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite);
    if (!finiteBounds || rect.w <= 0 || rect.h <= 0) {
      throw new StudioError('INVALID_ARGUMENT', '查询区域坐标或尺寸无效。');
    }
  }
}

export function queryWhiteboard(
  board: Pick<Board, 'artifact' | 'elements'>,
  options: WhiteboardQueryOptions,
): WhiteboardQueryPage {
  const { id, title, revision } = board.artifact;
  const offset = options.offset ?? 0;
  const limit = Math.min(MAX_ITEMS, options.limit ?? 10);
  const maxBytes = Math.min(
    normalizeText(options.query ?? '') ? 8 * 1024 : 16 * 1024,
    options.maxBytes ?? Infinity,
  );
  validateQueryRange(offset, limit, maxBytes, options.rect);
  const page: WhiteboardQueryPage = {
    artifact: { id, title: excerpt(title, MAX_LABEL_BYTES), revision },
    items: [],
    offset,
  };

  let bytes = jsonBytes({ ...page, nextOffset: Number.MAX_SAFE_INTEGER });
  if (bytes > maxBytes) {
    throw new StudioError('RESULT_TOO_LARGE', '查询的字节预算不足。');
  }

  let seen = 0;
  for (const item of matchingItems(board.elements, options)) {
    if (seen++ < offset) {
      continue;
    }

    const size = jsonBytes(item) + (page.items.length ? 1 : 0);
    if (page.items.length >= limit || bytes + size > maxBytes) {
      if (!page.items.length) {
        throw new StudioError('RESULT_TOO_LARGE', '查询的字节预算不足以返回一项。');
      }

      page.nextOffset = offset + page.items.length;
      break;
    }

    bytes += size;
    page.items.push(item);
  }

  return page;
}
