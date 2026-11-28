import type {
  DocumentBlock,
  ObjectPayload,
  TableGrid,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { parseRichText } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/rich-text';
import type { ObjectMetadata } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { selectContextObjects } from './artifact-context-scope.js';
import { flattenBlocks } from './artifact-read-content.js';
import { snapshotSummary, type ArtifactReadData, type ReadSnapshot } from './artifact-read-data.js';
import {
  ArtifactReadFailure,
  readBytes,
  readPage,
  rowPage,
  type ReadArguments,
  type ReadPosition,
} from './artifact-read-page.js';
import { invalidArgument, tooLarge } from './errors.js';

const overviewBytes = 16 * 1024;
const searchBytes = 8 * 1024;
const scanBatchSize = 5;
const scanLimit = 40;
const maximumLabel = 96;
const maximumSnippet = 128;
const hiddenTags = new Set([
  'head',
  'script',
  'style',
  'iframe',
  'template',
  'noscript',
  'object',
  'textarea',
]);
const blockTags = new Set([
  'article',
  'br',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'p',
  'section',
  'td',
  'th',
  'tr',
]);

function clip(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }

  const code = text.charCodeAt(max);
  const length = code >= 0xdc00 && code <= 0xdfff ? max - 1 : max;

  return text.slice(0, length) + '…';
}

type SearchSource = {
  readonly text: string;
  readonly blockId?: string;
  readonly itemId?: string;
  readonly rowId?: string;
  readonly columnId?: string;
};

function textOf(value: DocumentBlock['content']): string {
  const part = value?.kind;
  if (part?.case === 'stringValue') {
    return part.value;
  }
  if (part?.case === 'listValue') {
    return part.value.values.map(textOf).join('');
  }
  if (part?.case === 'structValue') {
    return textOf(part.value.fields.text ?? part.value.fields.content);
  }

  return '';
}

function visibleRichText(text: string) {
  return parseRichText(text)
    .map(({ segments }) => segments.map((segment) => segment.text).join(''))
    .join('\n');
}

function htmlText(html: string) {
  const source = parse(html);
  const nodes: (DefaultTreeAdapterMap['node'] | 'break')[] = [source];
  const text: string[] = [];
  for (let node = nodes.pop(); node; node = nodes.pop()) {
    if (node === 'break') {
      text.push(' ');
      continue;
    }
    if ('value' in node) {
      text.push(node.value);
      continue;
    }
    if ('tagName' in node && hiddenTags.has(node.tagName)) {
      continue;
    }
    if (
      'attrs' in node &&
      node.attrs.some(
        ({ name, value }) => name === 'hidden' || (name === 'aria-hidden' && value === 'true'),
      )
    ) {
      continue;
    }

    if ('childNodes' in node) {
      const block = 'tagName' in node && blockTags.has(node.tagName);
      if (block) {
        text.push(' ');
        nodes.push('break');
      }
      for (const child of [...node.childNodes].reverse()) {
        nodes.push(child);
      }
    }
  }

  return text.join('');
}

function* tableSources(grid: TableGrid | undefined): Generator<SearchSource> {
  if (!grid) {
    return;
  }

  for (const [row, { cells }] of grid.rows.entries()) {
    for (const [column, { value }] of cells.entries()) {
      if (value.case !== undefined && value.case !== 'nullValue') {
        const text = value.case === 'text' ? visibleRichText(value.value) : String(value.value);
        yield { text, rowId: grid.rowIds[row], columnId: grid.columnIds[column] };
      }
    }
  }
}

function* payloadSources(payload: ObjectPayload | undefined): Generator<SearchSource> {
  const body = payload?.body;
  switch (body?.case) {
    case 'text':
      yield { text: visibleRichText(body.value.text) };
      break;
    case 'document':
      for (const block of flattenBlocks(body.value.blocks)) {
        yield { text: textOf(block.content), blockId: block.blockId };
      }
      break;
    case 'todo':
      yield* body.value.items;
      break;
    case 'table':
      yield* tableSources(body.value.grid);
      break;
    case 'embed':
      if (body.value.html) {
        yield { text: htmlText(body.value.html) };
      }
      break;
    case 'extension':
    case 'image':
    case 'ink':
    case 'link':
    case 'sticker':
    case 'video':
    case undefined:
      break;
  }
}

function boardCandidates(snapshot: ReadSnapshot, args: ReadArguments) {
  const { rect, parentId, ids, type } = args;
  const all = snapshot.scene.objects;
  const objects = rect
    ? selectContextObjects(all, {
        kind: 'region',
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
        },
      }).objects
    : all;

  if (parentId && !snapshot.objects.has(parentId)) {
    throw new ArtifactReadFailure('NOT_FOUND', '找不到目标分区或父对象。');
  }

  const parentScope = parentId && new Set(descendants(all, parentId));
  const selected = ids && new Set(ids);

  return objects.filter(
    (object) =>
      (!type || object.kind === type) &&
      (!selected || selected.has(object.objectId)) &&
      (!parentScope || parentScope.has(object.objectId)),
  );
}

