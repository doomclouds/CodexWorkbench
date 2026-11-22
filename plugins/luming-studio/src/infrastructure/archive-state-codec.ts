import { createHash } from 'node:crypto';
import type { ArtifactState } from '../core/ports/studio-repository.js';
import { isRecord } from '../shared/is-record.js';
import { invalidArchive, StudioError } from '../shared/studio-error.js';

export const MAX_ARCHIVE_STATE_BYTES = 64 * 1024 * 1024;

const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const MAX_COLLECTION_RECORDS = 100_000;
const MAX_HISTORY = 200;
const MAX_UNITS = 4_000;
const MAX_DEPTH = 64;
const MAX_JSON_DEPTH = MAX_DEPTH * 3 + 12;
const MAX_JSON_STRUCTURE = 2_000_000;
const MAX_VALUE_NODES = 1_000_000;
const MAX_STATE_FIELDS = 64;
const INLINE_TEXT_LENGTH = 1024;
const CODEC_VERSION = 1;
const DELTA_CODEC_VERSION = 2;
const ARCHIVE_CHUNK_BYTES = 64 * 1024;

type Primitive = null | boolean | number | string;
type EncodedValue = Primitive | EncodedArray | EncodedObject | TextReference;

interface EncodedArray {
  array: EncodedValue[];
}

interface EncodedObject {
  object: [string, EncodedValue][];
}

interface TextReference {
  text: number;
}

interface UnitContent {
  fields: number;
  units: number[];
}

type EncodedContent = number | UnitContent;
type HistoryReferences = [entry: number, artifact: number, content: number];

interface DeltaContent {
  base: number;
  fields: number;
  length: number;
  changes: [ordinal: number, payload: number][];
}

interface ArchiveState {
  version: number;
  texts: string[];
  payloads: EncodedValue[];
  contents: (EncodedContent | DeltaContent)[];
  properties: [string, number][];
  current: number;
  history: HistoryReferences[];
}

interface ValueSize {
  bytes: number;
  nodes: number;
}

interface DecodedValue {
  value: unknown;
  size: ValueSize;
}

function tooLarge(): StudioError {
  return new StudioError('TOO_LARGE', '备份状态超过归档容量。');
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function assertLimit(value: number, maximum: number): void {
  if (value > maximum) {
    throw tooLarge();
  }
}

function checkDepth(depth: number): void {
  if (depth > MAX_DEPTH) {
    throw invalidArchive('备份状态嵌套过深或存在循环。');
  }
}

function sequence(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidArchive('备份状态序列无效。');
  }

  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidArchive('备份状态记录无效。');
  }

  return value;
}

function reference(value: unknown, length: number): number {
  const integer = typeof value === 'number' && Number.isSafeInteger(value);
  if (!integer || value < 0 || value >= length) {
    throw invalidArchive('备份状态引用无效。');
  }

  return value;
}

function addSize(total: ValueSize, bytes: number, nodes = 0): void {
  total.bytes += bytes;
  total.nodes += nodes;
  assertLimit(total.bytes, MAX_ARCHIVE_STATE_BYTES);
  assertLimit(total.nodes, MAX_VALUE_NODES);
}

function contentSize(size: ValueSize): void {
  assertLimit(size.bytes, MAX_CONTENT_BYTES);
}

function startUnitContentSize(fields: ValueSize, hasFields: boolean, unitCount: number): ValueSize {
  const elementsProperty = jsonBytes('elements') + ':[]'.length;
  const total = { bytes: fields.bytes + elementsProperty + Number(hasFields), nodes: fields.nodes };
  addSize(total, Math.max(0, unitCount - 1), 1);
  contentSize(total);

  return total;
}

function addUnitSize(total: ValueSize, unit: ValueSize): void {
  addSize(total, unit.bytes, unit.nodes);
  contentSize(total);
}

function plainValue(value: unknown): value is Primitive {
  const simple = value === null || typeof value === 'boolean' || typeof value === 'string';

  return simple || (typeof value === 'number' && Number.isFinite(value));
}

