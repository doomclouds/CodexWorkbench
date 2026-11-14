export interface RichTextSegment { type: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string; href?: string }
export interface RichTextLine { type: 'paragraph' | 'bullet' | 'ordered'; marker?: string; segments: RichTextSegment[] }

export function safeHttpLink(href: string | undefined): string | undefined {
  try { const url = new URL(href ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

/** A small, non-nesting text format. HTML and unsupported syntax remain plain text. */
export function parseInlineText(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\[\]\n]+)\]\(([^\s)]+)\)/g;
  let previous = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > previous) segments.push({ type: 'text', text: text.slice(previous, match.index) });
    if (match[1] !== undefined) segments.push({ type: 'bold', text: match[1] });
    else if (match[2] !== undefined) segments.push({ type: 'italic', text: match[2] });
    else if (match[3] !== undefined) segments.push({ type: 'code', text: match[3] });
    else {
      const href = safeHttpLink(match[5]);
      segments.push(href ? { type: 'link', text: match[4]!, href } : { type: 'text', text: match[0] });
    }
    previous = match.index! + match[0].length;
  }
  if (previous < text.length || !segments.length) segments.push({ type: 'text', text: text.slice(previous) });
  return segments;
}

export function parseRichText(text: string): RichTextLine[] {
  return text.split(/\r?\n/).map(line => {
    const list = /^(- |(\d+)\. )(.*)$/.exec(line);
    return list ? { type: list[2] ? 'ordered' : 'bullet', marker: list[2] ? `${list[2]}.` : '•', segments: parseInlineText(list[3]!) } : { type: 'paragraph', segments: parseInlineText(line) };
  });
}
