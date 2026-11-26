import { ArchiveReadError, archiveTooLarge, invalidArchive } from './archive-read-error.js';
import {
  archiveArray,
  archiveFields,
  archiveIndex,
  archiveRecord,
  ArchiveValueReader,
  type ArchiveValueBudget,
} from './archive-values.js';

export const MAX_ARCHIVE_STATE_BYTES = 64 * 1024 * 1024;

const DELTA_CODEC_VERSION = 2;
const MAX_HISTORY = 200;
const MAX_PROPERTIES = 64;
const MAX_UNITS = 4_000;
const MAX_JSON_DEPTH = 204;
const MAX_JSON_STRUCTURE = 2_000_000;
const MAX_BOARD_BYTES = 16 * 1024 * 1024;

interface UnitContent {
  readonly fields: number;
  readonly units: readonly number[];
}

type ArchiveContent = number | UnitContent;

export interface CurrentArchiveState {
  readonly title: string;
  readonly objects: readonly unknown[];
  readonly assets: Record<string, unknown>;
}

function textChunk(utf8: InstanceType<typeof TextDecoder>, chunk?: Uint8Array): string {
  try {
    return utf8.decode(chunk, { stream: chunk !== undefined });
  } catch (error) {
    throw invalidArchive('Invalid archive state text encoding', { cause: error });
  }
}

async function* stateLines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let fragments: string[] = [];
  for await (const chunk of chunks) {
    const lines = textChunk(utf8, chunk).split('\n');
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

  if (textChunk(utf8) || fragments.length) {
    throw invalidArchive('Archive ends within a state record');
  }
}

function jsonStructure(source: string): number {
  let depth = 0;
  let count = 0;
  let insideString = false;
  for (let index = 0; index < source.length; index++) {
    const token = source[index];
    if (insideString) {
      if (token === '\\') {
        index++;
      } else if (token === '"') {
        insideString = false;
      }

      continue;
    }

    if (token === '"') {
      insideString = true;
    } else if (token === '{' || token === '[') {
      depth++;
      count++;
    } else if (token === '}' || token === ']') {
      depth--;
    } else if (token === ',') {
      count++;
    }

    if (depth > MAX_JSON_DEPTH || count > MAX_JSON_STRUCTURE) {
      throw archiveTooLarge();
    }
  }

  return count + 1;
}

class StateRecordReader {
  private structure = 0;

  constructor(private readonly lines: AsyncIterator<string>) {}

  async read(): Promise<unknown> {
    const line = await this.lines.next();
    if (line.done) {
      throw invalidArchive('Archive state is missing a record');
    }

    this.structure += jsonStructure(line.value);
    if (this.structure > MAX_JSON_STRUCTURE) {
      throw archiveTooLarge();
    }

    try {
      return JSON.parse(line.value) as unknown;
    } catch (error) {
      throw invalidArchive('Invalid archive state JSON', { cause: error });
    }
  }

  async section(length: unknown, maximum: number): Promise<unknown[]> {
    const count = archiveIndex(length, maximum + 1);
    const values: unknown[] = [];
    for (let index = 0; index < count; index++) {
      values.push(await this.read());
    }

    return values;
  }
}

function restoreUnits(
  encoded: Record<string, unknown>,
  prior: readonly ArchiveContent[],
  payloadCount: number,
): readonly number[] {
  const base = prior[archiveIndex(encoded.base, prior.length)];
  if (!base || typeof base === 'number') {
    throw invalidArchive('Archive delta has an invalid base');
  }

  const length = archiveIndex(encoded.length, MAX_UNITS + 1);
  const changes = archiveArray(encoded.changes);
  if (changes.length > length) {
    throw invalidArchive('Archive delta contains too many changes');
  }

  const restored = Array.from({ length }, (_, ordinal) => base.units[ordinal]);
  let previousOrdinal = -1;
  for (const change of changes) {
    const pair = archiveArray(change);
    const ordinal = archiveIndex(pair[0], length);
    if (pair.length !== 2 || previousOrdinal >= ordinal) {
      throw invalidArchive('Archive delta changes are out of order');
    }

    restored[ordinal] = archiveIndex(pair[1], payloadCount);
    previousOrdinal = ordinal;
  }

  return restored.map((reference) => archiveIndex(reference, payloadCount));
}

