import { defaultRules, MarkdownPlugin, type MdRules } from '@platejs/markdown';
import { NodeApi, type SlateEditor } from 'platejs';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkWikiLinks, splitNoteMarkdown } from './markdown-model';

const rules: MdRules = {}; const linkRule: string = 'a';
rules[linkRule] = { serialize(node, options) {
  if (typeof node.url === 'string' && node.url.startsWith('workbench-wiki:')) {
    try {
      const target = decodeURIComponent(node.url.slice('workbench-wiki:'.length)); const label = NodeApi.string(node);
      if (!/[\[\]\n|]/.test(target) && !/[\[\]\n|]/.test(label)) return { type: 'workbenchWiki', target, label };
    } catch { /* Keep an invalid extension link as an ordinary Markdown link. */ }
  }
  return defaultRules.a!.serialize!(node, options);
} };
export const noteMarkdownPlugin = MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm, remarkMath, remarkWikiLinks], rules } });
export function deserializeNote(editor: SlateEditor, markdown: string) {
  const { body } = splitNoteMarkdown(markdown);
  return editor.getApi(MarkdownPlugin).markdown.deserialize(body || '\n');
}
export function serializeNote(editor: SlateEditor, prefix: string): string {
  return prefix + editor.getApi(MarkdownPlugin).markdown.serialize();
}
