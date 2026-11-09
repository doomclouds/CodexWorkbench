export function textMatches(text: string, query: string, limit = 2000): number[] {
  if (!query) return [];
  const haystack = text.toLocaleLowerCase(); const needle = query.toLocaleLowerCase(); const matches: number[] = [];
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) { matches.push(offset); offset += Math.max(1, needle.length); if (matches.length >= limit) break; }
  return matches;
}

/** Non-invasive Range highlights leave PDF.js text nodes intact for selection geometry. */
export function textLayerMatches(layer: Element, query: string): Range[] {
  const segments = [...layer.querySelectorAll<HTMLSpanElement>('span[role="presentation"]')].flatMap(span => span.firstChild instanceof Text ? [{ node: span.firstChild, value: span.firstChild.data }] : []);
  const text = segments.map(segment => segment.value).join(' ');
  return textMatches(text, query).flatMap(index => {
    const range = window.document.createRange(); let cursor = 0; let started = false; let ended = false;
    for (const segment of segments) {
      const end = cursor + segment.value.length;
      if (!started && index < end) { range.setStart(segment.node, Math.max(0, index - cursor)); started = true; }
      if (started && index + query.length <= end) { range.setEnd(segment.node, Math.max(0, index + query.length - cursor)); ended = true; break; }
      cursor = end + 1;
    }
    return started && ended ? [range] : [];
  });
}
