import { useEffect, useRef } from 'react';
import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs, type PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/ariakit';
import { zh } from '@blocknote/core/locales';
import '@blocknote/ariakit/style.css';
import type { DocumentBlock, DocumentContent } from '../../contracts/document.js';
import { defaultDocument } from '../../contracts/document.js';
import { newClientId } from '../shared/client-id.js';

const { paragraph, bulletListItem, numberedListItem, checkListItem, quote, codeBlock, table, image, divider } = defaultBlockSpecs;
const heading = createHeadingBlockSpec({ levels: [1, 2, 3, 4, 5, 6] });
const schema = BlockNoteSchema.create({ blockSpecs: { paragraph, heading, bulletListItem, numberedListItem, checkListItem, quote, codeBlock, table, image, divider } });
export interface DocumentTextSelection { quote: string; blockIds: string[] }
interface Props { value: DocumentContent; editable: boolean; theme: 'light' | 'dark'; onChange(value: DocumentContent): void; onSelection(selection: DocumentTextSelection | null): void; onCompositionChange?(active: boolean): void; uploadFile(file: File): Promise<string>; resolveFileUrl(source: string): Promise<string> }
export default function DocumentEditor({ value, editable, theme, onChange, onSelection, onCompositionChange, uploadFile, resolveFileUrl }: Props) {
  const initial = useRef(value);
  const empty = useRef(defaultDocument(newClientId('block')));
  const files = useRef({ uploadFile, resolveFileUrl }); files.current = { uploadFile, resolveFileUrl };
  const editor = useCreateBlockNote({ schema, dictionary: zh, initialContent: (initial.current.blocks.length ? initial.current.blocks : empty.current.blocks) as unknown as PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[], uploadFile: file => files.current.uploadFile(file), resolveFileUrl: source => files.current.resolveFileUrl(source) });
  const ownChange = useRef(false);
  const composing = useRef(false), compositionFrame = useRef<number | null>(null), compositionStart = useRef('');
  const callbacks = useRef({ onChange, onCompositionChange }); callbacks.current = { onChange, onCompositionChange };
  useEffect(() => () => { if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current); }, []);
  useEffect(() => {
    if (composing.current) return;
    const incoming = value.blocks.length ? value.blocks : empty.current.blocks;
    if (JSON.stringify(editor.document) === JSON.stringify(incoming)) return;
    ownChange.current = true;
    try { editor.replaceBlocks(editor.document, incoming as unknown as PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[]); }
    finally { ownChange.current = false; }
  }, [editor, value]);
  return <div className="studio-document-editor" onCompositionStartCapture={() => {
    if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current);
    compositionFrame.current = null; composing.current = true; compositionStart.current = JSON.stringify(editor.document); callbacks.current.onCompositionChange?.(true);
  }} onCompositionEndCapture={() => {
    // The final input transaction can follow compositionend; keep the editor through that frame.
    compositionFrame.current = requestAnimationFrame(() => {
      compositionFrame.current = null; composing.current = false;
      if (JSON.stringify(editor.document) !== compositionStart.current) callbacks.current.onChange({ schemaVersion: 1, blocks: editor.document as unknown as DocumentBlock[] });
      callbacks.current.onCompositionChange?.(false);
    });
  }}><BlockNoteView editor={editor} editable={editable} theme={theme} comments={false} attributionTooltip={false} onChange={() => { if (!ownChange.current) onChange({ schemaVersion: 1, blocks: editor.document as unknown as DocumentBlock[] }); }} onSelectionChange={() => {
    const quote = editor.getSelectedText().trim();
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    onSelection(quote ? { quote, blockIds: blocks.map(block => block.id) } : null);
  }} /></div>;
}
