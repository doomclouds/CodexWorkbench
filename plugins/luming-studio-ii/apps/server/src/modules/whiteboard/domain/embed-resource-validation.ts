import {
  TokenType,
  isTokenAtKeyword,
  isTokenFunction,
  isTokenString,
  isTokenURL,
  tokenize,
} from '@csstools/css-tokenizer';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { PayloadRecord } from './model.js';

type HtmlNode = DefaultTreeAdapterMap['node'];
type CollectResource = (source: string) => void;

const urlAttributes = new Set(['src', 'href', 'poster', 'background', 'data']);
const sourceSetAttributes = new Set(['srcset', 'imagesrcset']);
const cssAttributes = new Set([
  'style',
  'clip-path',
  'color-profile',
  'cursor',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
]);
const urlStringFunctions = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set']);
const sourceSetSeparators = /[\t\n\f\r ,]*/uy;
const sourceSetUrl = /[^\t\n\f\r ]+/uy;
const sourceSetDescriptor = /(?:\([^)]*\)|[^,(])*/uy;

function collectCss(css: string, collect: CollectResource) {
  const functions: string[] = [];
  let afterImport = false;
  for (const token of tokenize({ css })) {
    if (token[0] === TokenType.Whitespace || token[0] === TokenType.Comment) {
      continue;
    }

    if (isTokenURL(token)) {
      collect(token[4].value);
    }
    if (isTokenString(token) && (afterImport || urlStringFunctions.has(functions.at(-1) ?? ''))) {
      collect(token[4].value);
    }
    afterImport = isTokenAtKeyword(token) && token[4].value.toLowerCase() === 'import';
    if (isTokenFunction(token)) {
      functions.push(token[4].value.toLowerCase());
    } else if (token[0] === TokenType.OpenParen) {
      functions.push('');
    } else if (token[0] === TokenType.CloseParen) {
      functions.pop();
    }
  }
}

function collectSourceSet(source: string, collect: CollectResource) {
  let offset = 0;
  while (offset < source.length) {
    sourceSetSeparators.lastIndex = offset;
    const start = sourceSetSeparators.exec(source)?.[0].length ?? 0;
    sourceSetUrl.lastIndex = offset + start;
    const url = sourceSetUrl.exec(source)?.[0];
    if (!url) {
      return;
    }

    offset += start + url.length;
    let end = url.length;
    while (url[end - 1] === ',') {
      end -= 1;
    }
    collect(url.slice(0, end));
    if (end === url.length) {
      sourceSetDescriptor.lastIndex = offset;
      offset += sourceSetDescriptor.exec(source)?.[0].length ?? 0;
      if (source[offset] === ',') {
        offset += 1;
      }
    }
  }
}

function collectElement(element: DefaultTreeAdapterMap['element'], collect: CollectResource) {
  for (const { name, value } of element.attrs) {
    if (urlAttributes.has(name) && (name !== 'data' || element.tagName === 'object')) {
      collect(value);
    } else if (sourceSetAttributes.has(name)) {
      collectSourceSet(value, collect);
    } else if (cssAttributes.has(name)) {
      collectCss(value, collect);
    }
  }

  if (element.tagName === 'style') {
    const css = element.childNodes.map((node) => ('value' in node ? node.value : '')).join('');
    collectCss(css, collect);
  }
}

function inlineResourceCounts(html: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const collect: CollectResource = (source) => {
    const url = source.trim().replace(/[\t\n\r]/gu, '');
    if (url.slice(0, 5).toLowerCase() === 'data:') {
      const key = 'data:' + url.slice(5);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  };
  const pending: HtmlNode[] = [parse(html)];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if ('childNodes' in node) {
      for (const child of node.childNodes) {
        pending.push(child);
      }
    }
    if ('attrs' in node) {
      collectElement(node, collect);
    }
    if ('content' in node) {
      pending.push(node.content);
    }
  }

  return counts;
}

export function addsInlineEmbedResource(html: string, previous = ''): boolean {
  if (html === previous) {
    return false;
  }

  const next = inlineResourceCounts(html);
  if (next.size === 0) {
    return false;
  }

  const existing = inlineResourceCounts(previous);

  return [...next].some(([url, count]) => count > (existing.get(url) ?? 0));
}

export function hasInlineEmbedResource({ bodyKind, data }: PayloadRecord): boolean {
  return (
    bodyKind === 'embed' && typeof data.html === 'string' && addsInlineEmbedResource(data.html)
  );
}