function restoreContent(
  encoded: unknown,
  prior: readonly ArchiveContent[],
  payloadCount: number,
): ArchiveContent {
  if (typeof encoded === 'number') {
    return archiveIndex(encoded, payloadCount);
  }

  const entry = archiveRecord(encoded);
  const fields = archiveIndex(entry.fields, payloadCount);
  if (Object.hasOwn(entry, 'base')) {
    if (Object.keys(entry).length !== 4) {
      throw invalidArchive('Invalid archive delta record');
    }

    return { fields, units: restoreUnits(entry, prior, payloadCount) };
  }
  if (Object.keys(entry).length !== 2) {
    throw invalidArchive('Invalid archive content record');
  }

  const units = archiveArray(entry.units);
  if (units.length > MAX_UNITS) {
    throw archiveTooLarge();
  }

  return { fields, units: units.map((id) => archiveIndex(id, payloadCount)) };
}

function checkHistory(value: unknown, contentCount: number, payloadCount: number): void {
  const history = archiveArray(value);
  if (history.length > MAX_HISTORY) {
    throw archiveTooLarge();
  }

  for (const version of history) {
    const references = archiveArray(version);
    if (references.length !== 3) {
      throw invalidArchive('Invalid archive history references');
    }

    archiveIndex(references[0], payloadCount);
    archiveIndex(references[1], payloadCount);
    archiveIndex(references[2], contentCount);
  }
}

function latestObjects(value: ArchiveContent, reader: ArchiveValueReader): readonly unknown[] {
  const budget: ArchiveValueBudget = { maximum: MAX_BOARD_BYTES, bytes: 0, nodes: 0 };
  if (typeof value === 'number') {
    const content = archiveRecord(reader.payload(value, budget));
    const elements = archiveArray(content.elements);
    if (elements.length > MAX_UNITS) {
      throw archiveTooLarge();
    }

    return elements;
  }

  const fields = archiveRecord(reader.payload(value.fields, budget));
  if (Object.hasOwn(fields, 'elements')) {
    throw invalidArchive('Duplicate archive object list');
  }

  return value.units.map((reference) => reader.payload(reference, budget));
}

function projectState(
  header: Record<string, unknown>,
  contents: readonly ArchiveContent[],
  reader: ArchiveValueReader,
  artifactId: string,
): CurrentArchiveState {
  const properties = archiveFields(header.properties);
  if (properties.size > MAX_PROPERTIES) {
    throw archiveTooLarge();
  }

  const budget: ArchiveValueBudget = { maximum: MAX_ARCHIVE_STATE_BYTES, bytes: 0, nodes: 0 };
  const board = archiveRecord(reader.payload(properties.get('artifact'), budget));
  const { title } = board;
  if (board.id !== artifactId) {
    throw invalidArchive('Archive manifest does not match the board identifier');
  }
  if (board.type !== 'whiteboard') {
    throw new ArchiveReadError('incompatibleContent', 'Archive does not contain a whiteboard');
  }
  if (typeof title !== 'string' || !title.trim()) {
    throw invalidArchive('Archive board title is missing');
  }

  const current = contents[archiveIndex(header.current, contents.length)];
  if (current === undefined) {
    throw invalidArchive('Archive contains no current board');
  }

  const assets = archiveRecord(reader.payload(properties.get('assets'), budget));

  return { title, objects: latestObjects(current, reader), assets };
}

async function readSections(
  records: StateRecordReader,
  lines: AsyncIterator<string>,
  artifactId: string,
): Promise<CurrentArchiveState> {
  const header = archiveRecord(await records.read());
  const lengths = archiveArray(header.lengths);
  if (header.version !== DELTA_CODEC_VERSION || lengths.length !== 3) {
    throw invalidArchive('Invalid archive state header');
  }

  const texts = await records.section(lengths[0], MAX_JSON_STRUCTURE);
  const payloads = await records.section(lengths[1], MAX_JSON_STRUCTURE);
  const encodedContents = await records.section(lengths[2], MAX_HISTORY + 1);
  if (!(await lines.next()).done) {
    throw invalidArchive('Archive contains extra state records');
  }

  const contents: ArchiveContent[] = [];
  for (const value of encodedContents) {
    contents.push(restoreContent(value, contents, payloads.length));
  }
  checkHistory(header.history, contents.length, payloads.length);

  return projectState(header, contents, new ArchiveValueReader(texts, payloads), artifactId);
}

export async function readCurrentArchiveState(
  chunks: AsyncIterable<Uint8Array>,
  artifactId: string,
): Promise<CurrentArchiveState> {
  const lines = stateLines(chunks);
  try {
    return await readSections(new StateRecordReader(lines), lines, artifactId);
  } finally {
    await lines.return(undefined);
  }
}
