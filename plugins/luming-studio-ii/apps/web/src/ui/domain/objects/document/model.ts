import type { DocumentBlock, DocumentContent, DocumentDraft, DocumentJson } from './contracts.js';

export const untitledDocument = '未命名文档';
export const documentTitleLimit = 200;
export const documentTreeDepth = 64;
const archiveDocumentAsset =
  /^\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/u;

export const emptyDocument: DocumentContent = {
  schemaVersion: 1,
  blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '', children: [] }],
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown, depth: number): boolean {
  if (left === right) {
    return true;
  }
  if (depth === documentTreeDepth) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index], depth + 1))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const keys = Object.keys(left);

  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key], depth + 1))
  );
}

export function sameDocument(left: DocumentContent, right: DocumentContent) {
  return sameValue(left.blocks, right.blocks, 0);
}

export function sameDraft(left: DocumentDraft, right: DocumentDraft) {
  return left.title === right.title && sameDocument(left.document, right.document);
}

export function flattenBlocks(blocks: readonly DocumentBlock[]): DocumentBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children ?? [])]);
}

function inlineText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(inlineText).join('');
  }
  if (isRecord(value)) {
    return inlineText(value.text ?? value.content);
  }

  return '';
}

export function tableRows(content: DocumentJson | undefined) {
  if (!isRecord(content) || !Array.isArray(content.rows)) {
    return [];
  }

  return content.rows.filter(isRecord).map((row) => (Array.isArray(row.cells) ? row.cells : []));
}

export function documentHeadingLevel(block: DocumentBlock): number {
  const level = Number(block.props.level);

  return Number.isFinite(level) ? Math.max(1, Math.min(6, Math.trunc(level))) : 1;
}

export function documentListStart(block: DocumentBlock): number | undefined {
  const value = Number(block.props.start);

  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function documentCellSpan(cell: unknown, dimension: 'colspan' | 'rowspan') {
  if (!isRecord(cell) || !isRecord(cell.props)) {
    return undefined;
  }

  const value = cell.props[dimension];
  const valid = typeof value === 'number' && Number.isInteger(value);

  return valid && value > 1 && value <= 100 ? value : undefined;
}

export function blockText(block: DocumentBlock) {
  if (block.type === 'image') {
    return inlineText(block.props.caption ?? block.props.name).trim();
  }
  if (block.type === 'table') {
    return tableRows(block.content)
      .map((cells) => cells.map(inlineText).join('\t'))
      .join('\n');
  }

  return inlineText(block.content).trim();
}

export function documentText(document: DocumentContent) {
  return flattenBlocks(document.blocks).map(blockText).filter(Boolean).join('\n');
}

export function safeDocumentLink(value: unknown) {
  if (typeof value !== 'string' || !/^https?:\/\//iu.test(value)) {
    return undefined;
  }

  const url = URL.parse(value);
  if (url && !url.username && !url.password) {
    return url.href;
  }
}

export function safeDocumentImage(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/iu.test(value)) {
    return value;
  }
  if (value.startsWith('blob:') && URL.canParse(value)) {
    return value;
  }

  return safeDocumentLink(value);
}

export function isDocumentAssetPath(value: string) {
  return archiveDocumentAsset.test(value);
}

export function isPrivateDocumentAssetSource(source: string) {
  if (isDocumentAssetPath(source)) {
    return true;
  }

  const url = safeDocumentLink(source) && URL.parse(source);

  return Boolean(url && isDocumentAssetPath(url.pathname) && !url.search && !url.hash);
}
