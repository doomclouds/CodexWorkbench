import { Buffer } from 'node:buffer';
import { archiveTooLarge, invalidArchive } from './archive-read-error.js';

const MAX_DEPTH = 64;
const MAX_VALUE_NODES = 1_000_000;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

type ArchiveRecord = Record<string, unknown>;
type NamedField = [string, unknown];
type Primitive = string | number | boolean | null;

export interface ArchiveValueBudget {
  readonly maximum: number;
  bytes: number;
  nodes: number;
}

interface ArchiveText {
  readonly value: string;
  readonly bytes: number;
}

export function archiveRecord(value: unknown): ArchiveRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArchive('Expected an archive record');
  }

  return value as ArchiveRecord;
}

export function archiveArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw invalidArchive('Expected an archive sequence');
  }

  return value;
}

export function archiveIndex(value: unknown, count: number): number {
  const integer = typeof value === 'number' && Number.isSafeInteger(value);
  if (!integer || value < 0 || value >= count) {
    throw invalidArchive('Invalid archive record reference');
  }

  return value;
}

export function archiveFields(value: unknown): ReadonlyMap<string, unknown> {
  const fields = new Map<string, unknown>();
  for (const entry of archiveArray(value)) {
    const pair = archiveArray(entry);
    const [name, element] = pair;
    if (pair.length !== 2 || typeof name !== 'string' || fields.has(name)) {
      throw invalidArchive('Invalid or duplicate archive field');
    }

    fields.set(name, element);
  }

  return fields;
}

function primitive(value: unknown): value is Primitive {
  const scalar = value === null || typeof value === 'string' || typeof value === 'boolean';

  return scalar || (typeof value === 'number' && Number.isFinite(value));
}

function reserve(budget: ArchiveValueBudget, bytes: number): void {
  budget.bytes += bytes;
  budget.nodes++;
  if (budget.bytes > budget.maximum || budget.nodes > MAX_VALUE_NODES) {
    throw archiveTooLarge();
  }
}

function jsonBytes(value: Primitive): number {
  return Buffer.byteLength(JSON.stringify(value));
}

export class ArchiveValueReader {
  private readonly textByIndex = new Map<number, ArchiveText>();

  constructor(
    private readonly texts: readonly unknown[],
    private readonly payloads: readonly unknown[],
  ) {}

  private text(reference: unknown): ArchiveText {
    const index = archiveIndex(reference, this.texts.length);
    const cached = this.textByIndex.get(index);
    if (cached) {
      return cached;
    }

    const value = this.texts[index];
    if (typeof value !== 'string') {
      throw invalidArchive('Invalid archive text reference');
    }
    if (Buffer.byteLength(value) > MAX_TEXT_BYTES) {
      throw archiveTooLarge();
    }

    const text = { value, bytes: jsonBytes(value) };
    this.textByIndex.set(index, text);
    return text;
  }

  private object(value: unknown, budget: ArchiveValueBudget, depth: number): ArchiveRecord {
    const fields = archiveFields(value);
    reserve(budget, 2 + Math.max(0, fields.size - 1));
    const entries: NamedField[] = [];
    for (const [key, element] of fields) {
      reserve(budget, jsonBytes(key) + 1);
      entries.push([key, this.value(element, budget, depth + 1)]);
    }

    return Object.fromEntries(entries);
  }

  private value(encoded: unknown, budget: ArchiveValueBudget, depth: number): unknown {
    if (depth > MAX_DEPTH) {
      throw archiveTooLarge();
    }

    if (primitive(encoded)) {
      reserve(budget, jsonBytes(encoded));
      return encoded;
    }

    const wrapped = archiveRecord(encoded);
    const keys = Object.keys(wrapped);
    if (keys.length !== 1) {
      throw invalidArchive('Invalid archive value wrapper');
    }

    if (Object.hasOwn(wrapped, 'text')) {
      const text = this.text(wrapped.text);
      reserve(budget, text.bytes);
      return text.value;
    }
    if (Object.hasOwn(wrapped, 'array')) {
      const elements = archiveArray(wrapped.array);
      reserve(budget, 2 + Math.max(0, elements.length - 1));
      return elements.map((element) => this.value(element, budget, depth + 1));
    }
    if (Object.hasOwn(wrapped, 'object')) {
      return this.object(wrapped.object, budget, depth);
    }

    throw invalidArchive('Invalid archive value type');
  }

  payload(reference: unknown, budget: ArchiveValueBudget): unknown {
    const index = archiveIndex(reference, this.payloads.length);

    return this.value(this.payloads[index], budget, 0);
  }
}
