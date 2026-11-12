import type { PdfChunk } from '../contracts/types';

export const PDF_CHUNK_BYTES = 1024 * 1024;
export const MAX_READER_BYTES = 256 * 1024 * 1024;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

export function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

export async function readPdfChunks(
  load: (offset: number, revision?: string) => Promise<PdfChunk>,
  options: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<Uint8Array> {
  let buffer: Uint8Array | undefined;
  let revision: string | undefined;
  let offset = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    const chunk = await load(offset, revision);
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes <= 0 || chunk.totalBytes > MAX_READER_BYTES) {
      throw new Error('此 PDF 为空或超过当前阅读器的 256 MiB 内存限制。');
    }
    if (!buffer) {
      buffer = new Uint8Array(chunk.totalBytes);
      revision = chunk.revision;
    }
    if (!revision || revision !== chunk.revision || buffer.length !== chunk.totalBytes) {
      throw new Error('PDF 在读取期间发生变化，请重新打开。');
    }
    const decoded = atob(chunk.base64);
    if (chunk.offset !== offset || chunk.nextOffset !== offset + decoded.length || decoded.length > PDF_CHUNK_BYTES
      || chunk.nextOffset > buffer.length || (!chunk.eof && decoded.length === 0)) {
      throw new Error('PDF 分块响应不完整，请重新打开。');
    }
    for (let i = 0; i < decoded.length; i += 1) buffer[offset + i] = decoded.charCodeAt(i);
    offset = chunk.nextOffset;
    options.onProgress?.(offset, buffer.length);
    if (chunk.eof) {
      if (offset !== buffer.length) throw new Error('PDF 文件尚未读取完整。');
      return buffer;
    }
  }
}

export function noteReference(path: string): { path: string } | { paperPath: string } {
  return path.startsWith('papers/') && path.endsWith('/NOTES.md')
    ? { paperPath: path.slice(0, -'/NOTES.md'.length) }
    : { path };
}

export function safeNotePath(value: string): string | null {
  const path = value.trim().replaceAll('\\', '/');
  if (!path.startsWith('notes/') || !path.toLowerCase().endsWith('.md')
    || path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\0')) return null;
  return path;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
