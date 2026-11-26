import { Buffer } from 'node:buffer';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw } from 'node:zlib';

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 5_000;

const CENTRAL_END_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_ENTRY_NAME_LENGTH = 128;
const MAX_ZIP_COMMENT = 65_535;
const DESCRIPTOR_FLAG = 8;
const ENCRYPTED_FLAG = 1;
const STORE = 0;
const DEFLATE = 8;
const CENTRAL_END = 0x06054b50;
const CENTRAL_FILE = 0x02014b50;
const LOCAL_FILE = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const utf8 = new TextDecoder('utf-8', { fatal: true });

interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
  encoding: number;
  checksum: number;
  flags: number;
  offset: number;
  limit: number;
}

interface LocalEntry extends ZipEntry {
  dataOffset: number;
}

interface DirectoryLocation {
  count: number;
  offset: number;
  end: number;
}

export interface ExtractedZipEntry {
  readonly path: string;
  readonly size: number;
}

export type ZipEntryLimit = (name: string) => number | undefined;

interface ZipManifestReader<T> {
  readonly name: string;
  readonly read: (entry: ExtractedZipEntry) => Promise<T>;
}

const pathSegment = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;
const deviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export class ZipExtractionError extends Error {
  constructor(
    readonly code: 'invalidArchive' | 'tooLarge',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ZipExtractionError';
  }
}

function invalidZip(message = 'Invalid ZIP archive', options?: ErrorOptions): ZipExtractionError {
  return new ZipExtractionError('invalidArchive', message, options);
}

function tooLargeZip(): ZipExtractionError {
  return new ZipExtractionError('tooLarge', 'ZIP exceeds its extraction limits');
}

function invalidPathSegment(segment: string): boolean {
  return !pathSegment.test(segment) || deviceName.test(segment);
}

function requireEntryLimit(name: string, limitForName: ZipEntryLimit): number {
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  if (path.split('/').some(invalidPathSegment)) {
    throw invalidZip('Invalid ZIP entry name');
  }

  const limit = limitForName(name);
  if (limit === undefined) {
    throw invalidZip('ZIP entry is not allowed');
  }
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('Expected a nonnegative ZIP entry limit');
  }

  return limit;
}

async function readBytes(file: FileHandle, size: number, offset: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const block = await file.read(buffer, read, size - read, offset + read);
    if (!block.bytesRead) {
      throw invalidZip();
    }

    read += block.bytesRead;
  }

  return buffer;
}

async function locateDirectory(file: FileHandle): Promise<DirectoryLocation> {
  const size = (await file.stat()).size;
  if (size > MAX_ARCHIVE_BYTES) {
    throw tooLargeZip();
  }

  const length = Math.min(size, CENTRAL_END_LENGTH + MAX_ZIP_COMMENT);
  const tail = await readBytes(file, length, size - length);
  for (let index = length - CENTRAL_END_LENGTH; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== CENTRAL_END) {
      continue;
    }

    const recordLength = CENTRAL_END_LENGTH + tail.readUInt16LE(index + 20);
    if (index + recordLength !== length) {
      continue;
    }

    const count = tail.readUInt16LE(index + 10);
    const onDisk = tail.readUInt16LE(index + 8);
    const diskNumbers = tail.readUInt32LE(index + 4);
    if (count !== onDisk || diskNumbers !== 0) {
      throw invalidZip('Invalid ZIP directory');
    }

    const offset = tail.readUInt32LE(index + 16);
    const end = size - length + index;
    if (offset + tail.readUInt32LE(index + 12) !== end) {
      throw invalidZip('Invalid ZIP directory');
    }
    if (count > MAX_ARCHIVE_ENTRIES) {
      throw tooLargeZip();
    }

    return { count, offset, end };
  }

  throw invalidZip('Invalid ZIP directory');
}

function entryName(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch (error) {
    throw invalidZip('Invalid ZIP entry name encoding', { cause: error });
  }
}

