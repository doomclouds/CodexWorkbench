import babelParser from '@babel/eslint-parser';
import { TokenType, tokenize } from '@csstools/css-tokenizer';
import { parse } from 'parse5';

export const markupExtensions = ['css', 'html', 'htm'];

const scriptTypes = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

function stylesheetComments(source) {
  return tokenize({ css: source })
    .filter(([type]) => type === TokenType.Comment)
    .map(([, , start]) => start);
}

function scriptComments(source, type, isHandler = false) {
  const { ast } = babelParser.parseForESLint(source, {
    requireConfigFile: false,
    sourceType: type === 'module' ? 'module' : 'script',
    babelOptions: {
      babelrc: false,
      configFile: false,
      parserOpts: { allowReturnOutsideFunction: isHandler },
    },
  });
  return ast.comments.map((comment) => comment.range[0]);
}

function inlineComments(node, source) {
  const location = node.sourceCodeLocation;
  if (!location?.startTag) return [];

  const offsets = [];
  if (node.tagName === 'style' || node.tagName === 'script') {
    const start = location.startTag.endOffset;
    const body = source.slice(start, location.endTag?.startOffset ?? location.endOffset);
    if (node.tagName === 'style') {
      offsets.push(...stylesheetComments(body).map((offset) => start + offset));
    } else {
      const type = node.attrs.find(({ name }) => name === 'type')?.value.trim().toLowerCase() ?? '';
      if (scriptTypes.has(type)) {
        offsets.push(...scriptComments(body, type).map((offset) => start + offset));
      }
    }
  }
  for (const { name, value } of node.attrs ?? []) {
    const cssComment = name === 'style' && stylesheetComments(value).length;
    const scriptComment = /^on[a-z]+$/u.test(name) && scriptComments(value, '', true).length;
    if (cssComment || scriptComment) {
      offsets.push(location.attrs?.[name]?.startOffset ?? location.startOffset);
    }
  }
  return offsets;
}

function markupComments(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const nodes = [document];
  const offsets = [];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.nodeName === '#comment') {
      offsets.push(node.sourceCodeLocation.startOffset);
    } else {
      offsets.push(...inlineComments(node, source));
    }
    if (node.childNodes) nodes.push(...node.childNodes);
    if (node.content?.childNodes) nodes.push(...node.content.childNodes);
  }
  return offsets.sort((a, b) => a - b);
}

export function findMarkupCommentLines(source, extension) {
  const offsets = extension === '.css' ? stylesheetComments(source) : markupComments(source);
  return offsets.map((offset) => source.slice(0, offset).split(/\r\n|\r|\n/u).length);
}
