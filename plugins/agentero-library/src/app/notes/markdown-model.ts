export interface MarkdownParts { prefix: string; body: string }

/** Metadata stays byte-for-byte intact instead of being normalized by the editor. */
export function splitNoteMarkdown(source: string): MarkdownParts {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(source);
  return match ? { prefix: match[0], body: source.slice(match[0].length) } : { prefix: '', body: source };
}

interface MdNode { type: string; value?: string; url?: string; children?: MdNode[]; target?: string; label?: string }
interface RemarkProcessor { data(key: string, value?: unknown): unknown }

/** Extend remark's parsed text nodes; code, links, and images are never rewritten. */
export function remarkWikiLinks(this: RemarkProcessor) {
  const extensions = (this.data('toMarkdownExtensions') || []) as unknown[];
  this.data('toMarkdownExtensions', [...extensions, { handlers: { workbenchWiki: (node: MdNode) => `[[${node.target}${node.label === node.target ? '' : `|${node.label}`}]]` } }]);
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (!node.children || ['link', 'code', 'inlineCode', 'html'].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child]; }
        const result: MdNode[] = []; const pattern = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
        let last = 0; let match: RegExpExecArray | null;
        while ((match = pattern.exec(child.value))) {
          if (match.index > last) result.push({ type: 'text', value: child.value.slice(last, match.index) });
          result.push({ type: 'link', url: `workbench-wiki:${encodeURIComponent(match[1].trim())}`, children: [{ type: 'text', value: match[2]?.trim() || match[1].trim() }] });
          last = pattern.lastIndex;
        }
        if (!last) return [child];
        if (last < child.value.length) result.push({ type: 'text', value: child.value.slice(last) });
        return result;
      });
    };
    visit(tree);
  };
}

export type NoteLink = { kind: 'note'; path: string } | { kind: 'paper'; path: string; page?: number; markId?: string } | { kind: 'external'; url: string } | { kind: 'anchor'; id: string };

export function resolveNoteLink(url: string, notePath: string): NoteLink | null {
  const raw = url.trim();
  if (/^(https?:|mailto:)/i.test(raw)) return { kind: 'external', url: raw };
  if (raw.startsWith('#')) return { kind: 'anchor', id: raw.slice(1) };
  let path = raw; let wiki = false; let page: number | undefined; let markId: string | undefined;
  const protocol = /^(workbench-note|workbench-paper|workbench-wiki):(.+)$/.exec(raw);
  const payload = protocol ? protocol[2] : raw;
  const fragmentAt = payload.indexOf('#');
  if (fragmentAt >= 0) {
    const fragment = new URLSearchParams(payload.slice(fragmentAt + 1));
    const pages = fragment.getAll('page'); const marks = fragment.getAll('mark');
    if ([...fragment.keys()].some(key => key !== 'page' && key !== 'mark') || pages.length !== 1 || !/^[1-9]\d{0,5}$/.test(pages[0]) || marks.length > 1 || (marks.length === 1 && !/^[a-zA-Z0-9_-][a-zA-Z0-9._:-]{0,127}$/.test(marks[0]))) return null;
    page = Number(pages[0]); markId = marks[0];
  }
  try { path = decodeURIComponent(fragmentAt >= 0 ? payload.slice(0, fragmentAt) : payload); wiki = protocol?.[1] === 'workbench-wiki'; } catch { return null; }
  path = path.replaceAll('\\', '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.includes('\0') || path.includes('?') || path.includes('#')) return null;
  const explicitRoot = /^(notes|papers)\//.test(path);
  if (!explicitRoot) {
    path = wiki ? `notes/${path}` : `${notePath.split('/').slice(0, -1).join('/')}/${path}`;
  }
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') { if (parts.length === 0) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  path = parts.join('/');
  if (!/^(notes|papers)\//.test(path)) return null;
  if (protocol?.[1] === 'workbench-paper' || (path.startsWith('papers/') && !path.toLowerCase().endsWith('.md'))) {
    if (!path.startsWith('papers/')) return null;
    let paperPath = path.replace(/\/$/, '');
    // Agentero file_move rewrites a paper reference as a relative PDF link.
    if (protocol?.[1] !== 'workbench-paper' && /\.pdf$/i.test(paperPath)) paperPath = paperPath.split('/').slice(0, -1).join('/');
    if (paperPath === 'papers') return null;
    return { kind: 'paper', path: paperPath, ...(page ? { page } : {}), ...(markId ? { markId } : {}) };
  }
  if (page !== undefined) return null;
  if (!path.toLowerCase().endsWith('.md')) path += '.md';
  if (path.startsWith('papers/') && !path.endsWith('/NOTES.md')) return null;
  return { kind: 'note', path };
}

export function isSafeImageReference(url: string): boolean {
  return !!url && !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(url) && !url.includes('\0');
}

export function countLiteralMatches(text: string, query: string): number {
  if (!query) return 0;
  let count = 0; let cursor = 0; const source = text.toLocaleLowerCase(); const search = query.toLocaleLowerCase();
  while ((cursor = source.indexOf(search, cursor)) !== -1) { count += 1; cursor += search.length; }
  return count;
}