function reserveValue(size: ValueSize, value: Primitive): void {
  if (typeof value === 'string') {
    assertLimit(Buffer.byteLength(value), MAX_CONTENT_BYTES);
  }

  addSize(size, jsonBytes(value), 1);
}

function propertiesOf(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).filter(([, item]) => item !== undefined);
}

function collectionSize(values: DecodedValue[]): void {
  const total = { bytes: 0, nodes: 0 };
  let records = 0;

  for (const item of values) {
    if (Array.isArray(item.value)) {
      records += item.value.length;
    } else if (isRecord(item.value)) {
      records += Object.keys(item.value).length;
    } else {
      records += 1;
    }

    addSize(total, item.size.bytes, item.size.nodes);
  }

  assertLimit(records, MAX_COLLECTION_RECORDS);
}

function indexedDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class ArchiveEncoder {
  readonly texts: string[] = [];
  readonly payloads: EncodedValue[] = [];
  readonly contents: (EncodedContent | DeltaContent)[] = [];
  private readonly textIds = new Map<string, { id: number; bytes: number }>();
  private readonly payloadIds = new Map<string, number>();
  private readonly contentIds = new Map<string, number>();
  private readonly knownPayloads = new WeakMap<object, number>();
  private readonly knownContents = new WeakMap<object, number>();
  private readonly sizes: ValueSize[] = [];
  private encodedBytes = 0;
  private lastUnits: { id: number; content: UnitContent } | undefined;

  constructor(private readonly deltas = false) {}

  private reserve(encoded: string): void {
    this.encodedBytes += Buffer.byteLength(encoded) + 1;
    assertLimit(this.encodedBytes, MAX_ARCHIVE_STATE_BYTES);
  }

  private text(value: string, size: ValueSize): TextReference {
    let entry = this.textIds.get(value);
    if (!entry) {
      assertLimit(Buffer.byteLength(value), MAX_CONTENT_BYTES);
      const json = JSON.stringify(value);
      this.reserve(json);
      entry = { id: this.texts.length, bytes: Buffer.byteLength(json) };
      this.texts.push(value);
      this.textIds.set(value, entry);
    }

    addSize(size, entry.bytes, 1);

    return { text: entry.id };
  }

  private encodeValue(value: unknown, size: ValueSize, depth: number): EncodedValue {
    checkDepth(depth);
    if (typeof value === 'string' && value.length > INLINE_TEXT_LENGTH) {
      return this.text(value, size);
    }

    if (plainValue(value)) {
      reserveValue(size, value);

      return value;
    }

    if (Array.isArray(value)) {
      addSize(size, 2 + Math.max(0, value.length - 1), 1);
      assertLimit(value.length, MAX_VALUE_NODES);

      return {
        array: Array.from(value, (item) => this.encodeValue(item ?? null, size, depth + 1)),
      };
    }

    const entries = propertiesOf(record(value));
    addSize(size, 2 + Math.max(0, entries.length - 1), 1);

    return {
      object: entries.map(([name, item]) => {
        addSize(size, jsonBytes(name) + 1);

        return [name, this.encodeValue(item, size, depth + 1)];
      }),
    };
  }

  payload(value: unknown): number {
    const known = value && typeof value === 'object' ? this.knownPayloads.get(value) : undefined;
    if (known !== undefined) {
      return known;
    }

    const size = { bytes: 0, nodes: 0 };
    const encoded = this.encodeValue(value, size, 0);
    const json = JSON.stringify(encoded);
    const digest = indexedDigest(json);
    let id = this.payloadIds.get(digest);
    if (id === undefined) {
      this.reserve(json);
      id = this.payloads.length;
      this.payloads.push(encoded);
      this.sizes.push(size);
      this.payloadIds.set(digest, id);
    }
    if (value && typeof value === 'object') {
      this.knownPayloads.set(value, id);
    }

    return id;
  }

  properties(value: Record<string, unknown>): [string, number][] {
    const entries = propertiesOf(value);
    assertLimit(entries.length, MAX_STATE_FIELDS);
    const properties = entries.map(([name, item]): [string, number] => [name, this.payload(item)]);
    collectionSize(
      entries.map(([, item], index) => ({
        value: item,
        size: this.sizes[properties[index]![1]]!,
      })),
    );

    return properties;
  }

  history(history: ArtifactState<unknown>['history']): HistoryReferences[] {
    assertLimit(history.length, MAX_HISTORY);
    const size = { bytes: 0, nodes: 0 };

    return history.map((version) => {
      const entry = this.payload(version.entry);
      const artifact = this.payload(version.artifact);
      const fields = [this.sizes[entry]!, this.sizes[artifact]!];
      for (const field of fields) {
        addSize(size, field.bytes, field.nodes);
      }

      return [entry, artifact, this.content(version.content)];
    });
  }

  private encodeContent(value: unknown): EncodedContent {
    if (!isRecord(value) || !Array.isArray(value.elements)) {
      const payload = this.payload(value);
      contentSize(this.sizes[payload]!);

      return payload;
    }

    const { elements, ...fields } = value;
    assertLimit(elements.length, MAX_UNITS);
    const fieldId = this.payload(fields);
    const size = startUnitContentSize(
      this.sizes[fieldId]!,
      propertiesOf(fields).length > 0,
      elements.length,
    );
    const units = elements.map((element) => {
      const id = this.payload(element);
      addUnitSize(size, this.sizes[id]!);

      return id;
    });

    return { fields: fieldId, units };
  }

  content(value: unknown): number {
    const known = value && typeof value === 'object' ? this.knownContents.get(value) : undefined;
    if (known !== undefined) {
      return known;
    }

    const encoded = this.encodeContent(value);
    const json = JSON.stringify(encoded);
    const digest = indexedDigest(json);
    let id = this.contentIds.get(digest);
    if (id === undefined) {
      id = this.contents.length;
      const stored = this.storedContent(id, encoded, json.length);
      this.reserve(stored === encoded ? json : JSON.stringify(stored));
      this.contents.push(stored);
      this.contentIds.set(digest, id);
    }
    if (value && typeof value === 'object') {
      this.knownContents.set(value, id);
    }

    return id;
  }

  private storedContent(
    id: number,
    content: EncodedContent,
    fullSize: number,
  ): EncodedContent | DeltaContent {
    if (!this.deltas || typeof content === 'number') {
      return content;
    }

    const previous = this.lastUnits;
    this.lastUnits = { id, content };
    if (!previous) {
      return content;
    }

    const changes: DeltaContent['changes'] = [];
    for (const [ordinal, payload] of content.units.entries()) {
      if (previous.content.units[ordinal] !== payload) {
        changes.push([ordinal, payload]);
      }
    }

    const delta: DeltaContent = {
      base: previous.id,
      fields: content.fields,
      length: content.units.length,
      changes,
    };

    return JSON.stringify(delta).length < fullSize ? delta : content;
  }
}

