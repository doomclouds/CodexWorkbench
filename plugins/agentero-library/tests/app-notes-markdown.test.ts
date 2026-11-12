import { describe, expect, it } from 'vitest';
import { BaseBasicBlocksPlugin, BaseBasicMarksPlugin } from '@platejs/basic-nodes';
import { BaseCodeBlockPlugin } from '@platejs/code-block';
import { BaseIndentPlugin } from '@platejs/indent';
import { BaseLinkPlugin } from '@platejs/link';
import { BaseListPlugin } from '@platejs/list';
import { BaseTablePlugin } from '@platejs/table';
import { createSlateEditor, createSlatePlugin, NodeApi } from 'platejs';
import { deserializeNote, noteMarkdownPlugin, serializeNote } from '../src/app/notes/markdown-plugin';
import { countLiteralMatches, resolveNoteLink, splitNoteMarkdown } from '../src/app/notes/markdown-model';

const richFixture = `---\ntitle: 阅读记录\ntags: [agent]\n---\n# 方法比较\n\n**加粗** *斜体* ~~删除~~ \`code\`\n\n- 普通列表\n- [x] 已读论文\n\n1. 第一项\n2. 第二项\n\n> 引用证据\n\n| 方法 | 结果 |\n| --- | --- |\n| ReAct | 通过 |\n\n行内公式 $E=mc^2$。\n\n$$\n\\int_0^1 x dx = \\frac12\n$$\n\n\`\`\`python\nprint("hello")\n\`\`\`\n\n[[notes/方法.md|方法笔记]] 与 [[papers/agent/ReAct|ReAct]]。\n\n![实验结果](assets/plot.png)\n`;

// The parser uses the same Markdown plugin as the browser editor. Basic schema
// nodes keep this test independent of React and the math package's CSS import.
function parser(markdown: string) {
  return createSlateEditor({ plugins: [BaseBasicBlocksPlugin, BaseBasicMarksPlugin, BaseCodeBlockPlugin, BaseIndentPlugin, BaseListPlugin, BaseLinkPlugin, BaseTablePlugin,
    createSlatePlugin({ key: 'equation', node: { isElement: true, isVoid: true } }),
    createSlatePlugin({ key: 'inline_equation', node: { isElement: true, isInline: true, isVoid: true } }),
    createSlatePlugin({ key: 'img', node: { isElement: true, isVoid: true } }), noteMarkdownPlugin], value: instance => deserializeNote(instance, markdown) });
}

describe('notes Markdown editor contract', () => {
  it('round-trips all observed DSH editor nodes and preserves metadata and wiki syntax', () => {
    const editor = parser(richFixture);
    const output = serializeNote(editor, splitNoteMarkdown(richFixture).prefix);
    expect(output.startsWith('---\ntitle: 阅读记录\ntags: [agent]\n---\n')).toBe(true);
    expect(output).toContain('# 方法比较'); expect(output).toContain('**加粗**'); expect(output).toContain('~~删除~~');
    expect(output).toContain('[x] 已读论文'); expect(output).toContain('ReAct'); expect(output).toContain('$E=mc^2$');
    expect(output).toContain('\\int_0^1 x dx'); expect(output).toContain('```python');
    expect(output).toContain('[[notes/方法.md|方法笔记]]'); expect(output).toContain('[[papers/agent/ReAct|ReAct]]');
    expect(output).toContain('![实验结果](assets/plot.png)');
    const types = new Set([...NodeApi.descendants(editor)].map(([node]) => 'type' in node ? node.type : 'text'));
    for (const type of ['h1', 'table', 'code_block', 'inline_equation', 'equation', 'img']) expect(types.has(type)).toBe(true);
  });
  it('keeps a CRLF metadata header byte-for-byte', () => {
    const parts = splitNoteMarkdown('\uFEFF---\r\ntitle: hello\r\n...\r\n\r\n# Body');
    expect(parts.prefix).toBe('\uFEFF---\r\ntitle: hello\r\n...\r\n'); expect(parts.body).toBe('\r\n# Body');
  });
  it('does not interpret wiki-looking code as links', () => {
    const editor = parser('`[[not a link]]`\n\n```text\n[[also literal]]\n[code](workbench-wiki:literal)\n```');
    const output = serializeNote(editor, ''); expect(output).toContain('`[[not a link]]`'); expect(output).toContain('[[also literal]]'); expect(output).toContain('[code](workbench-wiki:literal)');
  });
});

describe('safe note navigation', () => {
  it('resolves native move-rewritten PDF citations across the Vault namespace without escaping it', () => {
    const source = 'notes/论文/source--0123456789ab/笔记.md';
    expect(resolveNoteLink('../../../papers/source/source.pdf#page=7&mark=mark-2', source)).toEqual({ kind: 'paper', path: 'papers/source', page: 7, markId: 'mark-2' });
    expect(resolveNoteLink('papers/source/source.pdf#page=12', source)).toEqual({ kind: 'paper', path: 'papers/source', page: 12 });
    expect(resolveNoteLink('papers/source/source.pdf#page=12&mark=_crop-1', source)).toEqual({ kind: 'paper', path: 'papers/source', page: 12, markId: '_crop-1' });
    expect(resolveNoteLink('../../../../papers/source/source.pdf#page=7', source)).toBeNull();
  });
  it('resolves notes, paper references, and normal relative links in the selected vault', () => {
    expect(resolveNoteLink('workbench-wiki:notes%2F方法', 'notes/current.md')).toEqual({ kind: 'note', path: 'notes/方法.md' });
    expect(resolveNoteLink('workbench-wiki:papers%2FReAct', 'notes/current.md')).toEqual({ kind: 'paper', path: 'papers/ReAct' });
    expect(resolveNoteLink('../methods.md', 'notes/topic/read.md')).toEqual({ kind: 'note', path: 'notes/methods.md' });
    expect(resolveNoteLink('https://example.com', 'notes/read.md')).toEqual({ kind: 'external', url: 'https://example.com' });
  });
  it('refuses arbitrary file access and executable schemes', () => {
    for (const target of ['../../secret.md', 'file:///c:/secret.md', 'javascript:alert(1)', '//evil.test/notes.md', '/notes/a.md', 'C:\\secret.md', 'papers/demo/source/PAPER.md']) expect(resolveNoteLink(target, 'notes/read.md')).toBeNull();
  });
  it('restores aliases without changing ordinary Markdown links', () => {
    expect(serializeNote(parser('[[notes/method.md|方法]] [web](https://example.com)'), '')).toContain('[[notes/method.md|方法]] [web](https://example.com)');
    expect(countLiteralMatches('foo Foo FOO', 'foo')).toBe(3); expect(countLiteralMatches('aaa', '')).toBe(0);
  });
  it('opens PDF citations at a validated physical page and optional mark', () => {
    expect(resolveNoteLink('workbench-paper:papers%2F架构#page=7&mark=highlight-123', 'notes/read.md')).toEqual({ kind: 'paper', path: 'papers/架构', page: 7, markId: 'highlight-123' });
    expect(resolveNoteLink('papers/demo#page=12', 'notes/read.md')).toEqual({ kind: 'paper', path: 'papers/demo', page: 12 });
    for (const target of ['papers/demo#page=0', 'papers/demo#page=-1', 'papers/demo#page=1.5', 'papers/demo#page=2&page=3', 'papers/demo#page=7&mark=../bad', 'papers/demo#page=1&unknown=x', 'notes/read.md#page=7', 'workbench-paper:notes%2Fread#page=1']) expect(resolveNoteLink(target, 'notes/read.md')).toBeNull();
  });
});
