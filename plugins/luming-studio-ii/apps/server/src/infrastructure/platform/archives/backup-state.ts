import { Buffer } from 'node:buffer';
import { MAX_ARCHIVE_BOARD_BYTES, MAX_ARCHIVE_STATE_BYTES } from './archive-state.js';

type Fields = Readonly<Record<string, unknown>>;
type Elements = readonly Fields[];

interface HistoryVersion {
  readonly entry: Fields;
  readonly artifact: Fields;
  readonly elements: Elements;
}

export interface BackupState {
  readonly properties: Fields;
  readonly contentFields?: Fields;
  readonly elements: Elements;
  readonly history: readonly HistoryVersion[];
}

class BackupLimit extends Error {}

const textInternLength = 1024;
const maxDepth = 64;
const maxRecords = 100_000;

class ArchiveRecords {
  private readonly texts: string[] = [];
  private readonly payloads: string[] = [];
  private readonly contents: string[] = [];
  private readonly textIds = new Map<string, number>();
  private readonly payloadIds = new WeakMap<object, number>();
  private readonly elementBytes = new WeakMap<Fields, number>();
  private readonly contentIds = new WeakMap<Elements, number>();
  private readonly emptyFields: Fields = {};
  private bytes = 0;
  private previous?: { readonly index: number; readonly elements: readonly number[] };

  private reserve(value: unknown) {
    const record = JSON.stringify(value);
    this.bytes += Buffer.byteLength(record) + 1;
    if (this.bytes > MAX_ARCHIVE_STATE_BYTES) {
      throw new BackupLimit();
    }

    return record;
  }

  private text(value: string) {
    const indexed = this.textIds.get(value);
    if (indexed !== undefined) {
      return indexed;
    }

    const index = this.texts.length;
    this.texts.push(this.reserve(value));
    this.textIds.set(value, index);

    return index;
  }

  private fields(value: object, depth: number): [string, unknown][] {
    return Object.entries(value).flatMap(([key, field]) =>
      field === undefined ? [] : [[key, this.encode(field, depth + 1)]],
    );
  }

  private encode(value: unknown, depth: number): unknown {
    if (depth > maxDepth) {
      throw new BackupLimit();
    }
    if (typeof value === 'string' && value.length > textInternLength) {
      return { text: this.text(value) };
    }
    if (Array.isArray(value)) {
      return { array: value.map((item) => this.encode(item, depth + 1)) };
    }
    if (value && typeof value === 'object') {
      return { object: this.fields(value, depth) };
    }

    return value ?? null;
  }

  private payload(value: unknown) {
    const object = value && typeof value === 'object' ? value : undefined;
    const previous = object && this.payloadIds.get(object);
    if (previous !== undefined) {
      return previous;
    }
    if (this.payloads.length >= maxRecords) {
      throw new BackupLimit();
    }

    const id = this.payloads.length;
    this.payloads.push(this.reserve(this.encode(value, 0)));
    if (object) {
      this.payloadIds.set(object, id);
    }

    return id;
  }

  private delta(units: readonly number[], fields: number) {
    const previous = this.previous;
    if (previous) {
      const changes = units.flatMap((value, index) =>
        value !== previous.elements[index] ? [[index, value]] : [],
      );

      if (changes.length * 4 + 8 < units.length) {
        return { base: previous.index, fields, length: units.length, changes };
      }
    }

    return { fields, units };
  }

  private content(elements: Elements, contentFields: Fields) {
    const retained = this.contentIds.get(elements);
    if (retained !== undefined) {
      return retained;
    }

    const index = this.contents.length;
    let length = 2 + elements.length;
    const units = elements.map((element) => {
      const bytes = this.elementBytes.get(element) ?? Buffer.byteLength(JSON.stringify(element));
      this.elementBytes.set(element, bytes);
      length += bytes;
      if (length > MAX_ARCHIVE_BOARD_BYTES) {
        throw new BackupLimit();
      }

      return this.payload(element);
    });
    this.contents.push(this.reserve(this.delta(units, this.payload(contentFields))));
    this.previous = { index, elements: units };
    this.contentIds.set(elements, index);

    return index;
  }

  serialize(state: BackupState) {
    const fields = state.contentFields ?? this.emptyFields;
    const history = state.history.map(({ entry, artifact, elements }) => [
      this.payload(entry),
      this.payload(artifact),
      this.content(elements, fields),
    ]);
    const current = this.content(state.elements, fields);
    const properties = Object.entries(state.properties).map(([field, value]) => [
      field,
      this.payload(value),
    ]);
    const header = this.reserve({
      version: 2,
      history,
      current,
      properties,
      lengths: [this.texts.length, this.payloads.length, this.contents.length],
    });

    return Buffer.from([header, ...this.texts, ...this.payloads, ...this.contents, ''].join('\n'));
  }
}

export function packBackupState(state: BackupState): Buffer | undefined {
  try {
    return new ArchiveRecords().serialize(state);
  } catch (error) {
    if (error instanceof BackupLimit) {
      return undefined;
    }

    throw error;
  }
}
