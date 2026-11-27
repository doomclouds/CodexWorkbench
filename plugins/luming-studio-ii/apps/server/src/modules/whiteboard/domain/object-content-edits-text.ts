import type { JsonObject, JsonValue } from './model.js';
import { contentFits, type ContentPayloadPlan } from './object-content-edits.js';

const alignment = new Set([
  'TEXT_ALIGNMENT_UNSPECIFIED',
  'TEXT_ALIGNMENT_LEFT',
  'TEXT_ALIGNMENT_CENTER',
  'TEXT_ALIGNMENT_RIGHT',
]);
const maxStyleLength = 256;

function validStyle(value: JsonValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxStyleLength);
}

function validSize(value: JsonValue | undefined): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function validAlignment(value: JsonValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && alignment.has(value));
}

export function editTextContent(edit: JsonObject, current: JsonObject): ContentPayloadPlan {
  const { text, color, fontFamily, fontSize, align, bold, italic } = edit;
  const validFormatting = validStyle(color) && validStyle(fontFamily) && validSize(fontSize);
  const flags = [bold, italic].every((value) => value === undefined || typeof value === 'boolean');
  const validTextStyle = validAlignment(align) && flags;
  if (typeof text !== 'string' || !validFormatting || !validTextStyle) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const data = { ...current, ...edit };
  if (align === 'TEXT_ALIGNMENT_UNSPECIFIED' && current.align !== undefined) {
    data.align = current.align;
  }

  if (!contentFits(data)) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  return { kind: 'updated', label: text, data };
}
