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
const legacyCustomInks = /^[\da-f]{6}(?:,[\da-f]{6}){0,63}$/iu;
const MAX_JSON_DEPTH = 204;
const MAX_JSON_STRUCTURE = 2_000_000;
export const MAX_ARCHIVE_BOARD_BYTES = 16 * 1024 * 1024;

interface UnitContent {
  readonly fields: number;
  readonly units: readonly number[];
}

type ArchiveContent = number | UnitContent;

export interface ArchiveHistoryRecord {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly artifact: Readonly<Record<string, unknown>>;
  readonly objects: readonly unknown[];
}

export interface ArchiveRestoration {
  readonly artifact: Readonly<Record<string, unknown>>;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly history: readonly ArchiveHistoryRecord[];
}

export interface CurrentArchiveState {
  readonly title: string;
  readonly objects: readonly unknown[];
  readonly assets: Record<string, unknown>;
  readonly customColors?: readonly string[];
  readonly restoration?: ArchiveRestoration;
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

function readHistory(value: unknown, contentCount: number, payloadCount: number) {
  const history = archiveArray(value);
  if (history.length > MAX_HISTORY) {
    throw archiveTooLarge();
  }

  return history.map((version) => {
    const references = archiveArray(version);
    if (references.length !== 3) {
      throw invalidArchive('Invalid archive history references');
    }

    return {
      entry: archiveIndex(references[0], payloadCount),
      artifact: archiveIndex(references[1], payloadCount),
      content: archiveIndex(references[2], contentCount),
    };
  });
}

type ReadPayload = (reference: number, budget: ArchiveValueBudget) => unknown;

function readScene(value: ArchiveContent, readPayload: ReadPayload) {
  const budget: ArchiveValueBudget = { maximum: MAX_ARCHIVE_BOARD_BYTES, bytes: 0, nodes: 0 };
  if (typeof value === 'number') {
    const content = archiveRecord(readPayload(value, budget));
    const elements = archiveArray(content.elements);
    if (elements.length > MAX_UNITS) {
      throw archiveTooLarge();
    }

    return { objects: elements, style: content.style };
  }

  const fields = archiveRecord(readPayload(value.fields, budget));
  if (Object.hasOwn(fields, 'elements')) {
    throw invalidArchive('Duplicate archive object list');
  }

  return {
    objects: value.units.map((reference) => readPayload(reference, budget)),
    style: fields.style,
  };
}

function currentSceneFields({ objects, style }: ReturnType<typeof readScene>) {
  if (!style || typeof style !== 'object' || !('nativeInks' in style)) {
    return { objects };
  }

  const { nativeInks } = style;
  if (typeof nativeInks !== 'string' || !legacyCustomInks.test(nativeInks)) {
    return { objects };
  }

  const customColors = [...new Set(nativeInks.split(',').map((ink) => '#' + ink.toUpperCase()))];

  return { objects, customColors };
}

function cachedPayload(reader: ArchiveValueReader, total: ArchiveValueBudget): ReadPayload {
  const cache = new Map<number, { value: unknown; bytes: number; nodes: number }>();

  return (reference, budget) => {
    let entry = cache.get(reference);
    if (!entry) {
      const measured = { maximum: total.maximum - total.bytes, bytes: 0, nodes: 0 };
      const value = reader.payload(reference, measured);
      total.bytes += measured.bytes;
      total.nodes += measured.nodes;
      if (total.nodes > MAX_JSON_STRUCTURE) {
        throw archiveTooLarge();
      }

      entry = { value, bytes: measured.bytes, nodes: measured.nodes };
      cache.set(reference, entry);
    }

    budget.bytes += entry.bytes;
    budget.nodes += entry.nodes;
    if (budget.bytes > budget.maximum || budget.nodes > MAX_JSON_STRUCTURE) {
      throw archiveTooLarge();
    }

    return entry.value;
  };
}

function legacyStudioBackup(
  current: ArchiveContent,
  board: Record<string, unknown>,
  history: ReturnType<typeof readHistory>,
  reader: ArchiveValueReader,
  budget: ArchiveValueBudget,
): boolean {
  if (typeof current === 'number' || !Number.isSafeInteger(board.revision)) {
    return false;
  }

  const fields = archiveRecord(reader.payload(current.fields, budget));
  if (Object.keys(fields).length > 0) {
    return false;
  }

  return history.every(({ entry }) => {
    const record = archiveRecord(reader.payload(entry, budget));

    return (
      Number.isSafeInteger(record.revision) && record.id === 'revision-' + String(record.revision)
    );
  });
}

function projectState(
  header: Record<string, unknown>,
  contents: readonly ArchiveContent[],
  reader: ArchiveValueReader,
  artifactId: string,
  history: ReturnType<typeof readHistory>,
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

  const currentIndex = archiveIndex(header.current, contents.length);
  const current = contents[currentIndex];
  if (current === undefined) {
    throw invalidArchive('Archive contains no current board');
  }

  const assets = archiveRecord(reader.payload(properties.get('assets'), budget));
  const marker = properties.get('studioII');
  const details = marker === undefined ? undefined : archiveRecord(reader.payload(marker, budget));
  const restore = details || legacyStudioBackup(current, board, history, reader, budget);
  if (!restore) {
    return {
      title,
      ...currentSceneFields(
        readScene(current, (reference, allowance) => reader.payload(reference, allowance)),
      ),
      assets,
    };
  }

  const readPayload = cachedPayload(reader, budget);
  const scenes = new Map<number, ReturnType<typeof readScene>>();
  function scene(index: number) {
    const existing = scenes.get(index);
    if (existing) {
      return existing;
    }

    const result = readScene(contents[index]!, readPayload);
    scenes.set(index, result);

    return result;
  }

  const restoredHistory = history.map(({ entry, artifact, content }) => ({
    entry: archiveRecord(reader.payload(entry, budget)),
    artifact: archiveRecord(reader.payload(artifact, budget)),
    objects: scene(content).objects,
  }));

  return {
    title,
    ...currentSceneFields(scene(currentIndex)),
    assets,
    restoration: { artifact: board, details, history: restoredHistory },
  };
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
  const history = readHistory(header.history, contents.length, payloads.length);

  return projectState(
    header,
    contents,
    new ArchiveValueReader(texts, payloads),
    artifactId,
    history,
  );
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