async function centralEntry(
  file: FileHandle,
  cursor: number,
  end: number,
  limitForName: ZipEntryLimit,
): Promise<{ entry: ZipEntry; next: number }> {
  if (cursor + CENTRAL_HEADER_LENGTH > end) {
    throw invalidZip();
  }

  const raw = await readBytes(file, CENTRAL_HEADER_LENGTH, cursor);
  const nameLength = raw.readUInt16LE(28);
  const nameOffset = cursor + CENTRAL_HEADER_LENGTH;
  const next = nameOffset + nameLength + raw.readUInt16LE(30) + raw.readUInt16LE(32);
  if (raw.readUInt32LE(0) !== CENTRAL_FILE || next > end || raw.readUInt16LE(34) !== 0) {
    throw invalidZip();
  }
  if (!nameLength || nameLength > MAX_ENTRY_NAME_LENGTH) {
    throw invalidZip('Invalid ZIP entry name');
  }

  const name = entryName(await readBytes(file, nameLength, nameOffset));
  const limit = requireEntryLimit(name, limitForName);
  const size = raw.readUInt32LE(24);
  const compressed = raw.readUInt32LE(20);
  const encoding = raw.readUInt16LE(10);
  if (size > limit || compressed > MAX_ARCHIVE_BYTES || ![STORE, DEFLATE].includes(encoding)) {
    throw tooLargeZip();
  }

  const flags = raw.readUInt16LE(8);
  if (flags & ENCRYPTED_FLAG) {
    throw invalidZip('Encrypted ZIP entries are unsupported');
  }

  return {
    entry: {
      name,
      size,
      compressed,
      encoding,
      flags,
      limit,
      checksum: raw.readUInt32LE(16),
      offset: raw.readUInt32LE(42),
    },
    next,
  };
}

function fileSizesMatch(raw: Buffer, offset: number, entry: ZipEntry): boolean {
  return (
    raw.readUInt32LE(offset) === entry.checksum &&
    raw.readUInt32LE(offset + 4) === entry.compressed &&
    raw.readUInt32LE(offset + 8) === entry.size
  );
}

async function localEntry(file: FileHandle, entry: ZipEntry, next: number): Promise<LocalEntry> {
  const { offset } = entry;
  if (offset + LOCAL_HEADER_LENGTH > next) {
    throw invalidZip();
  }

  const raw = await readBytes(file, LOCAL_HEADER_LENGTH, offset);
  if (raw.readUInt32LE(0) !== LOCAL_FILE || raw.readUInt16LE(6) !== entry.flags) {
    throw invalidZip();
  }
  if (raw.readUInt16LE(8) !== entry.encoding || raw.readUInt16LE(26) !== entry.name.length) {
    throw invalidZip();
  }

  const name = await readBytes(file, entry.name.length, offset + LOCAL_HEADER_LENGTH);
  if (entryName(name) !== entry.name) {
    throw invalidZip();
  }

  const dataOffset = offset + LOCAL_HEADER_LENGTH + name.length + raw.readUInt16LE(28);
  const dataEnd = dataOffset + entry.compressed;
  const trailer = next - dataEnd;
  if (entry.flags & DESCRIPTOR_FLAG) {
    if (trailer !== 12 && trailer !== 16) {
      throw invalidZip();
    }

    const descriptor = await readBytes(file, trailer, dataEnd);
    const sizesOffset = trailer - 12;
    const badSignature = sizesOffset && descriptor.readUInt32LE(0) !== DATA_DESCRIPTOR;
    if (badSignature || !fileSizesMatch(descriptor, sizesOffset, entry)) {
      throw invalidZip();
    }
  } else if (trailer || !fileSizesMatch(raw, 14, entry)) {
    throw invalidZip();
  }

  return { ...entry, dataOffset };
}

