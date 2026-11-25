export interface RichTextSegment {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link';
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}
export interface RichTextLine {
  type: 'paragraph' | 'bullet' | 'ordered';
  marker?: string;
  indent?: number;
  segments: RichTextSegment[];
}

export function safeHttpLink(href: string | undefined): string | undefined {
  try {
    const url = new URL(href ?? '');

    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
}

type InlineStyle = { bold?: boolean; italic?: boolean; href?: string };

function segmentType(style: InlineStyle, code: boolean): RichTextSegment['type'] {
  if (style.href) {
    return 'link';
  }
  if (code) {
    return 'code';
  }
  if (style.bold) {
    return 'bold';
  }

  return style.italic ? 'italic' : 'text';
}

function sameSegmentFormat(previous: RichTextSegment, next: RichTextSegment): boolean {
  return (
    previous.type === next.type &&
    previous.href === next.href &&
    previous.bold === next.bold &&
    previous.italic === next.italic &&
    previous.code === next.code
  );
}

function readLink(text: string, index: number) {
  let labelEnd = index + 1;
  while (labelEnd < text.length) {
    if (text[labelEnd] === '\\') {
      labelEnd += 2;
      continue;
    }
    if (text[labelEnd] === ']') {
      break;
    }

    labelEnd++;
  }

  if (text[labelEnd + 1] !== '(') {
    return;
  }

  const end = text.indexOf(')', labelEnd + 2);
  if (end > labelEnd + 2) {
    return { labelEnd, end, href: safeHttpLink(text.slice(labelEnd + 2, end)) };
  }
}

function isEscaped(text: string, index: number): boolean {
  let escapes = 0;
  for (let at = index - 1; at >= 0 && text[at] === '\\'; at--) {
    escapes++;
  }

  return escapes % 2 !== 0;
}

function findClosingEmphasis(text: string, start: number, opening: string): number | undefined {
  const runs = opening[0] === '_' ? /_+/g : /\*+/g;
  runs.lastIndex = start;
  let closing: RegExpExecArray | null;
  while ((closing = runs.exec(text))) {
    if (text.slice(start, closing.index).includes('\n')) {
      return;
    }
    if (closing[0].length !== opening.length || isEscaped(text, closing.index)) {
      continue;
    }
    if (closing.index > start) {
      return closing.index;
    }
  }
}

export function parseInlineText(text: string, inherited: InlineStyle = {}): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const push = (value: string, code = false) => {
    const type = segmentType(inherited, code);
    const next: RichTextSegment = {
      type,
      text: value,
      ...(inherited.href ? { href: inherited.href } : {}),
      ...(inherited.bold && type !== 'bold' ? { bold: true } : {}),
      ...(inherited.italic && type !== 'italic' ? { italic: true } : {}),
      ...(code && type !== 'code' ? { code: true } : {}),
    };
    const previous = segments.at(-1);
    if (previous && sameSegmentFormat(previous, next)) {
      previous.text += value;
    } else {
      segments.push(next);
    }
  };

  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    const following = text.charAt(index + 1);
    if (character === '\\' && /[\\*_`[\]]/.test(following)) {
      push(following);
      index += 2;
      continue;
    }
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1 && !text.slice(index, end).includes('\n')) {
        push(text.slice(index + 1, end), true);
        index = end + 1;
        continue;
      }
    }

    const link = text[index] === '[' ? readLink(text, index) : undefined;
    if (link) {
      if (link.href) {
        segments.push(
          ...parseInlineText(text.slice(index + 1, link.labelEnd), {
            ...inherited,
            href: link.href,
          }),
        );
      } else {
        push(text.slice(index, link.end + 1));
      }

      index = link.end + 1;
      continue;
    }
    if (text[index] === '*' || text[index] === '_') {
      const opening = /^(?:\*+|_+)/.exec(text.slice(index))![0];
      const length = opening.length;
      const end = length <= 3 ? findClosingEmphasis(text, index + length, opening) : undefined;
      if (end !== undefined) {
        segments.push(
          ...parseInlineText(text.slice(index + length, end), {
            ...inherited,
            ...(length >= 2 ? { bold: true } : {}),
            ...(length === 1 || length === 3 ? { italic: true } : {}),
          }),
        );
        index = end + length;
        continue;
      }

      push(opening);
      index += length;
      continue;
    }

    push(character);
    index++;
  }

  if (!segments.length) {
    push('');
  }

  return segments;
}

export function parseRichText(text: string): RichTextLine[] {
  return text.split(/\r?\n/).map((line) => {
    const list = /^(\s*)(- |(\d+)\. )(.*)$/.exec(line);
    const indent = list?.[1]?.length ?? 0;

    return list
      ? {
          type: list[3] ? 'ordered' : 'bullet',
          marker: list[3] ? `${list[3]}.` : '•',
          ...(indent ? { indent: Math.floor(indent / 2) } : {}),
          segments: parseInlineText(list[4]!),
        }
      : { type: 'paragraph', segments: parseInlineText(line) };
  });
}

export function richTextFirstLine(text: string): string {
  const content = text.split(/\r?\n/, 1)[0] ?? '';
  return (parseRichText(content)[0]?.segments ?? []).map((segment) => segment.text).join('');
}
