import { BlockquoteRules, BoldRules, CodeRules, HeadingRules, HorizontalRuleRules, ItalicRules, StrikethroughRules } from '@platejs/basic-nodes';
import { BlockquotePlugin, BoldPlugin, CodePlugin, H1Plugin, H2Plugin, H3Plugin, H4Plugin, H5Plugin, H6Plugin, HorizontalRulePlugin, ItalicPlugin, StrikethroughPlugin } from '@platejs/basic-nodes/react';
import { CodeBlockRules } from '@platejs/code-block';
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from '@platejs/code-block/react';
import { FindReplacePlugin } from '@platejs/find-replace';
import { IndentPlugin } from '@platejs/indent/react';
import { LinkPlugin } from '@platejs/link/react';
import { BulletedListRules, OrderedListRules, TaskListRules } from '@platejs/list';
import { ListPlugin } from '@platejs/list/react';
import { MathRules } from '@platejs/math';
import { EquationPlugin, InlineEquationPlugin } from '@platejs/math/react';
import { ImagePlugin } from '@platejs/media/react';
import { TableCellHeaderPlugin, TableCellPlugin, TablePlugin, TableRowPlugin } from '@platejs/table/react';
import { common, createLowlight } from 'lowlight';
import { KEYS, TrailingBlockPlugin, type AnyPluginConfig } from 'platejs';
import { ParagraphPlugin } from 'platejs/react';
import { noteMarkdownPlugin } from './markdown-plugin';
import { NoteCodeBlock, NoteCodeLine, NoteCodeSyntax, NoteEquation, NoteImage, NoteInlineCode, NoteInlineEquation, NoteLinkElement, NoteListWrapper, NoteParagraph, NoteQuote, NoteRule, NoteSearchHighlight, NoteTable, NoteTableCell, NoteTableHeader, NoteTableRow, noteHeadings } from './NoteElements';
export { deserializeNote, serializeNote } from './markdown-plugin';

export const noteFindPlugin = FindReplacePlugin.configure({ node: { component: NoteSearchHighlight } });
const lowlight = createLowlight(common);
const listTargets = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock];
const headings = [H1Plugin, H2Plugin, H3Plugin, H4Plugin, H5Plugin, H6Plugin].map((plugin, index) => plugin.configure({
  inputRules: [HeadingRules.markdown()], node: { component: noteHeadings[index] }, rules: { break: { empty: 'reset' } },
}));

export const notePlugins = [
  ParagraphPlugin.withComponent(NoteParagraph), ...headings,
  BlockquotePlugin.configure({ node: { component: NoteQuote }, inputRules: [BlockquoteRules.markdown()] }),
  HorizontalRulePlugin.configure({ node: { component: NoteRule }, inputRules: [HorizontalRuleRules.markdown({ variant: '-' }), HorizontalRuleRules.markdown({ variant: '_' })] }),
  BoldPlugin.configure({ inputRules: [BoldRules.markdown({ variant: '*' }), BoldRules.markdown({ variant: '_' })] }),
  ItalicPlugin.configure({ inputRules: [ItalicRules.markdown({ variant: '*' }), ItalicRules.markdown({ variant: '_' })] }),
  StrikethroughPlugin.configure({ inputRules: [StrikethroughRules.markdown()] }),
  CodePlugin.configure({ node: { component: NoteInlineCode }, inputRules: [CodeRules.markdown()] }),
  IndentPlugin.configure({ inject: { targetPlugins: listTargets }, options: { offset: 1.5, unit: 'rem' } }),
  ListPlugin.configure({ inject: { targetPlugins: listTargets }, render: { belowNodes: NoteListWrapper }, inputRules: [
    BulletedListRules.markdown({ variant: '-' }), BulletedListRules.markdown({ variant: '*' }),
    OrderedListRules.markdown({ variant: '.' }), OrderedListRules.markdown({ variant: ')' }),
    TaskListRules.markdown({ checked: false }), TaskListRules.markdown({ checked: true }),
  ] }),
  CodeBlockPlugin.configure({ node: { component: NoteCodeBlock }, options: { lowlight }, inputRules: [CodeBlockRules.markdown({ on: 'match' })] }),
  CodeLinePlugin.withComponent(NoteCodeLine), CodeSyntaxPlugin.withComponent(NoteCodeSyntax),
  TablePlugin.withComponent(NoteTable), TableRowPlugin.withComponent(NoteTableRow), TableCellPlugin.withComponent(NoteTableCell), TableCellHeaderPlugin.withComponent(NoteTableHeader),
  EquationPlugin.configure({ node: { component: NoteEquation }, inputRules: [MathRules.markdown({ on: 'break', variant: '$$' })] }),
  InlineEquationPlugin.withComponent(NoteInlineEquation),
  LinkPlugin.configure({ node: { component: NoteLinkElement }, options: { allowedSchemes: ['http', 'https', 'mailto', 'workbench-note', 'workbench-paper', 'workbench-wiki'] } }),
  ImagePlugin.withComponent(NoteImage), noteFindPlugin,
  TrailingBlockPlugin.configure({ options: { type: KEYS.p } }),
  noteMarkdownPlugin,
] as AnyPluginConfig[];
