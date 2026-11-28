import { addsInlineEmbedResource } from './embed-resource-validation.js';
import type { JsonObject, JsonValue, PayloadRecord } from './model.js';
import { canAdvanceVersion } from './movement.js';
import {
  contentFits,
  contentRecord,
  contentTitleLimit,
  type ContentOperation,
  type ContentPayloadDecision,
  type ContentPayloadPlan,
} from './object-content-edits.js';

type EmbedSourceEdit = Extract<ContentOperation, { kind: 'embedSource' }>;

const maxStateDepth = 16;
const maxStateBytes = 64 * 1024;
const sourceVersionPattern = /^(?:0|[1-9]\d{0,18})$/u;
const largestVersion = (1n << 63n) - 1n;
const encoder = new TextEncoder();

function embedSourceRevision({ data, payloadVersion }: PayloadRecord): bigint | undefined {
  const saved = data.sourceRevision;
  if (saved === undefined) {
    return payloadVersion;
  }
  if (typeof saved === 'number' && Number.isSafeInteger(saved) && saved >= 0) {
    return BigInt(saved);
  }

  if (typeof saved === 'string' && sourceVersionPattern.test(saved)) {
    const revision = BigInt(saved);

    return revision <= largestVersion ? revision : undefined;
  }
}

function validStateLeaf(state: JsonValue, depth: number): boolean {
  if (depth > maxStateDepth) {
    return false;
  }
  if (Array.isArray(state)) {
    return state.every((entry) => validStateLeaf(entry, depth + 1));
  }

  const record = contentRecord(state);
  if (record) {
    return Object.values(record).every((entry) => validStateLeaf(entry, depth + 1));
  }

  return typeof state !== 'number' || Number.isFinite(state);
}

function persistSource(data: JsonObject, label: string): ContentPayloadPlan {
  return contentFits(data)
    ? { kind: 'updated', data, label }
    : { kind: 'rejected', reason: 'tooLarge' };
}

export function editEmbedSource(
  current: PayloadRecord,
  { title, html, expectedSourceRevision }: EmbedSourceEdit,
): ContentPayloadDecision {
  const revision = embedSourceRevision(current);
  if (revision === undefined) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (revision !== expectedSourceRevision) {
    return { kind: 'conflict' };
  }

  const sourceChanged = html !== (current.data.html ?? '');
  if (sourceChanged && !canAdvanceVersion(revision)) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  const label = title.trim() || 'HTML 图解';
  if (label.length > contentTitleLimit || html.length > 1024 * 1024) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const previous = typeof current.data.html === 'string' ? current.data.html : '';
  if (addsInlineEmbedResource(html, previous)) {
    return { kind: 'rejected', reason: 'inlineHtmlResource' };
  }

  const sourceRevision = (sourceChanged ? revision + 1n : revision).toString();

  return persistSource({ ...current.data, title: label, html, sourceRevision }, label);
}

export function editEmbedState(
  current: PayloadRecord,
  label: string,
  state: JsonValue,
): ContentPayloadPlan {
  const revision = embedSourceRevision(current);
  if (revision === undefined) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }
  if (!contentRecord(state) || !validStateLeaf(state, 0)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const encoded = JSON.stringify(state);
  if (encoded.length > maxStateBytes || encoder.encode(encoded).byteLength > maxStateBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  return {
    kind: 'updated',
    data: { ...current.data, state, sourceRevision: revision.toString() },
    label,
  };
}