function checkJsonStructure(source: string): number {
  let depth = 0;
  let structure = 0;
  let inString = false;

  for (let index = 0; index < source.length; index++) {
    const token = source[index];
    if (inString) {
      if (token === '\\') {
        index++;
      } else if (token === '"') {
        inString = false;
      }

      continue;
    }

    if (token === '"') {
      inString = true;
    } else if (token === '{' || token === '[') {
      depth++;
      structure++;
      assertLimit(depth, MAX_JSON_DEPTH);
    } else if (token === '}' || token === ']') {
      depth--;
    } else if (token === ',') {
      structure++;
    }

    assertLimit(structure, MAX_JSON_STRUCTURE);
  }

  return structure;
}

function stateEnvelope(bytes: Uint8Array): Record<string, unknown> {
  assertLimit(bytes.byteLength, MAX_ARCHIVE_STATE_BYTES);
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    checkJsonStructure(source);

    return record(JSON.parse(source));
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw invalidArchive('备份状态 JSON 无效。', { cause: error });
  }
}

function namedEntries<T>(
  value: unknown,
  visit: (name: string, value: unknown) => T,
): [string, T][] {
  const seen = new Set<string>();

  return sequence(value).map((item) => {
    const pair = sequence(item);
    const [name, value] = pair;
    if (pair.length !== 2 || typeof name !== 'string' || seen.has(name)) {
      throw invalidArchive('备份状态包含无效或重复的字段。');
    }

    seen.add(name);

    return [name, visit(name, value)];
  });
}

