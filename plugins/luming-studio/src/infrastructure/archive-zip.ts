import { createReadStream, createWriteStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw } from 'node:zlib';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { MAX_ARCHIVE_BYTES } from '../contracts/archive.js';
import type { ArchiveAsset } from '../core/ports/archive-storage.js';
import { invalidArchive, StudioError } from '../shared/studio-error.js';

export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 5000;

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

interface ZipFile {
  path: string;
  size: number;
}

export interface ZipEntrySource extends Pick<ArchiveAsset, 'chunks'> {
  name: string;
  compress: boolean;
}

export function archiveTooLarge(): StudioError {
  return new StudioError(
    'TOO_LARGE',
    '备份超过容量限制：ZIP 128 MB，展开后 256 MB，单个资源 20 MB。',
  );
}

async function readBytes(file: FileHandle, size: number, offset: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const block = await file.read(buffer, read, size - read, offset + read);
    if (!block.bytesRead) {
      throw invalidArchive();
    }

    read += block.bytesRead;
  }

  return buffer;
}

async function locateDirectory(file: FileHandle): Promise<DirectoryLocation> {
  const size = (await file.stat()).size;
  if (size > MAX_ARCHIVE_BYTES) {
    throw archiveTooLarge();
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
      throw invalidArchive('备份 ZIP 文件目录无效。');
    }

    const offset = tail.readUInt32LE(index + 16);
    const end = size - length + index;
    if (offset + tail.readUInt32LE(index + 12) !== end) {
      throw invalidArchive('备份 ZIP 文件目录无效。');
    }
    if (count > MAX_ARCHIVE_ENTRIES) {
      throw archiveTooLarge();
    }

    return { count, offset, end };
  }

  throw invalidArchive('备份 ZIP 文件目录无效。');
}

async function centralEntry(
  file: FileHandle,
  cursor: number,
  end: number,
  limitForName: (name: string) => number,
): Promise<{ entry: ZipEntry; next: number }> {
  if (cursor + CENTRAL_HEADER_LENGTH > end) {
    throw invalidArchive();
  }

  const raw = await readBytes(file, CENTRAL_HEADER_LENGTH, cursor);
  const nameLength = raw.readUInt16LE(28);
  const nameOffset = cursor + CENTRAL_HEADER_LENGTH;
  const next = nameOffset + nameLength + raw.readUInt16LE(30) + raw.readUInt16LE(32);
  if (raw.readUInt32LE(0) !== CENTRAL_FILE || next > end || raw.readUInt16LE(34) !== 0) {
    throw invalidArchive();
  }
  if (!nameLength || nameLength > MAX_ENTRY_NAME_LENGTH) {
    throw invalidArchive('备份包含不允许的文件路径。');
  }

  const name = utf8.decode(await readBytes(file, nameLength, nameOffset));
  const limit = limitForName(name);
  const size = raw.readUInt32LE(24);
  const compressed = raw.readUInt32LE(20);
  const encoding = raw.readUInt16LE(10);
  if (size > limit || compressed > MAX_ARCHIVE_BYTES || ![STORE, DEFLATE].includes(encoding)) {
    throw archiveTooLarge();
  }

  const flags = raw.readUInt16LE(8);
  if (flags & ENCRYPTED_FLAG) {
    throw invalidArchive('无法读取加密的备份条目。');
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
    throw invalidArchive();
  }

  const raw = await readBytes(file, LOCAL_HEADER_LENGTH, offset);
  if (raw.readUInt32LE(0) !== LOCAL_FILE || raw.readUInt16LE(6) !== entry.flags) {
    throw invalidArchive();
  }
  if (raw.readUInt16LE(8) !== entry.encoding || raw.readUInt16LE(26) !== entry.name.length) {
    throw invalidArchive();
  }

  const name = await readBytes(file, entry.name.length, offset + LOCAL_HEADER_LENGTH);
  if (utf8.decode(name) !== entry.name) {
    throw invalidArchive();
  }

  const dataOffset = offset + LOCAL_HEADER_LENGTH + name.length + raw.readUInt16LE(28);
  const dataEnd = dataOffset + entry.compressed;
  const trailer = next - dataEnd;
  if (entry.flags & DESCRIPTOR_FLAG) {
    if (trailer !== 12 && trailer !== 16) {
      throw invalidArchive();
    }

    const descriptor = await readBytes(file, trailer, dataEnd);
    const sizesOffset = trailer - 12;
    const badSignature = sizesOffset && descriptor.readUInt32LE(0) !== DATA_DESCRIPTOR;
    if (badSignature || !fileSizesMatch(descriptor, sizesOffset, entry)) {
      throw invalidArchive();
    }
  } else if (trailer || !fileSizesMatch(raw, 14, entry)) {
    throw invalidArchive();
  }

  return { ...entry, dataOffset };
}

async function readEntries(
  archive: string,
  limitForName: (name: string) => number,
): Promise<LocalEntry[]> {
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
        throw invalidArchive('备份包含重复文件。');
      }

      names.add(key);
      expanded += entry.size;
      if (expanded > MAX_EXPANDED_BYTES) {
        throw archiveTooLarge();
      }

      cursor = next;
      entries.push(entry);
    }

    entries.sort((a, b) => a.offset - b.offset);
    if (cursor !== directory.end || entries[0]?.offset !== 0) {
      throw invalidArchive();
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

async function extractEntry(archive: string, entry: LocalEntry, file: string): Promise<void> {
  let size = 0;
  let checksum = 0;
  const bounds = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > entry.size || size > entry.limit) {
        done(archiveTooLarge());
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
    const inflate = createInflateRaw();
    await pipeline(source, inflate, bounds, output);
    if (inflate.bytesWritten !== entry.compressed) {
      throw invalidArchive('备份压缩条目包含多余数据。');
    }
  } else {
    await pipeline(source, bounds, output);
  }
  if (size !== entry.size || checksum !== entry.checksum) {
    throw invalidArchive('备份条目未通过完整性校验。');
  }
}

export async function extractZip(
  archive: string,
  directory: string,
  limitForName: (name: string) => number,
): Promise<Map<string, ZipFile>> {
  try {
    const entries = await readEntries(archive, limitForName);
    const files = new Map<string, ZipFile>();
    for (const [index, entry] of entries.entries()) {
      const path = join(directory, 'entry-' + index);
      await extractEntry(archive, entry, path);
      files.set(entry.name, { path, size: entry.size });
    }

    return files;
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw invalidArchive(undefined, { cause: error });
  }
}

export async function writeZip(path: string, entries: Iterable<ZipEntrySource>): Promise<number> {
  const file = await open(path, 'wx');
  const pending: Uint8Array[] = [];
  let size = 0;
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) {
      failure = error;
      return;
    }

    pending.push(data);
  });
  async function flush(): Promise<void> {
    if (failure) {
      throw failure;
    }

    for (const data of pending.splice(0)) {
      size += data.length;
      if (size > MAX_ARCHIVE_BYTES) {
        throw archiveTooLarge();
      }

      await file.writeFile(data);
    }
  }

  try {
    for (const entry of entries) {
      const stream = entry.compress
        ? new ZipDeflate(entry.name, { level: 6 })
        : new ZipPassThrough(entry.name);
      zip.add(stream);
      await flush();
      for await (const chunk of entry.chunks()) {
        stream.push(chunk);
        await flush();
      }

      stream.push(new Uint8Array(), true);
      await flush();
    }

    zip.end();
    await flush();

    return size;
  } finally {
    zip.terminate();
    await file.close();
  }
}
