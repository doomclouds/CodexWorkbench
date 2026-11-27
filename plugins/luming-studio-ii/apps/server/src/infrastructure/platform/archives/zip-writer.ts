import { Buffer } from 'node:buffer';
import { crc32, deflateRaw } from 'node:zlib';

interface ZipEntry {
  readonly name: string;
  readonly body: Buffer;
  readonly compressed?: boolean;
}

const localSignature = 0x04034b50;
const centralSignature = 0x02014b50;
const endSignature = 0x06054b50;
const localHeaderBytes = 30;
const centralHeaderBytes = 46;
const endHeaderBytes = 22;

function compress(source: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    deflateRaw(source, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function headers(entry: ZipEntry, bytes: Buffer, offset: number) {
  const name = Buffer.from(entry.name);
  const method = entry.compressed ? 8 : 0;
  const crc = crc32(entry.body);
  const local = Buffer.alloc(localHeaderBytes + name.length);
  local.writeUInt32LE(localSignature, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(entry.body.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, localHeaderBytes);

  const central = Buffer.alloc(centralHeaderBytes + name.length);
  central.writeUInt32LE(centralSignature, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(entry.body.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  name.copy(central, centralHeaderBytes);

  return { local, central };
}

function end(count: number, directoryLength: number, start: number) {
  const footer = Buffer.alloc(endHeaderBytes);
  footer.writeUInt32LE(endSignature, 0);
  footer.writeUInt16LE(count, 8);
  footer.writeUInt16LE(count, 10);
  footer.writeUInt32LE(directoryLength, 12);
  footer.writeUInt32LE(start, 16);

  return footer;
}

export async function writeZip(
  entries: readonly ZipEntry[],
  limit: number,
): Promise<Uint8Array | undefined> {
  const bodies: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  let directoryLength = 0;

  for (const entry of entries) {
    const bytes = entry.compressed ? await compress(entry.body) : entry.body;
    const { local, central } = headers(entry, bytes, offset);
    offset += local.length + bytes.length;
    directoryLength += central.length;
    if (offset + directoryLength + endHeaderBytes > limit) {
      return undefined;
    }

    bodies.push(local, bytes);
    directory.push(central);
  }

  return Buffer.concat([...bodies, ...directory, end(entries.length, directoryLength, offset)]);
}
