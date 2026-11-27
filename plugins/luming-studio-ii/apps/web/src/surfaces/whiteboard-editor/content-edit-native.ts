import type {
  EditObjectContentOperation,
  WhiteboardTableContent,
} from '../../data/whiteboard/index.js';
import type { CanvasObjectIntent, CanvasObjectKind } from '../../ui/domain/canvas/index.js';
import { isJson, list, record } from './content-edit-value.js';

type TableCell = WhiteboardTableContent['rows'][number][number];

const maxImageDimension = 4_294_967_295;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalFlag(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function stringList(value: unknown): value is readonly string[] {
  return list(value) && value.every((item) => typeof item === 'string');
}

function numberList(value: unknown): value is readonly number[] {
  return list(value) && value.every(finite);
}

function cell(value: unknown): value is TableCell {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value);
}

function tableRow(value: unknown): value is readonly TableCell[] {
  return list(value) && value.every(cell);
}

function tableContent(value: Record<string, unknown>): WhiteboardTableContent | undefined {
  const { text, data } = value;
  if (!optionalText(text) || !record(data)) {
    return undefined;
  }

  const { rows, rowIds, columnIds, columnWidths, head } = data;
  const hasRows = list(rows) && rows.every(tableRow);
  const identified = stringList(rowIds) && stringList(columnIds);
  const formatted = optionalFlag(head) && (columnWidths === undefined || numberList(columnWidths));
  if (!hasRows || !identified || !formatted) {
    return undefined;
  }

  return { text, rows, rowIds, columnIds, columnWidths, head };
}

function readTableEdit(intent: CanvasObjectIntent): EditObjectContentOperation | undefined {
  const { name, objectId, expectedVersion, value: draft } = intent;
  if (name !== 'table.save' || !record(draft)) {
    return undefined;
  }

  const { base, value } = draft;
  if (!record(base) || !record(value) || base.version !== expectedVersion) {
    return undefined;
  }

  const ownsTable = base.id === objectId && value.id === objectId;
  if (!ownsTable || !finite(base.width) || !finite(value.width)) {
    return undefined;
  }

  const content = tableContent(value);
  if (!content) {
    return undefined;
  }

  const layoutChanged = base.width !== value.width || draft.layoutChanged === true;
  const widthChange = layoutChanged ? { expectedWidth: base.width, width: value.width } : undefined;

  return { kind: 'table', value: content, widthChange };
}

function readEmbedEdit(intent: CanvasObjectIntent): EditObjectContentOperation | undefined {
  const { name, value } = intent;
  if (!record(value)) {
    return undefined;
  }
  if (name === 'embed.save-state' && isJson(value.state)) {
    return { kind: 'embedState', value: value.state };
  }
  if (name !== 'embed.save-source') {
    return undefined;
  }

  const { title, html, expectedSourceRevision } = value;
  const validRevision =
    finite(expectedSourceRevision) &&
    Number.isSafeInteger(expectedSourceRevision) &&
    expectedSourceRevision >= 0;

  if (typeof title !== 'string' || typeof html !== 'string' || !validRevision) {
    return undefined;
  }

  return {
    kind: 'embedSource',
    value: { title, html, expectedSourceRevision: BigInt(expectedSourceRevision) },
  };
}

function readStickerEdit(intent: CanvasObjectIntent): EditObjectContentOperation | undefined {
  const { name, value } = intent;
  if (name !== 'sticker.select' || !record(value)) {
    return undefined;
  }
  if (typeof value.id === 'string' && value.fallback === undefined) {
    return { kind: 'sticker', value: { id: value.id } };
  }
  if (value.id === undefined && typeof value.fallback === 'string') {
    return { kind: 'sticker', value: { fallback: value.fallback } };
  }
}

function imageDimension(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value) && value > 0 && value <= maxImageDimension;
}

function readNaturalSize(value: unknown) {
  if (!record(value)) {
    return undefined;
  }

  const { width, height } = value;

  return imageDimension(width) && imageDimension(height) ? { width, height } : undefined;
}

function readCropEdit(intent: CanvasObjectIntent): EditObjectContentOperation | undefined {
  const { name, value } = intent;
  if (name !== 'media.crop' || !record(value) || !record(value.crop)) {
    return undefined;
  }

  const { zoom, x, y } = value.crop;
  if (!finite(zoom) || !finite(x) || !finite(y)) {
    return undefined;
  }

  const naturalSize = readNaturalSize(value.naturalSize);
  if (value.naturalSize !== undefined && !naturalSize) {
    return undefined;
  }

  return { kind: 'crop', value: { crop: { zoom, x, y }, naturalSize } };
}

const nativeReaders = new Map<
  CanvasObjectKind,
  (intent: CanvasObjectIntent) => EditObjectContentOperation | undefined
>([
  ['table', readTableEdit],
  ['html', readEmbedEdit],
  ['diagram', readEmbedEdit],
  ['sticker', readStickerEdit],
  ['image', readCropEdit],
]);

export function readNativeContentEdit(
  intent: CanvasObjectIntent,
): EditObjectContentOperation | undefined {
  return nativeReaders.get(intent.kind)?.(intent);
}