class ArchiveDecoder {
  private readonly textSizes = new Map<number, number>();
  private readonly decodedPayloads = new Map<number, DecodedValue>();
  private readonly decodedContents = new Map<number, unknown>();

  constructor(
    private readonly texts: unknown[],
    private readonly payloads: unknown[],
    private readonly contents: unknown[],
  ) {}

  private readText(value: unknown, size: ValueSize): string {
    const id = reference(value, this.texts.length);
    const text = this.texts[id];
    if (typeof text !== 'string') {
      throw invalidArchive('备份状态文本引用无效。');
    }

    let bytes = this.textSizes.get(id);
    if (bytes === undefined) {
      assertLimit(Buffer.byteLength(text), MAX_CONTENT_BYTES);
      bytes = jsonBytes(text);
      this.textSizes.set(id, bytes);
    }

    addSize(size, bytes, 1);

    return text;
  }

  private readValue(value: unknown, size: ValueSize, depth: number): unknown {
    checkDepth(depth);
    if (plainValue(value)) {
      reserveValue(size, value);

      return value;
    }

    const wrapped = record(value);
    if (Object.keys(wrapped).length !== 1) {
      throw invalidArchive('备份状态值无效。');
    }
    if (Object.hasOwn(wrapped, 'text')) {
      return this.readText(wrapped.text, size);
    }

    if (Object.hasOwn(wrapped, 'array')) {
      const array = sequence(wrapped.array);
      assertLimit(array.length, MAX_VALUE_NODES);
      addSize(size, 2 + Math.max(0, array.length - 1), 1);

      return array.map((item) => this.readValue(item, size, depth + 1));
    }

    const entries = sequence(wrapped.object);
    addSize(size, 2 + Math.max(0, entries.length - 1), 1);

    return Object.fromEntries(
      namedEntries(entries, (name, item) => {
        addSize(size, jsonBytes(name) + 1);

        return this.readValue(item, size, depth + 1);
      }),
    );
  }

  payload(value: unknown): DecodedValue {
    const id = reference(value, this.payloads.length);
    const cached = this.decodedPayloads.get(id);
    if (cached) {
      return cached;
    }

    const size = { bytes: 0, nodes: 0 };
    const decoded = { size, value: this.readValue(this.payloads[id], size, 0) };
    this.decodedPayloads.set(id, decoded);

    return decoded;
  }

  private readContent(encoded: unknown): unknown {
    if (typeof encoded === 'number') {
      const payload = this.payload(encoded);
      contentSize(payload.size);
      if (isRecord(payload.value) && Array.isArray(payload.value.elements)) {
        assertLimit(payload.value.elements.length, MAX_UNITS);
      }

      return payload.value;
    }

    const content = record(encoded);
    if (Object.keys(content).length !== 2) {
      throw invalidArchive('备份状态内容无效。');
    }

    const units = sequence(content.units);
    assertLimit(units.length, MAX_UNITS);
    const fields = this.payload(content.fields);
    const value = record(fields.value);
    if (Object.hasOwn(value, 'elements')) {
      throw invalidArchive('备份状态的对象列表重复。');
    }

    const size = startUnitContentSize(fields.size, Object.keys(value).length > 0, units.length);
    const elements = units.map((id) => {
      const element = this.payload(id);
      addUnitSize(size, element.size);

      return element.value;
    });

    return { ...value, elements };
  }

