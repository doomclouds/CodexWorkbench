import type {
  DocumentBlock,
  EmbedPayload,
  ObjectPayload,
  TableCell,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import type {
  ConnectorEndpoint,
  ObjectMetadata,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

export const contextRepresentations = [
  'overview',
  'text',
  'structure',
  'preview',
  'image',
  'source',
] as const;

export type ContextRepresentation = (typeof contextRepresentations)[number];

type RichValue = NonNullable<DocumentBlock['content']>;
export type ContentFocus =
  | { readonly kind: 'document'; readonly ids: readonly string[] }
  | { readonly kind: 'todo'; readonly id: string }
  | { readonly kind: 'html'; readonly ids: readonly string[]; readonly sourceRevision?: bigint };

const maximumText = 2_400;
const maximumSource = 6_000;
const maximumBlocks = 24;
const maximumDepth = 12;
const maximumRows = 12;
const maximumColumns = 12;
const maximumItems = 24;
const maximumMarkup = 512 * 1024;
const nonContentTags = new Set(['head', 'script', 'style', 'template', 'noscript']);
const blockPrefixes = new Map([
  ['heading', '## '],
  ['bulletListItem', '- '],
  ['numberedListItem', '1. '],
]);

export function contextLabel(text: string): string {
  return text.slice(0, 160);
}

function richText(value: RichValue | undefined, depth = 0): string {
  if (!value || depth >= maximumDepth) {
    return '';
  }

  const { kind } = value;
  if (kind.case === 'stringValue') {
    return kind.value.slice(0, maximumText);
  }
  if (kind.case === 'listValue') {
    return kind.value.values
      .slice(0, maximumBlocks)
      .map((child) => richText(child, depth + 1))
      .join('')
      .slice(0, maximumText);
  }

  if (kind.case === 'structValue') {
    const { fields } = kind.value;
    return richText(fields.text ?? fields.content, depth + 1);
  }

  return '';
}

interface BlockExcerpt {
  readonly id: string;
  readonly type: string;
  readonly depth: number;
  readonly text: string;
}

function documentExcerpts(blocks: readonly DocumentBlock[], focus?: ContentFocus) {
  const selected = focus?.kind === 'document' ? new Set(focus.ids) : undefined;
  const excerpts: BlockExcerpt[] = [];
  let visited = 0;

  function visit(children: readonly DocumentBlock[], depth: number) {
    for (const block of children) {
      visited += 1;
      if (excerpts.length >= maximumBlocks || depth >= maximumDepth || visited > 2_000) {
        return;
      }

      if (!selected || selected.has(block.blockId)) {
        excerpts.push({
          id: block.blockId,
          type: contextLabel(block.type),
          depth,
          text: richText(block.content).slice(0, 240),
        });
      }

      visit(block.children, depth + 1);
    }
  }

  visit(blocks, 0);
  return excerpts;
}

type CellValue = string | number | boolean | null;

function cellValue({ value }: TableCell): CellValue {
  switch (value.case) {
    case 'text':
      return contextLabel(value.value);
    case 'number':
    case 'boolValue':
      return value.value;
    case 'nullValue':
    case undefined:
      return null;
  }
}

function tableText(rows: readonly (readonly CellValue[])[]): string {
  return rows
    .map((row) => row.map((cell) => String(cell ?? '').replaceAll('\n', ' ')).join(' | '))
    .join('\n');
}

function documentText(outline: readonly BlockExcerpt[]) {
  return outline
    .filter(({ text }) => Boolean(text))
    .map(({ type, text }) => (blockPrefixes.get(type) ?? '') + text)
    .join('\n');
}

function hiddenMarkup(node: DefaultTreeAdapterMap['node']) {
  if (!('tagName' in node)) {
    return false;
  }

  const hidden = node.attrs.some(
    ({ name, value }) => name === 'hidden' || (name === 'aria-hidden' && value === 'true'),
  );

  return hidden || nonContentTags.has(node.tagName);
}

function appendMarkupChildren(
  pending: DefaultTreeAdapterMap['node'][],
  node: DefaultTreeAdapterMap['node'],
) {
  if (!('childNodes' in node)) {
    return;
  }

  for (const child of [...node.childNodes].reverse()) {
    pending.push(child);
  }
}

function savedMarkup(html: string | undefined) {
  if (!html) {
    return;
  }

  const input = html.slice(0, maximumMarkup);
  const pending: DefaultTreeAdapterMap['node'][] = [];
  appendMarkupChildren(pending, parse(input));
  const parts: string[] = [];
  let size = 0;
  while (pending.length && size <= maximumText) {
    const node = pending.pop();
    if (!node || hiddenMarkup(node)) {
      continue;
    }

    if (node.nodeName === '#text' && 'value' in node) {
      const fragment = node.value
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, maximumText + 1);

      if (fragment) {
        parts.push(fragment);
        size += fragment.length + 1;
      }
    }
    appendMarkupChildren(pending, node);
  }

  return {
    text: parts.join(' '),
    truncated: pending.length > 0 || input.length < html.length,
  };
}

interface PayloadProjection {
  readonly text?: string;
  readonly textTruncated?: boolean;
  readonly textOrigin?: 'savedMarkup';
  readonly structure?: Readonly<Record<string, unknown>>;
}

function embedContent(
  value: EmbedPayload,
  focus: ContentFocus | undefined,
  includeText: boolean,
): PayloadProjection {
  const markup = includeText && !focus ? savedMarkup(value.html) : undefined;
  return {
    text: markup?.text,
    textTruncated: markup?.truncated,
    textOrigin: 'savedMarkup',
    structure: {
      title: contextLabel(value.title ?? ''),
      sourceRevision: value.sourceRevision?.toString(),
      hasSource: Boolean(value.html),
      ...(focus?.kind === 'html' && { nodeIds: focus.ids }),
    },
  };
}

function payloadContent(
  payload: ObjectPayload,
  focus: ContentFocus | undefined,
  includeText: boolean,
): PayloadProjection {
  const { body } = payload;
  switch (body.case) {
    case 'text': {
      const { text, color, fontFamily, fontSize, bold, italic } = body.value;
      return {
        text,
        structure: {
          color,
          fontFamily: fontFamily && contextLabel(fontFamily),
          fontSize,
          bold,
          italic,
        },
      };
    }
    case 'document': {
      const { title, blocks } = body.value;
      const outline = documentExcerpts(blocks, focus);
      return {
        text: documentText(outline),
        structure: { title: contextLabel(title), blocks: outline },
      };
    }
    case 'todo': {
      const source = body.value.items;
      const scoped =
        focus?.kind === 'todo' ? source.filter(({ itemId }) => itemId === focus.id) : source;
      const items = scoped.slice(0, maximumItems).map(({ itemId, text, checked }) => ({
        id: itemId,
        text: contextLabel(text),
        checked,
      }));

      return {
        text: items.map(({ checked, text }) => `- [${checked ? 'x' : ' '}] ${text}`).join('\n'),
        structure: { title: contextLabel(body.value.title), items, count: scoped.length },
      };
    }
    case 'table': {
      const { text, grid } = body.value;
      const rows = (grid?.rows ?? [])
        .slice(0, maximumRows)
        .map(({ cells }) => cells.slice(0, maximumColumns).map(cellValue));

      return {
        text: rows.length ? tableText(rows) : text,
        structure: {
          rows,
          rowIds: grid?.rowIds.slice(0, maximumRows),
          columnIds: grid?.columnIds.slice(0, maximumColumns),
          rowCount: grid?.rows.length ?? 0,
          columnCount: grid?.columnIds.length ?? 0,
          head: grid?.head,
        },
      };
    }
    case 'embed':
      return embedContent(body.value, focus, includeText);
    case 'image':
      return { structure: { naturalSize: body.value.naturalSize, crop: body.value.crop } };
    case 'video':
      return { structure: { hasPoster: Boolean(body.value.poster) } };
    case 'link':
      return { structure: { href: body.value.href?.slice(0, 1_024) } };
    case 'sticker':
      return { structure: { stickerId: body.value.stickerId } };
    case 'ink':
      return { structure: { points: body.value.points.length } };
    case 'extension':
      return { structure: { schemaId: body.value.schemaId } };
    case undefined:
      return {};
  }
}

function savedSource(payload: ObjectPayload, focus?: ContentFocus) {
  const { body } = payload;
  if (body.case !== 'embed' || !body.value.html || focus) {
    return undefined;
  }

  return {
    html: body.value.html.slice(0, maximumSource),
    sourceRevision: body.value.sourceRevision?.toString(),
    truncated: body.value.html.length > maximumSource,
  };
}

export function contextContent(
  payload: ObjectPayload,
  focus: ContentFocus | undefined,
  includeText: boolean,
) {
  const { text, structure, textOrigin, textTruncated } = payloadContent(
    payload,
    focus,
    includeText,
  );

  return {
    text: text?.slice(0, maximumText),
    textOrigin,
    textTruncated: Boolean(textTruncated || (text && text.length > maximumText)),
    structure,
    source: savedSource(payload, focus),
  };
}

export function contextObject(object: ObjectMetadata, labels: ReadonlyMap<string, string>) {
  const { objectId, kind, label, geometry, parentId, groupId, geometryDetail } = object;
  const connector = geometryDetail.case === 'connector' ? geometryDetail.value : undefined;
  const relation = (endpoint: ConnectorEndpoint | undefined) => {
    const { attachment, point } = endpoint ?? {};
    const target = attachment?.objectId;
    return {
      target,
      label: target && labels.get(target),
      port: attachment?.port,
      point: point && { x: point.x, y: point.y },
    };
  };

  return {
    id: objectId,
    kind,
    label: contextLabel(label),
    parentId,
    groupId,
    bounds: geometry && {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
    },
    locked: object.locked,
    geometryVersion: object.geometryVersion?.toString(),
    payloadVersion: object.payloadVersion?.toString(),
    ...(geometryDetail.case === 'shape' && { outline: geometryDetail.value.outline }),
    ...(geometryDetail.case === 'section' && { transparent: geometryDetail.value.transparent }),
    ...(connector && {
      connector: {
        start: relation(connector.start),
        end: relation(connector.end),
        startHead: connector.startHead,
        endHead: connector.endHead,
      },
    }),
  };
}
