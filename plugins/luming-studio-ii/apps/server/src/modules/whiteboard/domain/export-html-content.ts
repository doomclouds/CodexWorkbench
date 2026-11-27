import { escapeXml } from './export-svg-content.js';
import type { BoardExportAsset } from './export-types.js';
import type { JsonObject, JsonValue } from './model.js';

type AssetMap = ReadonlyMap<string, BoardExportAsset>;

const assetUri = /^data:(?:image|video)\/[a-z\d.+-]+;base64,[a-z\d+/]+={0,2}$/iu;
const markupAsset =
  /(?:\b(?:src|href|poster)\s*=\s*["']|\burl\(\s*["']?)(\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})(?=["'\s)])/gu;
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

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
const linkTarget = /^(?:https?:\/\/|mailto:)[^\p{Cc}]+$/iu;

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
  if (run.type === 'link' && typeof run.href === 'string' && linkTarget.test(run.href)) {
    return `<a href="${escapeXml(run.href)}" target="_blank" rel="noopener noreferrer">${inline(run.content, depth + 1)}</a>`;
  }
  if (typeof run.text !== 'string') {
    return inline(run.content, depth + 1);
  }

  const styles = object(run.styles);

  return formatTags.reduce(
    (content, [property, tag]) => (styles?.[property] ? `<${tag}>${content}</${tag}>` : content),
    text(run.text).replaceAll('\n', '<br>'),
  );
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

function blockMarkup(block: JsonObject, assets: AssetMap) {
  const content = inline(block.content);
  const props = object(block.props);
  const type = typeof block.type === 'string' ? block.type : '';
  switch (type) {
    case 'heading': {
      const chosen = props?.level;
      const level =
        typeof chosen === 'number' && Number.isInteger(chosen)
          ? Math.max(1, Math.min(6, chosen))
          : 1;

      return `<h${level}>${content}</h${level}>`;
    }
    case 'bulletListItem':
      return `<p class="list-item">${content}</p>`;
    case 'numberedListItem':
      return `<p class="list-item numbered">${content}</p>`;
    case 'checkListItem':
      return `<p><label><input disabled type="checkbox"${props?.checked ? ' checked' : ''}> ${content}</label></p>`;
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

      return source
        ? `<figure><img src="${escapeXml(source)}" alt="${text(props?.caption)}"><figcaption>${text(props?.caption)}</figcaption></figure>`
        : `<p>${text(props?.caption)}</p>`;
    }
    default:
      return `<p>${content}</p>`;
  }
}

export function documentMarkup(value: JsonValue | undefined, assets: AssetMap, depth = 0): string {
  if (!Array.isArray(value) || depth >= 64) {
    return '';
  }

  return value
    .map((entry) => {
      const block = object(entry);
      if (!block) {
        return '';
      }

      return blockMarkup(block, assets) + documentMarkup(block.children, assets, depth + 1);
    })
    .join('');
}

export function todoMarkup(value: JsonValue | undefined) {
  if (!Array.isArray(value)) {
    return '';
  }

  const rows = value.map((entry) => {
    const item = object(entry);

    return `<li><label><input disabled type="checkbox"${item?.checked ? ' checked' : ''}>${text(item?.text)}</label></li>`;
  });

  return `<ul>${rows.join('')}</ul>`;
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