  content(value: unknown): unknown {
    const id = reference(value, this.contents.length);
    if (!this.decodedContents.has(id)) {
      this.decodedContents.set(id, this.readContent(this.contents[id]));
    }

    return this.decodedContents.get(id);
  }

  history(history: unknown[]): unknown[] {
    const size = { bytes: 0, nodes: 0 };

    return history.map((item) => {
      const slots = sequence(item);
      if (slots.length !== 3) {
        throw invalidArchive('备份状态历史引用无效。');
      }

      const entry = this.payload(slots[0]);
      const artifact = this.payload(slots[1]);
      for (const field of [entry, artifact]) {
        addSize(size, field.size.bytes, field.size.nodes);
      }

      return {
        entry: { ...record(entry.value) },
        artifact: { ...record(artifact.value) },
        content: this.content(slots[2]),
      };
    });
  }

  assertComplete(): void {
    if (
      this.decodedPayloads.size !== this.payloads.length ||
      this.decodedContents.size !== this.contents.length ||
      this.textSizes.size !== this.texts.length
    ) {
      throw invalidArchive('备份状态包含未使用的数据。');
    }
  }
}

export function encodeArchiveState(state: ArtifactState<unknown>): Uint8Array {
  const { content, history, ...properties } = state;
  const encoder = new ArchiveEncoder();
  const envelope: ArchiveState = {
    version: CODEC_VERSION,
    texts: encoder.texts,
    payloads: encoder.payloads,
    contents: encoder.contents,
    properties: encoder.properties(properties),
    current: encoder.content(content),
    history: encoder.history(history),
  };
  const json = JSON.stringify(envelope);
  assertLimit(Buffer.byteLength(json), MAX_ARCHIVE_STATE_BYTES);
  checkJsonStructure(json);

  return Buffer.from(json);
}

export function decodeArchiveState(bytes: Uint8Array): unknown {
  const envelope = stateEnvelope(bytes);
  if (envelope.version !== CODEC_VERSION) {
    throw invalidArchive('备份状态版本无效。');
  }

  return decodeEnvelope(envelope);
}

function decodeEnvelope(envelope: Record<string, unknown>): unknown {
  const history = sequence(envelope.history);
  assertLimit(history.length, MAX_HISTORY);
  const properties = sequence(envelope.properties);
  assertLimit(properties.length, MAX_STATE_FIELDS);
  const contents = sequence(envelope.contents);
  assertLimit(contents.length, history.length + 1);
  const decoder = new ArchiveDecoder(
    sequence(envelope.texts),
    sequence(envelope.payloads),
    contents,
  );
  const current = decoder.content(envelope.current);
  const decoded = namedEntries(properties, (name, value) => {
    if (name === 'history' || name === 'content') {
      throw invalidArchive('备份状态重复定义作品内容。');
    }

    return decoder.payload(value);
  });
  collectionSize(decoded.map(([, item]) => item));
  const versions = decoder.history(history);
  decoder.assertComplete();

  return {
    ...Object.fromEntries(decoded.map(([key, item]) => [key, item.value])),
    content: current,
    history: versions,
  };
}

export async function* encodeDeltaArchiveState(
  state: ArtifactState<unknown>,
): AsyncIterable<Uint8Array> {
  const { content, history, ...properties } = state;
  const encoder = new ArchiveEncoder(true);
  const versions = encoder.history(history);
  const current = encoder.content(content);
  const encodedProperties = encoder.properties(properties);
  const header = {
    version: DELTA_CODEC_VERSION,
    properties: encodedProperties,
    current,
    history: versions,
    lengths: [encoder.texts.length, encoder.payloads.length, encoder.contents.length],
  };
  let bytes = 0;
  let structure = 0;
  const sections = [[header], encoder.texts, encoder.payloads, encoder.contents];
  for (const section of sections) {
    for (const value of section) {
      const line = JSON.stringify(value);
      structure += checkJsonStructure(line) + 1;
      assertLimit(structure, MAX_JSON_STRUCTURE);
      const encoded = Buffer.from(line + '\n');
      bytes += encoded.length;
      assertLimit(bytes, MAX_ARCHIVE_STATE_BYTES);

      for (let offset = 0; offset < encoded.length; offset += ARCHIVE_CHUNK_BYTES) {
        yield encoded.subarray(offset, offset + ARCHIVE_CHUNK_BYTES);
      }
    }
  }
}

