import type { DocumentBlock, DocumentDraft } from './contracts.js';
import {
  blockText,
  documentCellSpan,
  documentHeadingLevel,
  documentListStart,
  inlineText,
  isPrivateDocumentAssetSource,
  isRecord,
  safeDocumentLink,
  tableRows,
  untitledDocument,
} from './model.js';

type HtmlTable = (block: DocumentBlock) => string;

function markdownText(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replace(/[\\`*_#[\]<>|~!]/gu, '\\$&')
    .replace(/^([ \t]*)([-+=])/gmu, '$1\\$2')
    .replace(/^([ \t]*\d+)([.)])(?=\s)/gmu, '$1\\$2');
}

function backticks(text: string, minimum: number) {
  const longest = (text.match(/`+/gu) ?? []).reduce(
    (maximum, run) => Math.max(maximum, run.length + 1),
    minimum,
  );

  return '`'.repeat(longest);
}

function linkDestination(url: string) {
  return url.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('|', '%7C');
}

function styledText(text: string, styles: Record<string, unknown>) {
  if (styles.code) {
    const fence = backticks(text, 1);

    return fence + ' ' + text.replaceAll('\n', ' ') + ' ' + fence;
  }

  const parts = /^(\s*)(.*?)(\s*)$/su.exec(text);
  const value = parts?.[2];
  if (!value) {
    return text;
  }

  let result = markdownText(value);
  if (styles.bold) {
    result = '**' + result + '**';
  }
  if (styles.italic) {
    result = '*' + result + '*';
  }
  if (styles.strike) {
    result = '~~' + result + '~~';
  }

  return (parts[1] ?? '') + result + (parts[3] ?? '');
}

function inlineMarkdown(value: unknown): string {
  if (typeof value === 'string') {
    return markdownText(value);
  }
  if (Array.isArray(value)) {
    return value.map(inlineMarkdown).join('');
  }
  if (!isRecord(value)) {
    return '';
  }

  if (value.type === 'link') {
    const href = safeDocumentLink(value.href);
    const text = inlineMarkdown(value.content);

    return href && text ? '[' + text + '](' + linkDestination(href) + ')' : text;
  }

  return typeof value.text === 'string'
    ? styledText(value.text, isRecord(value.styles) ? value.styles : {})
    : inlineMarkdown(value.content);
}

function tableMarkdown(block: DocumentBlock, htmlTable: HtmlTable) {
  const rows = tableRows(block.content);
  const columns = rows.reduce((width, row) => Math.max(width, row.length), 0);
  if (!columns) {
    return '';
  }

  const hasSpans = rows.some((row) =>
    row.some((cell) => documentCellSpan(cell, 'colspan') || documentCellSpan(cell, 'rowspan')),
  );
  const headerRows = isRecord(block.content) ? Number(block.content.headerRows) || 0 : 0;
  if (hasSpans || headerRows > 1) {
    return htmlTable(block);
  }

  const rowText = (cells: readonly unknown[]) =>
    '| ' +
    Array.from({ length: columns }, (_, index) =>
      inlineMarkdown(cells[index]).replaceAll('\n', ' '),
    ).join(' | ') +
    ' |';
  const separator = '| ' + Array.from({ length: columns }, () => '---').join(' | ') + ' |';
  const head = headerRows === 1 ? rows[0]! : [];

  return [rowText(head), separator, ...rows.slice(headerRows === 1 ? 1 : 0).map(rowText)].join(
    '\n',
  );
}

function imageMarkdown(block: DocumentBlock) {
  const label = markdownText(blockText(block));
  const source = safeDocumentLink(block.props.url);
  if (source && !isPrivateDocumentAssetSource(source)) {
    return '![' + label + '](' + linkDestination(source) + ')';
  }

  return label ? '图片：' + label : '图片';
}

function blockMarkdown(block: DocumentBlock, htmlTable: HtmlTable) {
  const text = inlineMarkdown(block.content);
  switch (block.type) {
    case 'heading':
      return '#'.repeat(documentHeadingLevel(block)) + ' ' + text.replaceAll('\n', ' ');
    case 'quote':
      return text
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n');
    case 'codeBlock': {
      const code = inlineText(block.content);
      const fence = backticks(code, 3);
      const language = block.props.language;
      const label = typeof language === 'string' && /^[\w+-]+$/u.test(language) ? language : '';

      return fence + label + '\n' + code + '\n' + fence;
    }
    case 'table':
      return tableMarkdown(block, htmlTable);
    case 'image':
      return imageMarkdown(block);
    case 'divider':
      return '---';
    case 'paragraph':
    case 'bulletListItem':
    case 'numberedListItem':
    case 'checkListItem':
      return text.replaceAll('\n', '  \n');
  }
}

function listMarker(block: DocumentBlock, number: number) {
  if (block.type === 'numberedListItem') {
    return number + '. ';
  }
  if (block.type === 'checkListItem') {
    return block.props.checked === true ? '- [x] ' : '- [ ] ';
  }

  return block.type === 'bulletListItem' ? '- ' : '';
}

function indent(text: string, amount: number) {
  const padding = ' '.repeat(amount);

  return text
    .split('\n')
    .map((line) => (line ? padding + line : ''))
    .join('\n');
}

function blocksMarkdown(blocks: readonly DocumentBlock[], htmlTable: HtmlTable): string {
  let result = '';
  let previous: DocumentBlock['type'] | undefined;
  let ordinal = 0;
  for (const block of blocks) {
    const sameKind = block.type === previous;
    ordinal = documentListStart(block) ?? (sameKind ? ordinal + 1 : 1);
    const marker = listMarker(block, ordinal);
    const body = blockMarkdown(block, htmlTable);
    const children = blocksMarkdown(block.children ?? [], htmlTable);
    if (result) {
      result += marker && sameKind ? '\n' : '\n\n';
    }
    if (marker) {
      const indentation = block.type === 'numberedListItem' ? marker.length : 2;
      const continuation = ' '.repeat(indentation);
      result += marker + body.replaceAll('\n', '\n' + continuation);
      result += children ? '\n\n' + indent(children, indentation) : '';
    } else {
      result += [body, children].filter(Boolean).join('\n\n');
    }
    previous = block.type;
  }

  return result;
}

export function documentMarkdown(draft: DocumentDraft, htmlTable: HtmlTable) {
  const title = markdownText(draft.title || untitledDocument).replaceAll('\n', ' ');
  const body = blocksMarkdown(draft.document.blocks, htmlTable).trimEnd();

  return ['# ' + title, body].filter(Boolean).join('\n\n') + '\n';
}