async function readEntries(archive: string, limitForName: ZipEntryLimit): Promise<LocalEntry[]> {
  const file = await open(archive, 'r');
  try {
    const directory = await locateDirectory(file);
    const names = new Set<string>();
    const entries: ZipEntry[] = [];
    let cursor = directory.offset;
    let expanded = 0;
    for (let index = 0; index < directory.count; index++) {
      const { entry, next } = await centralEntry(file, cursor, directory.end, limitForName);
      const key = entry.name.toLowerCase();
      if (names.has(key)) {
        throw invalidZip('Duplicate ZIP entry');
      }

      names.add(key);
      expanded += entry.size;
      if (expanded > MAX_EXPANDED_BYTES) {
        throw tooLargeZip();
      }

      cursor = next;
      entries.push(entry);
    }

    entries.sort((a, b) => a.offset - b.offset);
    if (cursor !== directory.end || entries[0]?.offset !== 0) {
      throw invalidZip();
    }

    const local: LocalEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      local.push(await localEntry(file, entry, entries[index + 1]?.offset ?? directory.offset));
    }

    return local;
  } finally {
    await file.close();
  }
}

async function inflateEntry(
  source: Readable,
  bounds: Transform,
  output: ReturnType<typeof createWriteStream>,
  compressed: number,
): Promise<void> {
  const inflate = createInflateRaw();
  try {
    await pipeline(source, inflate, bounds, output);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (typeof code === 'string' && code.startsWith('Z_')) {
      throw invalidZip('ZIP entry could not be decompressed', { cause: error });
    }

    throw error;
  }
  if (inflate.bytesWritten !== compressed) {
    throw invalidZip('ZIP entry contains trailing compressed data');
  }
}

async function extractEntry(archive: string, entry: LocalEntry, file: string): Promise<void> {
  let size = 0;
  let checksum = 0;
  const bounds = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > entry.size || size > entry.limit) {
        done(tooLargeZip());
        return;
      }

      checksum = crc32(chunk, checksum);
      done(null, chunk);
    },
  });
  const source = entry.compressed
    ? createReadStream(archive, {
        start: entry.dataOffset,
        end: entry.dataOffset + entry.compressed - 1,
      })
    : Readable.from([]);
  const output = createWriteStream(file, { flags: 'wx' });
  if (entry.encoding === DEFLATE) {
    await inflateEntry(source, bounds, output, entry.compressed);
  } else {
    await pipeline(source, bounds, output);
  }
  if (size !== entry.size || checksum !== entry.checksum) {
    throw invalidZip('ZIP entry failed integrity verification');
  }
}

async function extractEntries(
  archive: string,
  directory: string,
  entries: readonly LocalEntry[],
): Promise<ReadonlyMap<string, ExtractedZipEntry>> {
  const files = new Map<string, ExtractedZipEntry>();
  for (const [index, entry] of entries.entries()) {
    const path = join(directory, 'entry-' + index);
    await extractEntry(archive, entry, path);
    files.set(entry.name, { path, size: entry.size });
  }

  return files;
}

export async function extractZip(
  archive: string,
  directory: string,
  limitForName: ZipEntryLimit,
): Promise<ReadonlyMap<string, ExtractedZipEntry>> {
  try {
    const entries = await readEntries(archive, limitForName);
    return await extractEntries(archive, directory, entries);
  } catch (error) {
    if (error instanceof ZipExtractionError) {
      throw error;
    }

    throw invalidZip(undefined, { cause: error });
  }
}

export async function extractZipAfterManifest<T>(
  archive: string,
  directory: string,
  limitForName: ZipEntryLimit,
  manifest: ZipManifestReader<T>,
): Promise<{ metadata: T; files: ReadonlyMap<string, ExtractedZipEntry> }> {
  const entries = await readEntries(archive, (name) =>
    name === manifest.name ? limitForName(name) : MAX_EXPANDED_BYTES,
  );
  const manifestEntry = entries.find((entry) => entry.name === manifest.name);
  if (!manifestEntry) {
    throw invalidZip('ZIP archive is missing its manifest');
  }

  const manifestPath = join(directory, 'manifest-entry');
  await extractEntry(archive, manifestEntry, manifestPath);
  const metadata = await manifest.read({ path: manifestPath, size: manifestEntry.size });
  const payloadEntries = entries.filter((entry) => entry !== manifestEntry);
  for (const entry of payloadEntries) {
    entry.limit = requireEntryLimit(entry.name, limitForName);
    if (entry.size > entry.limit) {
      throw tooLargeZip();
    }
  }

  return { metadata, files: await extractEntries(archive, directory, payloadEntries) };
}
