import type { DocumentBlock, DocumentDraft, DocumentPaper } from './contracts.js';
import {
  blockText,
  documentCellSpan,
  documentHeadingLevel,
  documentListStart,
  flattenBlocks,
  isPrivateDocumentAssetSource,
  isRecord,
  safeDocumentImage,
  safeDocumentLink,
  tableRows,
  untitledDocument,
} from './model.js';

interface DocumentAsset {
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export type DocumentAssetReader = (
  source: string,
  signal: AbortSignal,
) => Promise<DocumentAsset | undefined>;

const markTags = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['strike', 's'],
  ['code', 'code'],
] as const;
const alignments = new Set(['left', 'right', 'center', 'justify']);
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const listKinds = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);
const base64Chunk = 32 * 1024;
const filenameSpecial = /[<>:"/\\|?*]/gu;
const allowCssColor = /^(?:#[\da-f]{3,8}|transparent|rgba?\([\d., ]+\))$/iu;
const safeHtmlCss = `body{margin:0}main{box-sizing:border-box;max-width:900px;min-height:100vh;margin:auto;padding:28px;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.4;margin:1.25em 0 .5em}p{margin:.65em 0}img{max-width:100%;height:auto}figure{margin:1em 0}figcaption{font-size:13px;opacity:.75}pre{padding:14px;background:color-mix(in srgb,currentColor 8%,transparent);border-radius:6px;overflow:auto;white-space:pre-wrap}code{font-family:Consolas,monospace}blockquote{border-left:3px solid currentColor;padding-left:16px;margin:1em 0;opacity:.8}table{border-collapse:collapse;width:100%}th,td{border:1px solid currentColor;padding:6px 10px;min-width:60px}.document-table{overflow:auto}.document-tasks{list-style:none;padding-left:1em}hr{border:0;border-top:1px solid currentColor;margin:20px 0}`;
const inlineColors = {
  gray: '#62666d',
  brown: '#825747',
  red: '#9e303b',
  orange: '#ac571c',
  yellow: '#805d13',
  green: '#22674c',
  blue: '#31687f',
  purple: '#634997',
  pink: '#9b497a',
} as const;

function escapeHtml(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';

  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function exportColor(value: unknown): string | undefined {
  if (typeof value === 'string' && Object.hasOwn(inlineColors, value)) {
    return inlineColors[value as keyof typeof inlineColors];
  }
}

function inlineMarkup(value: unknown): string {
  if (typeof value === 'string') {
    return escapeHtml(value).replaceAll('\n', '<br>');
  }
  if (Array.isArray(value)) {
    return value.map(inlineMarkup).join('');
  }
  if (!isRecord(value)) {
    return '';
  }

  if (value.type === 'link') {
    const href = safeDocumentLink(value.href);
    const text = inlineMarkup(value.content);

    return href ? '<a href="' + escapeHtml(href) + '" rel="noreferrer">' + text + '</a>' : text;
  }
  if (typeof value.text !== 'string') {
    return inlineMarkup(value.content);
  }

  const styles = isRecord(value.styles) ? value.styles : {};
  let text = inlineMarkup(value.text);
  for (const [property, tag] of markTags) {
    if (styles[property]) {
      text = '<' + tag + '>' + text + '</' + tag + '>';
    }
  }

  const ink = exportColor(styles.textColor);
  const background = exportColor(styles.backgroundColor);
  const css =
    (ink ? 'color:' + ink + ';' : '') +
    (background ? 'background-color:color-mix(in srgb,' + background + ' 20%,transparent);' : '');

  return css ? '<span style="' + css + '">' + text + '</span>' : text;
}

function cellMarkup(cell: unknown, header: boolean) {
  const tag = header ? 'th' : 'td';
  const cols = documentCellSpan(cell, 'colspan');
  const rows = documentCellSpan(cell, 'rowspan');
  const span = (cols ? ' colspan="' + cols + '"' : '') + (rows ? ' rowspan="' + rows + '"' : '');

  return '<' + tag + span + '>' + inlineMarkup(cell) + '</' + tag + '>';
}

function tableMarkup(block: DocumentBlock) {
  const content = block.content;
  const headers = isRecord(content) ? Number(content.headerRows) || 0 : 0;
  const rows = tableRows(content).map((row, index) => {
    const cells = row.map((cell) => cellMarkup(cell, index < headers)).join('');

    return '<tr>' + cells + '</tr>';
  });

  return '<table><tbody>' + rows.join('') + '</tbody></table>';
}

function blockIdentity(block: DocumentBlock) {
  return ' data-block-id="' + escapeHtml(block.id) + '"';
}

function safeInlineImage(source: unknown) {
  const url = safeDocumentImage(source);

  return url?.startsWith('data:image/') ? url : undefined;
}

function imageMarkup(block: DocumentBlock, images: ReadonlyMap<string, string>) {
  const { caption, name, previewWidth, url } = block.props;
  const source = typeof url === 'string' ? images.get(url) : undefined;
  const embedded = safeInlineImage(url) ?? source;
  const size =
    typeof previewWidth === 'number' && previewWidth > 0 ? Math.min(10_000, previewWidth) : 0;
  const style = size ? ' style="width:' + size + 'px"' : '';
  const label = escapeHtml(caption || name || '图片');
  const image = embedded
    ? '<img src="' + escapeHtml(embedded) + '" alt="' + label + '"' + style + '>'
    : '<span>图片尚未嵌入 · ' + label + '</span>';
  const description = caption ? '<figcaption>' + escapeHtml(caption) + '</figcaption>' : '';

  return '<figure' + blockIdentity(block) + '>' + image + description + '</figure>';
}

function blockMarkup(block: DocumentBlock, images: ReadonlyMap<string, string>) {
  const id = blockIdentity(block);
  const content = inlineMarkup(block.content);
  const alignment = block.props.textAlignment;
  const style =
    typeof alignment === 'string' && alignments.has(alignment)
      ? ' style="text-align:' + alignment + '"'
      : '';

  switch (block.type) {
    case 'heading': {
      const tag = 'h' + documentHeadingLevel(block);

      return '<' + tag + id + style + '>' + content + '</' + tag + '>';
    }
    case 'codeBlock':
      return '<pre' + id + '><code>' + escapeHtml(blockText(block)) + '</code></pre>';
    case 'quote':
      return '<blockquote' + id + '>' + content + '</blockquote>';
    case 'divider':
      return '<hr' + id + '>';
    case 'table':
      return '<div class="document-table"' + id + '>' + tableMarkup(block) + '</div>';
    case 'image':
      return imageMarkup(block, images);
    case 'paragraph':
    case 'bulletListItem':
    case 'checkListItem':
    case 'numberedListItem':
      return '<p' + id + style + '>' + (content || '<br>') + '</p>';
  }
}

function listMarkup(list: readonly DocumentBlock[], images: ReadonlyMap<string, string>) {
  const first = list[0];
  if (!first) {
    return '';
  }

  const numbered = first.type === 'numberedListItem';
  const tasks = first.type === 'checkListItem';
  const tag = numbered ? 'ol' : 'ul';
  const start = numbered ? documentListStart(first) : undefined;
  const kindClass = tasks ? ' class="document-tasks"' : '';
  const startAttribute = start ? ' start="' + start + '"' : '';
  const attributes = kindClass + startAttribute;
  const items = list.map((block, index) => {
    const ordinal = numbered && index ? documentListStart(block) : undefined;
    const value = ordinal ? ' value="' + ordinal + '"' : '';
    const checked = block.props.checked === true ? ' checked' : '';
    const marker = tasks ? '<input type="checkbox" disabled' + checked + '> ' : '';
    const content =
      marker + inlineMarkup(block.content) + blocksMarkup(block.children ?? [], images);

    return '<li' + blockIdentity(block) + value + '>' + content + '</li>';
  });

  return '<' + tag + attributes + '>' + items.join('') + '</' + tag + '>';
}

function blocksMarkup(
  blocks: readonly DocumentBlock[],
  images: ReadonlyMap<string, string>,
): string {
  let result = '';
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) {
      continue;
    }

    if (!listKinds.has(block.type)) {
      result += blockMarkup(block, images) + blocksMarkup(block.children ?? [], images);
      continue;
    }

    const group = [block];
    let next = blocks[index + 1];
    while (next?.type === block.type) {
      group.push(next);
      index++;
      next = blocks[index + 1];
    }
    result += listMarkup(group, images);
  }

  return result;
}

function encodeImage(asset: DocumentAsset) {
  const mime = asset.mimeType.split(';', 1)[0]?.trim().toLowerCase();
  if (!mime || !mimeTypes.has(mime) || !asset.content.byteLength) {
    return undefined;
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < asset.content.length; offset += base64Chunk) {
    chunks.push(String.fromCharCode(...asset.content.subarray(offset, offset + base64Chunk)));
  }

  return 'data:' + mime + ';base64,' + btoa(chunks.join(''));
}

export async function resolveDocumentAsset(
  source: string,
  signal: AbortSignal,
  readAsset?: DocumentAssetReader,
) {
  if (!readAsset || !isPrivateDocumentAssetSource(source)) {
    return undefined;
  }

  signal.throwIfAborted();
  const asset = await readAsset(source, signal);
  signal.throwIfAborted();

  return asset && encodeImage(asset);
}

async function loadImages(
  draft: DocumentDraft,
  signal: AbortSignal,
  readAsset?: DocumentAssetReader,
) {
  const sources = new Set<string>();
  const images = new Map<string, string>();
  if (!readAsset) {
    return images;
  }

  for (const block of flattenBlocks(draft.document.blocks)) {
    const source = block.props.url;
    const privateImage = typeof source === 'string' && isPrivateDocumentAssetSource(source);
    if (block.type === 'image' && privateImage) {
      sources.add(source);
    }
  }

  for (const source of sources) {
    const image = await resolveDocumentAsset(source, signal, readAsset);
    if (image) {
      images.set(source, image);
    }
  }

  return images;
}

function safeColor(raw: string | undefined, fallback: string) {
  return raw && allowCssColor.test(raw) ? raw : fallback;
}

function htmlDocument(
  draft: DocumentDraft,
  paper: DocumentPaper | undefined,
  images: ReadonlyMap<string, string>,
) {
  const title = escapeHtml(draft.title || untitledDocument);
  const dark = paper?.scheme === 'dark';
  const scheme = dark ? 'dark' : 'light';
  const fill = safeColor(paper?.fill, dark ? '#1c1d1e' : '#ffffff');
  const ink = safeColor(paper?.ink, dark ? '#f7f4ed' : '#211f1d');
  const backdrop = safeColor(paper?.backdrop, fill);
  const style = 'background:' + fill + ';color:' + ink + ';color-scheme:' + scheme;
  const policy =
    "default-src 'none';style-src 'unsafe-inline';img-src data:;object-src 'none';base-uri 'none';form-action 'none'";
  const content = blocksMarkup(draft.document.blocks, images);

  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' +
    policy +
    '">' +
    '<title>' +
    title +
    '</title><style>body{background:' +
    backdrop +
    '}' +
    safeHtmlCss +
    '</style></head><body><main style="' +
    style +
    '"><h1>' +
    title +
    '</h1>' +
    content +
    '</main></body></html>'
  );
}

interface ExportDocumentOptions {
  readonly paper?: DocumentPaper;
  readonly readAsset?: DocumentAssetReader;
  readonly signal: AbortSignal;
}

export async function exportDocumentFile(
  format: 'html' | 'json',
  draft: DocumentDraft,
  { paper, readAsset, signal }: ExportDocumentOptions,
) {
  const { title, document } = draft;
  const basename =
    title
      .replace(filenameSpecial, '-')
      .replace(/\p{Cc}/gu, '')
      .trim() || '文档';
  const html = format === 'html';
  signal.throwIfAborted();
  const output = html
    ? htmlDocument(draft, paper, await loadImages(draft, signal, readAsset))
    : JSON.stringify({ title, document }, null, 2);
  signal.throwIfAborted();

  return {
    filename: basename + '.' + format,
    mimeType: html ? 'text/html' : 'application/json',
    content: new TextEncoder().encode(output),
  };
}
