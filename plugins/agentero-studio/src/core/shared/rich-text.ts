export interface RichTextSegment { type: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string; href?: string; bold?: boolean; italic?: boolean; code?: boolean }
export interface RichTextLine { type: 'paragraph' | 'bullet' | 'ordered'; marker?: string; indent?: number; segments: RichTextSegment[] }

export function safeHttpLink(href: string | undefined): string | undefined {
  try { const url = new URL(href ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

/** Parse the supported inline marks without interpreting HTML or executable links. */
export function parseInlineText(text: string, inherited: { bold?: boolean; italic?: boolean; href?: string } = {}): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const push = (value: string, code = false) => {
    const type: RichTextSegment['type'] = inherited.href ? 'link' : code ? 'code' : inherited.bold ? 'bold' : inherited.italic ? 'italic' : 'text';
    const next: RichTextSegment = { type, text: value, ...(inherited.href ? { href: inherited.href } : {}), ...(inherited.bold && type !== 'bold' ? { bold: true } : {}), ...(inherited.italic && type !== 'italic' ? { italic: true } : {}), ...(code && type !== 'code' ? { code: true } : {}) };
    const previous = segments.at(-1);
    if (previous && previous.type === next.type && previous.href === next.href && previous.bold === next.bold && previous.italic === next.italic && previous.code === next.code) previous.text += value;
    else segments.push(next);
  };
  let index = 0;
  while (index < text.length) {
    if(text[index]==='\\' && index+1<text.length && /[\\*_`\[\]]/.test(text[index+1])){push(text[index+1]);index+=2;continue;}
    if (text[index] === '`') { const end = text.indexOf('`', index + 1); if (end > index + 1 && !text.slice(index,end).includes('\n')) { push(text.slice(index+1,end),true); index=end+1; continue; } }
    if (text[index] === '[') {
      let close=index+1;
      while(close<text.length){if(text[close]==='\\'){close+=2;continue;}if(text[close]===']')break;close++;}
      if(text[close+1]==='('){const end=text.indexOf(')',close+2);if(end>close+2){const raw=text.slice(index,end+1),href=safeHttpLink(text.slice(close+2,end));if(href)segments.push(...parseInlineText(text.slice(index+1,close),{...inherited,href}));else push(raw);index=end+1;continue;}}
    }
    if (text[index] === '*' || text[index] === '_') {
      const opening = /^(?:\*+|_+)/.exec(text.slice(index))![0], length=opening.length;
      if(length<=3){const runs=text[index]==='_'?/_+/g:/\*+/g;runs.lastIndex=index+length;let closing:RegExpExecArray|null;while((closing=runs.exec(text))){if(text.slice(index+length,closing.index).includes('\n'))break;let escapes=0;for(let at=closing.index-1;at>=0&&text[at]==='\\';at--)escapes++;if(escapes%2||closing[0].length!==length)continue;if(closing.index>index+length){segments.push(...parseInlineText(text.slice(index+length,closing.index),{...inherited,...length>=2?{bold:true}:{},...length===1||length===3?{italic:true}:{}}));index=closing.index+length;break;}}if(closing&&index===closing.index+length)continue;}
      push(opening);index+=length;continue;
    }
    push(text[index]);index++;
  }
  if(!segments.length)push('');
  return segments;
}

export function parseRichText(text: string): RichTextLine[] {
  return text.split(/\r?\n/).map(line => {
    const list = /^(\s*)(- |(\d+)\. )(.*)$/.exec(line);
    return list ? { type: list[3] ? 'ordered' : 'bullet', marker: list[3] ? `${list[3]}.` : '•', ...(list[1].length ? { indent: Math.floor(list[1].length / 2) } : {}), segments: parseInlineText(list[4]!) } : { type: 'paragraph', segments: parseInlineText(line) };
  });
}