async function* archiveLines(chunks: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let fragments: string[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.length;
    assertLimit(size, MAX_ARCHIVE_STATE_BYTES);
    const lines = utf8.decode(chunk, { stream: true }).split('\n');
    for (const piece of lines.slice(0, -1)) {
      fragments.push(piece);
      yield fragments.join('');
      fragments = [];
    }

    const tail = lines.at(-1);
    if (tail) {
      fragments.push(tail);
    }
  }

  const remainder = utf8.decode();
  if (remainder || fragments.length) {
    throw invalidArchive('备份状态记录不完整。');
  }
}

function restoreDelta(value: unknown, bases: unknown[]): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, 'base')) {
    return value;
  }
  if (Object.keys(value).length !== 4) {
    throw invalidArchive('备份状态增量无效。');
  }

  const parent = record(bases[reference(value.base, bases.length)]);
  const base = sequence(parent.units);
  const size = reference(value.length, MAX_UNITS + 1);
  const changes = sequence(value.changes);
  assertLimit(changes.length, size);
  const units = Array.from({ length: size }, (_, ordinal) => base[ordinal]);
  let previousOrdinal = -1;
  for (const change of changes) {
    const pair = sequence(change);
    const ordinal = reference(pair[0], size);
    if (pair.length !== 2 || previousOrdinal >= ordinal) {
      throw invalidArchive('备份状态增量顺序无效。');
    }

    units[ordinal] = pair[1];
    previousOrdinal = ordinal;
  }

  return { fields: value.fields, units };
}

class DeltaArchiveReader {
  private structure = 0;

  constructor(private readonly records: AsyncIterator<string>) {}

  async record(): Promise<unknown> {
    const result = await this.records.next();
    if (result.done) {
      throw invalidArchive('备份状态记录不完整。');
    }

    this.structure += checkJsonStructure(result.value) + 1;
    assertLimit(this.structure, MAX_JSON_STRUCTURE);

    return JSON.parse(result.value);
  }

  async section(
    length: number,
    transform: (value: unknown, prior: unknown[]) => unknown,
  ): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      result.push(transform(await this.record(), result));
    }

    return result;
  }
}

export async function decodeDeltaArchiveState(chunks: AsyncIterable<Uint8Array>): Promise<unknown> {
  const records = archiveLines(chunks)[Symbol.asyncIterator]();
  const archive = new DeltaArchiveReader(records);
  try {
    const header = record(await archive.record());
    const lengths = sequence(header.lengths);
    if (header.version !== DELTA_CODEC_VERSION || lengths.length !== 3) {
      throw invalidArchive('备份状态版本无效。');
    }

    const texts = await archive.section(
      reference(lengths[0], MAX_JSON_STRUCTURE + 1),
      (value) => value,
    );
    const payloads = await archive.section(
      reference(lengths[1], MAX_JSON_STRUCTURE + 1),
      (value) => value,
    );
    const contents = await archive.section(reference(lengths[2], MAX_HISTORY + 2), restoreDelta);
    if (!(await records.next()).done) {
      throw invalidArchive('备份状态包含额外记录。');
    }

    return decodeEnvelope({ ...header, texts, payloads, contents });
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw invalidArchive('备份状态 JSON 无效。', { cause: error });
  } finally {
    await records.return?.();
  }
}
