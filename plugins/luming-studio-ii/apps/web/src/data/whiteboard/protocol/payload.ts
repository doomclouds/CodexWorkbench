import { toJson } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import {
  TextAlignment,
  type DocumentBlock,
  type ObjectPayload,
  type TableCell,
  type TableGrid,
  type TodoSourceRef,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import {
  ObjectPayloadUnavailableReason,
  type ObjectPayloadResult,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { WhiteboardPayload, WhiteboardPayloadResult } from '../contracts.js';
import { readPoint } from './scene.js';
import { requireField } from './values.js';

type ResolveAssetUrl = (source: string) => string;

const alignment = new Map<TextAlignment, string>([
  [TextAlignment.LEFT, 'left'],
  [TextAlignment.CENTER, 'center'],
  [TextAlignment.RIGHT, 'right'],
]);
const unavailableReasons = new Map<ObjectPayloadUnavailableReason, string>([
  [ObjectPayloadUnavailableReason.NOT_FOUND, 'notFound'],
  [ObjectPayloadUnavailableReason.UNSUPPORTED_KIND, 'unsupportedKind'],
]);

function readDocumentBlock(
  block: DocumentBlock,
  resolveAssetUrl: ResolveAssetUrl,
): Readonly<Record<string, unknown>> {
  const { blockId, type, props, content, children } = block;
  const blockProps =
    type === 'image' && typeof props?.url === 'string'
      ? { ...props, url: resolveAssetUrl(props.url) }
      : (props ?? {});

  return {
    id: blockId,
    type,
    props: blockProps,
    content: content && toJson(ValueSchema, content),
    children: children.map((child) => readDocumentBlock(child, resolveAssetUrl)),
  };
}

function readTodoSource(source: TodoSourceRef | undefined) {
  if (!source) {
    return;
  }

  const { objectId, boardId, blockId, itemId, version } = source;

  return { elementId: objectId, artifactId: boardId, blockId, itemId, version };
}

function readCell({ value }: TableCell): string | number | boolean | null {
  switch (value.case) {
    case 'text':
    case 'number':
    case 'boolValue':
      return value.value;
    case 'nullValue':
    case undefined:
      return null;
  }
}

function readGrid(grid: TableGrid | undefined) {
  if (!grid) {
    return;
  }

  const { rows, rowIds, columnIds, columnWidths, head } = grid;

  return {
    rows: rows.map(({ cells }) => cells.map(readCell)),
    rowIds,
    columnIds,
    columnWidths,
    head,
  };
}

function readBody(
  body: ObjectPayload['body'],
  resolveAssetUrl: ResolveAssetUrl,
): WhiteboardPayload['body'] | undefined {
  const { case: kind, value } = body;

  switch (kind) {
    case 'text':
      return {
        kind,
        value: {
          text: value.text,
          color: value.color,
          fontFamily: value.fontFamily,
          fontSize: value.fontSize,
          align: alignment.get(value.align),
        },
      };
    case 'document':
      return {
        kind,
        value: {
          title: value.title,
          document: {
            schemaVersion: value.schemaVersion,
            blocks: value.blocks.map((block) => readDocumentBlock(block, resolveAssetUrl)),
          },
        },
      };
    case 'embed':
      return {
        kind,
        value: {
          title: value.title,
          html: value.html,
          sourceRevision: value.sourceRevision,
          state: value.state && toJson(ValueSchema, value.state),
        },
      };
    case 'todo':
      return {
        kind,
        value: {
          title: value.title,
          items: value.items.map(({ itemId, text, checked, sourceRef }) => ({
            id: itemId,
            text,
            checked,
            sourceRef: readTodoSource(sourceRef),
          })),
        },
      };
    case 'table':
      return { kind, value: { text: value.text, data: readGrid(value.grid) } };
    case 'image': {
      const { src, href, crop, naturalSize } = value;

      return {
        kind,
        value: {
          src,
          href,
          crop: crop && { zoom: crop.zoom, x: crop.x, y: crop.y },
          naturalSize: naturalSize && { width: naturalSize.width, height: naturalSize.height },
        },
      };
    }
    case 'video':
      return { kind, value: { src: value.src, poster: value.poster } };
    case 'link':
      return { kind, value: { href: value.href } };
    case 'sticker':
      return { kind, value: { id: value.stickerId, fallback: value.fallback } };
    case 'ink':
      return { kind, points: value.points.map(readPoint) };
    case 'extension':
      return { kind, value: { schemaId: value.schemaId, data: value.data } };
    case undefined:
      return undefined;
  }
}

function readPayload(
  { objectId: id, result }: ObjectPayloadResult,
  resolveAssetUrl: ResolveAssetUrl,
): WhiteboardPayloadResult {
  if (result.case === 'unavailable') {
    return {
      kind: 'unavailable',
      id,
      reason: unavailableReasons.get(result.value.reason) ?? 'unknown',
    };
  }
  if (result.case !== 'payload') {
    throw new Error('Whiteboard response is missing an object payload result.');
  }

  const version = requireField(result.value.payloadVersion, 'object payload version');
  const body = readBody(result.value.body, resolveAssetUrl);

  return body
    ? { kind: 'loaded', payload: { id, version, body } }
    : { kind: 'unavailable', id, reason: 'unsupportedKind' };
}

export function readPayloads(
  results: readonly ObjectPayloadResult[],
  expectedIds: readonly string[],
  resolveAssetUrl: ResolveAssetUrl,
): readonly WhiteboardPayloadResult[] {
  const remaining = new Set(expectedIds);
  const payloads = results.map((result) => {
    if (!remaining.delete(result.objectId)) {
      throw new Error('Whiteboard response has an unexpected or duplicate payload object ID.');
    }

    return readPayload(result, resolveAssetUrl);
  });

  if (remaining.size > 0) {
    throw new Error('Whiteboard response omitted requested payload object IDs.');
  }

  return payloads;
}
