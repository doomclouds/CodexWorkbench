type AssetResolver = (source: string) => string;

const tokens =
  /<!--[\s\S]*?-->|(<(script|style)\b(?:"[^"]*"|'[^']*'|[^'"<>])*>)([\s\S]*?)(<\/\2\s*>)|<[a-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>/giu;
const attributes = /(\s+)([^\s=/"'<>\x60]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>\x60]+)/gu;
const cssTokens =
  /\/\*[\s\S]*?\*\/|(\burl\(\s*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s"'()]+)(\s*\))|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/giu;
const scriptTokens =
  /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60/gu;
const standalonePath =
  /^([([{'"“‘]*)(\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})([.,!?;:'")\]}”’。，；：、…]*)$/u;
const urlAttributes = new Set(['src', 'href', 'poster', 'data', 'background', 'xlink:href']);
const quoted = new Set(['"', "'", '\x60']);

function mapAttributeValue(value: string, replace: AssetResolver): string {
  const quote = value[0];
  if (quote === undefined || !quoted.has(quote)) {
    return replace(value);
  }

  return quote + replace(value.slice(1, -1)) + quote;
}

function rewriteCss(css: string, replace: AssetResolver): string {
  return css.replace(
    cssTokens,
    (token: string, opening: string | undefined, value: string, closing: string) =>
      opening === undefined ? token : opening + mapAttributeValue(value, replace) + closing,
  );
}

function rewriteLiteralScript(script: string, replace: AssetResolver): string {
  return script.replace(scriptTokens, (token) => {
    if (token.startsWith('/')) {
      return token;
    }

    return mapAttributeValue(token, replace);
  });
}

function rewriteSourceSet(list: string, replace: AssetResolver): string {
  return list.replace(/\S+/gu, (part) => {
    const uri = part.replace(/,+$/u, '');

    return replace(uri) + part.slice(uri.length);
  });
}

function rewriteAttribute(name: string, token: string, replace: AssetResolver): string {
  const field = name.toLowerCase();
  if (urlAttributes.has(field)) {
    return mapAttributeValue(token, replace);
  }
  if (field === 'style') {
    return mapAttributeValue(token, (css) => rewriteCss(css, replace));
  }
  if (field === 'srcset') {
    return mapAttributeValue(token, (list) => rewriteSourceSet(list, replace));
  }

  return token;
}

function rewriteTag(tag: string, replace: AssetResolver): string {
  return tag.replace(
    attributes,
    (_token: string, space: string, name: string, equals: string, value: string) =>
      space + name + equals + rewriteAttribute(name, value, replace),
  );
}

export function rewriteCopyMarkup(markup: string, replace: AssetResolver): string {
  return markup.replace(
    tokens,
    (
      token: string,
      opening: string,
      rawTag: string | undefined,
      content: string,
      closing: string,
    ) => {
      if (rawTag !== undefined) {
        const newContent =
          rawTag.toLowerCase() === 'style'
            ? rewriteCss(content, replace)
            : rewriteLiteralScript(content, replace);

        return rewriteTag(opening, replace) + newContent + closing;
      }

      return token.startsWith('<!--') ? token : rewriteTag(token, replace);
    },
  );
}

export function rewriteCopyText(text: string, replace: AssetResolver): string {
  return text.replace(/\S+/gu, (part) => {
    const match = standalonePath.exec(part);
    if (!match) {
      return part;
    }

    const [, opening = '', uri = '', closing = ''] = match;

    return opening + replace(uri) + closing;
  });
}
