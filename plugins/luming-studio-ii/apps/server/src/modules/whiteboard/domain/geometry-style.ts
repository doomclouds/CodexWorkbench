import type { BoardObjectStylePatch } from './geometry-parity.js';
import type { Appearance, BoardObject, GeometryDetail, JsonObject } from './model.js';

const colorValue = /^(?:transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/iu;
const shapes = new Set([
  'rounded',
  'rect',
  'ellipse',
  'diamond',
  'pill',
  'hexagon',
  'parallelogram',
  'database',
  'queue',
  'document',
  'cloud',
  'person',
]);
const align = new Set(['TEXT_ALIGNMENT_LEFT', 'TEXT_ALIGNMENT_CENTER', 'TEXT_ALIGNMENT_RIGHT']);
const maxLabelBytes = 4096;
const encoder = new TextEncoder();

export function validStylePatch(patch: BoardObjectStylePatch): boolean {
  const palette = [patch.fill, patch.stroke, patch.textColor].every(
    (value) => value === undefined || colorValue.test(value),
  );
  const stroke =
    patch.strokeWidth === undefined ||
    (Number.isFinite(patch.strokeWidth) && patch.strokeWidth >= 0 && patch.strokeWidth <= 100);
  const fontSize =
    patch.fontSize === undefined ||
    (Number.isFinite(patch.fontSize) && patch.fontSize >= 1 && patch.fontSize <= 512);
  const fontFamily =
    patch.fontFamily === undefined ||
    (patch.fontFamily.length <= 128 && !/\p{Cc}/u.test(patch.fontFamily));
  const shape =
    patch.shapeForm === undefined || patch.shapeForm === 'text' || shapes.has(patch.shapeForm);
  const alignment = patch.textAlign === undefined || align.has(patch.textAlign);
  const label =
    patch.label === undefined || encoder.encode(patch.label).byteLength <= maxLabelBytes;

  return (
    [palette, stroke, fontSize, fontFamily, shape, alignment, label].every(Boolean) &&
    Object.values(patch).some((value) => value !== undefined)
  );
}

export function styleTouchesText(patch: BoardObjectStylePatch): boolean {
  return [
    patch.textColor,
    patch.fontFamily,
    patch.fontSize,
    patch.textAlign,
    patch.bold,
    patch.italic,
  ].some((value) => value !== undefined);
}

export function styleTouchesObject(patch: BoardObjectStylePatch): boolean {
  const { fill, stroke, strokeWidth, dashed, hollow, shapeForm, startHead, endHead } = patch;

  return [
    fill,
    stroke,
    strokeWidth,
    dashed,
    hollow,
    shapeForm,
    startHead,
    endHead,
    patch.label,
  ].some((value) => value !== undefined);
}

export function styleChangesObjectKind(object: BoardObject, patch: BoardObjectStylePatch) {
  const { shapeForm } = patch;
  if (shapeForm === undefined) {
    return false;
  }

  const nextKind = shapeForm === 'text' ? 'text' : 'shape';

  return nextKind !== object.kind;
}

export function objectAllowsStyle(object: BoardObject, patch: BoardObjectStylePatch): boolean {
  const { shapeForm, startHead, endHead } = patch;
  const supportsForm = shapeForm === undefined || object.kind === 'text' || object.kind === 'shape';
  const connectorHeads = startHead !== undefined || endHead !== undefined;
  const supportsHeads = !connectorHeads || object.detail?.kind === 'connector';
  const supportsLabel = patch.label === undefined || object.kind === 'section';

  return supportsForm && supportsHeads && supportsLabel;
}

function appearanceOf(object: BoardObject, patch: BoardObjectStylePatch): Appearance | undefined {
  const { fill, stroke, strokeWidth, dashed, hollow } = patch;
  if ([fill, stroke, strokeWidth, dashed, hollow].every((value) => value === undefined)) {
    return object.appearance;
  }

  return {
    ...object.appearance,
    ...(fill === undefined ? {} : { fill }),
    ...(stroke === undefined ? {} : { stroke }),
    ...(strokeWidth === undefined ? {} : { strokeWidth }),
    ...(dashed === undefined ? {} : { dashed }),
    ...(hollow === undefined ? {} : { hollow }),
  };
}

function formOf(object: BoardObject, shapeForm: string | undefined): string {
  if (shapeForm === undefined) {
    return object.kind;
  }

  return shapeForm === 'text' ? 'text' : 'shape';
}

function styledDetail(
  object: BoardObject,
  { shapeForm, startHead, endHead, fill, strokeWidth }: BoardObjectStylePatch,
): GeometryDetail | undefined {
  if (shapeForm !== undefined) {
    return shapeForm === 'text' ? undefined : { kind: 'shape', outline: shapeForm };
  }

  const { detail } = object;
  if (detail?.kind === 'connector') {
    return {
      ...detail,
      startHead: startHead ?? detail.startHead,
      endHead: endHead ?? detail.endHead,
    };
  }
  if (detail?.kind === 'section' && fill !== undefined) {
    return { ...detail, transparent: fill === 'transparent' };
  }
  if (detail?.kind === 'ink' && strokeWidth !== undefined && strokeWidth > 0) {
    return { ...detail, width: strokeWidth };
  }

  return detail;
}

export function styledObject(object: BoardObject, patch: BoardObjectStylePatch): BoardObject {
  return {
    ...object,
    kind: formOf(object, patch.shapeForm),
    label: patch.label === undefined ? object.label : sectionTitle(patch.label),
    geometryVersion: object.geometryVersion + 1n,
    appearance: appearanceOf(object, patch),
    detail: styledDetail(object, patch),
  };
}

function sectionTitle(label: string): string {
  return label.trim() || '分区';
}

export function styledText(current: JsonObject, patch: BoardObjectStylePatch): JsonObject {
  const { textColor, fontSize, fontFamily, textAlign, label, bold, italic } = patch;

  return {
    ...current,
    ...(textColor === undefined ? {} : { color: textColor }),
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(textAlign === undefined ? {} : { align: textAlign }),
    ...(label === undefined ? {} : { text: sectionTitle(label) }),
    ...(bold === undefined ? {} : { bold }),
    ...(italic === undefined ? {} : { italic }),
  };
}
