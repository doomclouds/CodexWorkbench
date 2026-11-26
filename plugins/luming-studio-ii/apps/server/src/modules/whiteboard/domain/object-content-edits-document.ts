import type { JsonObject, JsonValue } from './model.js';
import {
  contentFits,
  contentIdentifier,
  contentRecord,
  contentTitleLimit,
  type ContentEditRejection,
  type ContentPayloadPlan,
} from './object-content-edits.js';

interface DocumentAssets {
  readonly boardId: string;
  readonly hasAsset: (assetId: string) => boolean;
}

interface BlockEntry {
  readonly block: JsonValue;
  readonly depth: number;
}

const documentSchema = 1;
const maximumDepth = 64;
const maximumBlocks = 5_000;
const untitledDocument = '未命名文档';
const assetPath = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
const localHost =
  /^(?:localhost$|.*\.localhost$|127\.|0\.0\.0\.0$|\[::(?:1|ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4})?\]$)/iu;
const blockTypes = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock',
  'table',
  'image',
  'divider',
]);

function knownImages(current: JsonObject): Set<string> {
  const sources = new Set<string>();
  const pending: JsonValue[] = Array.isArray(current.blocks) ? [...current.blocks] : [];
  while (pending.length) {
    const block = contentRecord(pending.pop());
    const source = contentRecord(block?.props)?.url;
    if (block?.type === 'image' && typeof source === 'string') {
      sources.add(source);
    }
    if (Array.isArray(block?.children)) {
      for (const child of block.children) {
        pending.push(child);
      }
    }
  }

  return sources;
}

function preservedImage(source: string, known: ReadonlySet<string>): boolean {
  if (!known.has(source)) {
    return false;
  }
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,/iu.test(source)) {
    return true;
  }

  const absolute = URL.parse(source);
  if (!absolute || !['http:', 'https:'].includes(absolute.protocol)) {
    return false;
  }

  const hasCredentials = absolute.username !== '' || absolute.password !== '';
  const isHostLocal = localHost.test(absolute.hostname.replace(/\.$/u, ''));
  const isAssetRoute = absolute.pathname.startsWith('/studio-archive-assets/');

  return !hasCredentials && !isHostLocal && !isAssetRoute;
}

function validImage(
  source: JsonValue | undefined,
  assets: DocumentAssets,
  known: ReadonlySet<string>,
): boolean {
  if (source === undefined || source === '') {
    return true;
  }
  if (typeof source !== 'string') {
    return false;
  }

  const match = assetPath.exec(source);
  if (match) {
    const [, boardId, assetId] = match;

    return boardId === assets.boardId && assetId !== undefined && assets.hasAsset(assetId);
  }

  return preservedImage(source, known);
}

function validBlock(
  block: JsonObject,
  assets: DocumentAssets,
  known: ReadonlySet<string>,
): boolean {
  const { type, children, props: rawProps } = block;
  const props = rawProps === undefined ? {} : contentRecord(rawProps);
  const validType = typeof type === 'string' && blockTypes.has(type);
  const validChildren = children === undefined || Array.isArray(children);
  if (!validType || !props || !validChildren) {
    return false;
  }

  return type !== 'image' || validImage(props.url, assets, known);
}

function checkBlocks(
  blocks: readonly JsonValue[],
  assets: DocumentAssets,
  known: ReadonlySet<string>,
): ContentEditRejection | undefined {
  const pending: BlockEntry[] = blocks.map((block) => ({ block, depth: 0 }));
  const ids = new Set<string>();
  while (pending.length) {
    if (pending.length + ids.size > maximumBlocks) {
      return 'tooLarge';
    }

    const entry = pending.pop();
    if (!entry || entry.depth >= maximumDepth) {
      return 'tooLarge';
    }

    const block = contentRecord(entry.block);
    const id = block?.blockId;
    const validId = typeof id === 'string' && contentIdentifier.test(id);
    if (!block || !validId) {
      return 'invalidEdit';
    }
    if (ids.has(id) || !validBlock(block, assets, known)) {
      return 'invalidEdit';
    }

    ids.add(id);
    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        pending.push({ block: child, depth: entry.depth + 1 });
      }
    }
  }
}

export function editDocumentContent(
  data: JsonObject,
  current: JsonObject,
  assets: DocumentAssets,
): ContentPayloadPlan {
  const { title, schemaVersion, blocks } = data;
  if (typeof title !== 'string' || schemaVersion !== documentSchema || !Array.isArray(blocks)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const label = title.trim() || untitledDocument;
  if (label.length > contentTitleLimit || !contentFits(data)) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const rejection = checkBlocks(blocks, assets, knownImages(current));
  if (rejection) {
    return { kind: 'rejected', reason: rejection };
  }

  return { kind: 'updated', label, data: { title: label, schemaVersion, blocks } };
}
