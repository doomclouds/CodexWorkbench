import {
  parseRichText,
  type RichTextSegment,
} from '@codexworkbench/luming-studio-ii-whiteboard-shared/rich-text';
import { escapeXml } from './export-svg-content.js';
import { svgColor } from './export-svg-shapes.js';
import type { BoardExportAsset } from './export-types.js';
import type { JsonObject, JsonValue } from './model.js';

type AssetMap = ReadonlyMap<string, BoardExportAsset>;

const assetUri = /^data:(?:image|video)\/[a-z\d.+-]+;base64,[a-z\d+/]+={0,2}$/iu;
const markupAsset =
  /(?:\b(?:src|href|poster)\s*=\s*["']|\burl\(\s*["']?)(\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})(?=["'\s)])/gu;
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const boardTableCss =
  '.board-export-table{box-sizing:border-box;width:100%;height:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font:17px/1.4 system-ui,sans-serif;background:#f5f5f5;color:#2d3142;border:1px solid #cdd0d5;border-radius:5px}' +
  '.board-export-table :is(th,td){padding:11px 13px;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere;border-inline-end:1px solid #e1e2e5;border-block-end:1px solid #e1e2e5}' +
  '.board-export-table :is(th,td):last-child{border-inline-end:0}.board-export-table tr:last-child :is(th,td){border-block-end:0}.board-export-table th{background:var(--board-export-table-head,#eff0f1)}';

export function offlineAsset(value: JsonValue | undefined, assets: AssetMap) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const captured = assets.get(value);
  const embedded = captured ? `data:${captured.mimeType};base64,${captured.base64}` : value;

  return assetUri.test(embedded) ? embedded : undefined;
}

function object(value: JsonValue | undefined): JsonObject | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? escapeXml(value) : '';
}

const formatTags = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['strike', 's'],
  ['code', 'code'],
] as const;
const documentColors = new Map([
  ['gray', '#62666d'],
  ['brown', '#825747'],
  ['red', '#9e303b'],
  ['orange', '#ac571c'],
  ['yellow', '#805d13'],
  ['green', '#22674c'],
  ['blue', '#31687f'],
  ['purple', '#634997'],
  ['pink', '#9b497a'],
]);
const linkTarget = /^(?:https?:\/\/|mailto:)[^\p{Cc}]+$/iu;

export function exportLink(value: JsonValue | undefined) {
  return typeof value === 'string' && linkTarget.test(value) ? escapeXml(value) : undefined;
}

