import type {
  BoardExportAsset,
  BoardExportRejection,
  JsonValue,
  PayloadRecord,
} from '../domain/index.js';
import type { WhiteboardReader } from '../ports/index.js';

const maxAssetBytes = 20 * 1024 * 1024;
const assetPrefix = '/studio-archive-assets/';
const assetSource = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
const embeddedSource =
  /(?:\b(?:src|href|poster)\s*=\s*["']|\burl\(\s*["']?)(\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})(?=["'\s)])/gu;

function addAssetSource(sources: Set<string>, source: JsonValue | undefined) {
  if (typeof source === 'string' && source.startsWith(assetPrefix)) {
    sources.add(source);
  }
}

function readObject(value: JsonValue | undefined) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function documentAssets(sources: Set<string>, blocks: JsonValue | undefined) {
  const pending = Array.isArray(blocks) ? [...blocks] : [];

  for (const entry of pending) {
    const block = readObject(entry);
    if (block?.type === 'image') {
      addAssetSource(sources, readObject(block.props)?.url);
    }
    if (Array.isArray(block?.children)) {
      for (const child of block.children) {
        pending.push(child);
      }
    }
  }
}

function embedAssets(sources: Set<string>, markup: JsonValue | undefined) {
  if (typeof markup !== 'string') {
    return;
  }

  for (const match of markup.matchAll(embeddedSource)) {
    const source = match[1];
    if (source) {
      sources.add(source);
    }
  }
}

function collectSources(payloads: readonly PayloadRecord[], format: 'json' | 'svg') {
  const sources = new Set<string>();

  for (const { bodyKind, data } of payloads) {
    switch (bodyKind) {
      case 'image':
        addAssetSource(sources, data.src);
        break;
      case 'video':
        addAssetSource(sources, data.poster);
        if (format === 'json') {
          addAssetSource(sources, data.src);
        }
        break;
      case 'document':
        if (format === 'json') {
          documentAssets(sources, data.blocks);
        }
        break;
      case 'embed':
        if (format === 'json') {
          embedAssets(sources, data.html);
        }
    }
  }

  return sources;
}

type ExportAssets = ReadonlyMap<string, BoardExportAsset>;

export function captureExportAssets(
  reader: WhiteboardReader,
  boardId: string,
  payloads: readonly PayloadRecord[],
  format: 'json' | 'svg',
): ExportAssets | BoardExportRejection {
  const assets = new Map<string, BoardExportAsset>();
  let remaining = maxAssetBytes;

  for (const source of collectSources(payloads, format)) {
    const match = assetSource.exec(source);
    const assetId = match?.[2];
    if (match?.[1] !== boardId || !assetId) {
      return { kind: 'rejected', reason: 'assetUnavailable' };
    }

    const result = reader.getExportAsset?.(boardId, assetId, remaining);
    if (!result) {
      return { kind: 'rejected', reason: 'assetUnavailable' };
    }
    if (result.kind === 'tooLarge' || result.asset.byteLength > remaining) {
      return { kind: 'rejected', reason: 'tooLarge' };
    }

    remaining -= result.asset.byteLength;
    assets.set(source, result.asset);
  }

  return assets;
}