function descendants(objects: readonly ObjectMetadata[], parentId: string) {
  const parent = objects.find((object) => object.objectId === parentId);
  if (parent?.kind === 'section') {
    return selectContextObjects(objects, { kind: 'section', sectionId: parentId })
      .objects.map(({ objectId }) => objectId)
      .filter((id) => id !== parentId);
  }

  return objects.filter((object) => object.parentId === parentId).map(({ objectId }) => objectId);
}

function summaryItem(object: ObjectMetadata) {
  const {
    objectId,
    kind,
    label,
    geometry,
    geometryVersion,
    payloadVersion,
    locked,
    parentId,
    groupId,
  } = object;

  return {
    id: objectId,
    type: kind,
    label: clip(label, maximumLabel),
    bounds: geometry && {
      x: geometry.x,
      y: geometry.y,
      w: geometry.width,
      h: geometry.height,
      rotation: geometry.rotation,
    },
    geometryVersion: geometryVersion?.toString(),
    payloadVersion: payloadVersion?.toString(),
    locked,
    parentId,
    groupId,
  };
}

function normalized(text: string) {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function matched(raw: string, query: string) {
  const text = normalized(raw);
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) {
    return;
  }

  let start = Math.max(0, index - 24);
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) {
    start--;
  }

  return clip((start ? '…' : '') + text.slice(start), maximumSnippet);
}

function* matches(object: ObjectMetadata, payload: ObjectPayload | undefined, query: string) {
  const header = summaryItem(object);
  const label = matched(visibleRichText(object.label), query);
  if (label) {
    yield { ...header, snippet: label };
  }
  for (const { text, blockId, itemId, rowId, columnId } of payloadSources(payload)) {
    const unit = blockId ?? itemId ?? rowId ?? columnId;
    if (label && !unit) {
      continue;
    }

    const snippet = matched(text, query);
    if (snippet) {
      yield { ...header, blockId, itemId, rowId, columnId, snippet };
    }
  }
}

function candidatesInPage(objects: readonly ObjectMetadata[], position: ReadPosition) {
  if (position.offset > objects.length || (position.offset === objects.length && position.inner)) {
    throw new ArtifactReadFailure('INVALID_CURSOR', '搜索游标超过当前结果范围。');
  }

  return objects.slice(position.offset, position.offset + scanLimit);
}

type SearchRow = ReturnType<typeof summaryItem> &
  Omit<SearchSource, 'text'> & {
    readonly snippet: string;
  };

async function* searchRows(
  data: ArtifactReadData,
  snapshot: ReadSnapshot,
  objects: readonly ObjectMetadata[],
  query: string,
) {
  for (let start = 0; start < objects.length; start += scanBatchSize) {
    const batch = objects.slice(start, start + scanBatchSize);
    const payloads = await data.payloads(
      snapshot,
      batch.map(({ objectId }) => objectId),
    );

    for (const [index, object] of batch.entries()) {
      let inner = 0;
      for (const row of matches(object, payloads.get(object.objectId), query)) {
        yield { row, index: start + index, inner: inner++ };
      }
    }
  }
}

async function search(
  data: ArtifactReadData,
  snapshot: ReadSnapshot,
  objects: readonly ObjectMetadata[],
  args: ReadArguments,
) {
  const query = normalized(args.query ?? '').toLowerCase();
  if (!query) {
    throw invalidArgument('请输入要查找的文字。');
  }

  const page = readPage(args, snapshot.revision.toString(), searchBytes);
  const scoped = candidatesInPage(objects, page.position);
  const artifact = snapshotSummary(snapshot);
  const items: SearchRow[] = [];
  const nextPage = (index: number, inner = 0) => ({
    artifact,
    items,
    nextCursor: page.next(page.position.offset + index, inner),
  });

  for await (const { row, index, inner } of searchRows(data, snapshot, scoped, query)) {
    if (index === 0 && inner < (page.position.inner ?? 0)) {
      continue;
    }

    const continuation = nextPage(index, inner);
    if (
      items.length >= page.limit ||
      readBytes({ ...continuation, items: [...items, row] }) > page.bytes
    ) {
      if (!items.length) {
        throw tooLarge('单条搜索结果超过返回限制。');
      }

      return continuation;
    }

    items.push(row);
  }

  return page.position.offset + scoped.length < objects.length
    ? nextPage(scoped.length)
    : { artifact, items };
}

export function readDiscovery(data: ArtifactReadData, snapshot: ReadSnapshot, args: ReadArguments) {
  const objects = boardCandidates(snapshot, args);
  if (args.mode === 'search') {
    return search(data, snapshot, objects, args);
  }

  const page = readPage(args, snapshot.revision.toString(), overviewBytes);

  return rowPage(objects.map(summaryItem), 'items', { artifact: snapshotSummary(snapshot) }, page);
}