function richSegment(segment: RichTextSegment) {
  let rendered = escapeXml(segment.text);
  if (segment.code || segment.type === 'code') {
    rendered = `<code>${rendered}</code>`;
  }
  if (segment.italic || segment.type === 'italic') {
    rendered = `<em>${rendered}</em>`;
  }
  if (segment.bold || segment.type === 'bold') {
    rendered = `<strong>${rendered}</strong>`;
  }
  const href = exportLink(segment.href);

  return href
    ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${rendered}</a>`
    : rendered;
}

export function richTextMarkup(value: string) {
  return parseRichText(value)
    .map((line) => {
      const text = line.segments.map(richSegment).join('');
      const marker = line.marker
        ? `<span aria-hidden="true">${escapeXml(line.marker)} </span>`
        : '';
      const indent = line.indent ? ` style="padding-inline-start:${line.indent * 1.5}em"` : '';

      return `<div class="board-rich-line"${indent}>${marker}${text}</div>`;
    })
    .join('');
}

function inline(value: JsonValue | undefined, depth = 0): string {
  if (depth >= 64) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => inline(item, depth + 1)).join('');
  }

  const run = object(value);
  if (!run) {
    return text(value).replaceAll('\n', '<br>');
  }

  if (run.type === 'link') {
    const href = exportLink(run.href);
    const label = inline(run.content, depth + 1);

    return href
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  }
  if (typeof run.text !== 'string') {
    return inline(run.content, depth + 1);
  }

  const styles = object(run.styles);

  const formatted = formatTags.reduce(
    (content, [property, tag]) => (styles?.[property] ? `<${tag}>${content}</${tag}>` : content),
    text(run.text).replaceAll('\n', '<br>'),
  );
  const ink = documentColor(styles?.textColor);
  const background = documentColor(styles?.backgroundColor);
  const style =
    (ink ? 'color:' + ink + ';' : '') +
    (background ? 'background-color:color-mix(in srgb,' + background + ' 20%,transparent);' : '');

  return style ? `<span style="${style}">${formatted}</span>` : formatted;
}

function documentColor(value: JsonValue | undefined) {
  return typeof value === 'string' ? documentColors.get(value) : undefined;
}

function sequence(value: JsonValue | undefined) {
  return Array.isArray(value) ? value : [];
}

function tableSpan(props: JsonObject | undefined, name: 'rowspan' | 'colspan') {
  const value = props?.[name];
  const safe = typeof value === 'number' && Number.isInteger(value);

  return safe && value > 1 && value <= 100 ? ` ${name}="${value}"` : '';
}

function tableMarkup(value: JsonValue | undefined) {
  const table = object(value);
  const headerCount = typeof table?.headerRows === 'number' ? table.headerRows : 0;
  const rows = sequence(table?.rows).map((row, index) => {
    const tag = index < headerCount ? 'th' : 'td';
    const cells = sequence(object(row)?.cells).map((cell) => {
      const props = object(object(cell)?.props);

      return `<${tag}${tableSpan(props, 'colspan')}${tableSpan(props, 'rowspan')}>${inline(cell)}</${tag}>`;
    });

    return `<tr>${cells.join('')}</tr>`;
  });

  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

function boardCell(cell: JsonValue) {
  const data = object(cell);
  if (typeof data?.number === 'number') {
    return String(data.number);
  }
  if (typeof data?.boolValue === 'boolean') {
    return String(data.boolValue);
  }

  return typeof data?.text === 'string' ? data.text : '';
}

function boardTableRows(data: JsonObject) {
  const rows = sequence(object(data.grid)?.rows);
  if (rows.length) {
    return rows.map((row) => sequence(object(row)?.cells).map(boardCell));
  }

  const source = typeof data.text === 'string' ? data.text : '';

  return source
    .replace(/\r\n?/gu, '\n')
    .replace(/\n$/u, '')
    .split('\n')
    .map((row) => row.split('\t'));
}

function tableColumns(value: JsonValue | undefined, count: number) {
  const widths = sequence(value).filter(
    (width): width is number => typeof width === 'number' && Number.isFinite(width) && width > 0,
  );

  if (widths.length !== count) {
    return '';
  }

  const total = widths.reduce((sum, width) => sum + width, 0);
  const columns = widths.map((width) => `<col style="width:${(100 * width) / total}%">`);

  return `<colgroup>${columns.join('')}</colgroup>`;
}

export function boardTableMarkup(data: JsonObject, fill?: string) {
  const grid = object(data.grid);
  const rows = boardTableRows(data);
  const count = rows.reduce((width, row) => Math.max(width, row.length), 1);
  const contents = rows.map((row, index) => {
    const cell = index === 0 && grid?.head !== false ? 'th' : 'td';
    const cells = Array.from(
      { length: count },
      (_, column) => `<${cell}>${richTextMarkup(row[column] ?? '')}</${cell}>`,
    );

    return `<tr>${cells.join('')}</tr>`;
  });
  const header = svgColor(fill, '#eff0f1');
  const columns = tableColumns(grid?.columnWidths, count);

  return `<table class="board-export-table" style="--board-export-table-head:${header}">${columns}<tbody>${contents.join('')}</tbody></table>`;
}

export function documentAssetsAvailable(
  value: JsonValue | undefined,
  assets: AssetMap,
  depth = 0,
): boolean {
  if (depth >= 64) {
    return false;
  }

  return sequence(value).every((entry) => {
    const block = object(entry);
    const url = object(block?.props)?.url;
    const image = block?.type === 'image' && typeof url === 'string' && url;
    const source = image ? offlineAsset(url, assets) : undefined;
    const valid = !image || source?.startsWith('data:image/');

    return Boolean(valid) && documentAssetsAvailable(block?.children, assets, depth + 1);
  });
}

function blockMarkup(block: JsonObject, assets: AssetMap) {
  const content = inline(block.content);
  const props = object(block.props);
  const type = typeof block.type === 'string' ? block.type : '';
  const align = props?.textAlignment;
  const style =
    typeof align === 'string' && /^(?:left|center|right|justify)$/u.test(align)
      ? ` style="text-align:${align}"`
      : '';

  switch (type) {
    case 'heading': {
      const chosen = props?.level;
      const level =
        typeof chosen === 'number' && Number.isInteger(chosen)
          ? Math.max(1, Math.min(6, chosen))
          : 1;

      return `<h${level}${style}>${content}</h${level}>`;
    }
    case 'quote':
      return `<blockquote>${content}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${content}</code></pre>`;
    case 'divider':
      return '<hr>';
    case 'table':
      return tableMarkup(block.content);
    case 'image': {
      const source = offlineAsset(props?.url, assets);
      const width = props?.previewWidth;
      const size =
        typeof width === 'number' && Number.isFinite(width) && width > 0
          ? ` width="${Math.min(width, 10000)}"`
          : '';
      const label = text(props?.caption || props?.name);
      const caption = props?.caption ? `<figcaption>${text(props.caption)}</figcaption>` : '';

      return source
        ? `<figure><img src="${escapeXml(source)}" alt="${label}"${size}>${caption}</figure>`
        : `<figure aria-label="未添加图片">${caption}</figure>`;
    }
    default:
      return `<p${style}>${content}</p>`;
  }
}

const documentLists = new Set<JsonValue>(['bulletListItem', 'numberedListItem', 'checkListItem']);

function listOrdinal(block: JsonObject) {
  const start = object(block.props)?.start;

  return typeof start === 'number' && Number.isSafeInteger(start) && start > 0 ? start : undefined;
}

function listMarkup(blocks: readonly JsonObject[], assets: AssetMap, depth: number) {
  const first = blocks[0]!;
  const ordered = first.type === 'numberedListItem';
  const task = first.type === 'checkListItem';
  const tag = ordered ? 'ol' : 'ul';
  const start = ordered && listOrdinal(first);
  const ordinalStart = start ? ` start="${start}"` : '';
  const className = task ? ' class="task-list"' : '';
  const rows = blocks.map((block, index) => {
    const number = ordered && index > 0 && listOrdinal(block);
    const ordinal = number ? ` value="${number}"` : '';
    const checked = object(block.props)?.checked === true ? ' checked' : '';
    const marker = task ? `<input type="checkbox" disabled${checked}> ` : '';

    return `<li${ordinal}>${marker}${inline(block.content)}${documentMarkup(block.children, assets, depth + 1)}</li>`;
  });

  return `<${tag}${ordinalStart}${className}>${rows.join('')}</${tag}>`;
}

export function documentMarkup(value: JsonValue | undefined, assets: AssetMap, depth = 0): string {
  if (!Array.isArray(value) || depth >= 64) {
    return '';
  }

  const blocks = value.map(object).filter((block) => block !== undefined);
  const markup: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (block.type === undefined || !documentLists.has(block.type)) {
      markup.push(blockMarkup(block, assets) + documentMarkup(block.children, assets, depth + 1));
      continue;
    }
    const group = [block];
    let next = blocks[index + 1];
    while (next?.type === block.type) {
      group.push(next);
      index++;
      next = blocks[index + 1];
    }
    markup.push(listMarkup(group, assets, depth));
  }

  return markup.join('');
}

export function todoMarkup(value: JsonValue | undefined) {
  if (!Array.isArray(value)) {
    return '';
  }

  const rows = value.map((entry) => {
    const item = object(entry);

    return `<li><label><input disabled type="checkbox"${item?.checked ? ' checked' : ''}>${text(item?.text)}</label></li>`;
  });

  return `<ul class="board-tasks">${rows.join('')}</ul>`;
}

function bridge(seed: JsonValue | undefined) {
  const state = JSON.stringify(seed ?? null).replaceAll('<', '\\u003c');

  return `<script>(()=>{let state=${state};const listeners=new Set();const load=()=>structuredClone(state);const save=(value)=>{const json=JSON.stringify(value);if(!value||typeof value!=='object'||Array.isArray(value)||!json||new TextEncoder().encode(json).length>65536)throw new TypeError('Invalid Studio state');state=JSON.parse(json);for(const listener of listeners)listener(load());};const onLoad=(listener)=>{listeners.add(listener);return()=>listeners.delete(listener);};Object.defineProperty(window,'studioEmbed',{value:Object.freeze({load,save,onLoad})});})()</script>`;
}

export function embedMarkup(data: JsonObject, assets: AssetMap, interactive = true) {
  const html = typeof data.html === 'string' ? data.html : '';
  const source = html.replaceAll(markupAsset, (match: string, previous: string) => {
    const embedded = offlineAsset(previous, assets);

    return embedded ? match.replace(previous, embedded) : match;
  });
  const body = source.replace(/^\s*<!doctype[^>]*>/iu, '');

  const policy = interactive ? csp : csp.replace("script-src 'unsafe-inline'", "script-src 'none'");
  const state = interactive ? bridge(data.state) : '';

  return (
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    policy +
    '">' +
    state +
    body
  );
}
