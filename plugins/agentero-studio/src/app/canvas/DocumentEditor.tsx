import { useEffect, useLayoutEffect, useRef } from 'react';
import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs, type PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/ariakit';
import { zh } from '@blocknote/core/locales';
import '@blocknote/ariakit/style.css';
import type { DocumentBlock, DocumentContent } from '../../contracts/document.js';
import { defaultDocument, documentBlockText, flattenDocumentBlocks } from '../../contracts/document.js';
import { newClientId } from '../shared/client-id.js';

const { paragraph, bulletListItem, numberedListItem, checkListItem, quote, codeBlock, table, image, divider } = defaultBlockSpecs;
const heading = createHeadingBlockSpec({ levels: [1, 2, 3, 4, 5, 6] });
const schema = BlockNoteSchema.create({ blockSpecs: { paragraph, heading, bulletListItem, numberedListItem, checkListItem, quote, codeBlock, table, image, divider } });
export interface DocumentTextSelection { quote: string; blockIds: string[] }
interface Props { value: DocumentContent; editable: boolean; theme: 'light' | 'dark'; initialFocusBlockId?: string; highlightedIds?: string[]; find?: string; onChange(value: DocumentContent): void; onSelection(selection: DocumentTextSelection | null): void; onCompositionChange?(active: boolean): void; uploadFile(file: File): Promise<string>; resolveFileUrl(source: string): Promise<string> }
export default function DocumentEditor({ value, editable, theme, initialFocusBlockId, highlightedIds = [], find = '', onChange, onSelection, onCompositionChange, uploadFile, resolveFileUrl }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const initial = useRef(value);
  const appliedValue = useRef(value);
  const empty = useRef(defaultDocument(newClientId('block')));
  const files = useRef({ uploadFile, resolveFileUrl }); files.current = { uploadFile, resolveFileUrl };
  const editor = useCreateBlockNote({ schema, dictionary: zh, initialContent: (initial.current.blocks.length ? initial.current.blocks : empty.current.blocks) as unknown as PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[], uploadFile: file => files.current.uploadFile(file), resolveFileUrl: source => files.current.resolveFileUrl(source) });
  const ownChange = useRef(false);
  const emittedValues = useRef(new WeakSet<DocumentContent>());
  const focusBlock = useRef(initialFocusBlockId);
  const composing = useRef(false), compositionFrame = useRef<number | null>(null), compositionStart = useRef('');
  const callbacks = useRef({ onChange, onCompositionChange }); callbacks.current = { onChange, onCompositionChange };
  const emitChange = () => {
    const next: DocumentContent = { schemaVersion: 1, blocks: editor.document as unknown as DocumentBlock[] };
    emittedValues.current.add(next); callbacks.current.onChange(next);
  };
  useLayoutEffect(() => {
    if (!editable) return;
    const blockId = focusBlock.current; focusBlock.current = undefined;
    if (blockId && editor.getBlock(blockId)) editor.setTextCursorPosition(blockId, 'end');
    editor.focus();
  }, [editor, editable]);
  useEffect(() => {
    if (!editable) return;
    const scroll = container.current?.closest<HTMLElement>('.studio-document-scroll');
    if (!scroll) return;
    const focusBlank = (event: PointerEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.pointerType && event.pointerType !== 'mouse' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || composing.current) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('button,a[href],input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="menu"],[role="listbox"],[role="dialog"]')) return;
      // Native scrollbar gutters are outside the client box, even under CSS zoom.
      const rect = scroll.getBoundingClientRect(), scaleX = rect.width / scroll.offsetWidth, scaleY = rect.height / scroll.offsetHeight;
      const left = rect.left + scroll.clientLeft * scaleX, top = rect.top + scroll.clientTop * scaleY;
      if (event.clientX < left || event.clientX >= left + scroll.clientWidth * scaleX || event.clientY < top || event.clientY >= top + scroll.clientHeight * scaleY) return;
      const last = flattenDocumentBlocks(editor.document as unknown as DocumentBlock[]).at(-1);
      if (!last) return;
      event.preventDefault(); event.stopPropagation();
      const block = last.type === 'image' || last.type === 'divider' ? editor.insertBlocks([{ type: 'paragraph' }], last.id, 'after')[0] : last;
      editor.setTextCursorPosition(block.id, 'end'); editor.focus();
    };
    scroll.addEventListener('pointerdown', focusBlank);
    return () => scroll.removeEventListener('pointerdown', focusBlank);
  }, [editor, editable]);
  useEffect(() => () => { if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current); }, []);
  useEffect(() => {
    if (composing.current || value === appliedValue.current) return;
    // A parent render can acknowledge an earlier keystroke after the editor has advanced.
    if (emittedValues.current.has(value)) { appliedValue.current = value; return; }
    // BlockNote adds defaults to initialContent; that normalization is not an external edit.
    if (JSON.stringify(value) === JSON.stringify(appliedValue.current)) { appliedValue.current = value; return; }
    const incoming = value.blocks.length ? value.blocks : empty.current.blocks;
    if (JSON.stringify(editor.document) === JSON.stringify(incoming)) { appliedValue.current = value; return; }
    ownChange.current = true;
    try { editor.replaceBlocks(editor.document, incoming as unknown as PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[]); appliedValue.current = value; }
    finally { ownChange.current = false; }
  }, [editor, value]);
  useLayoutEffect(() => {
    const matched = new Set(find.trim() ? flattenDocumentBlocks(value.blocks).filter(block => documentBlockText(block).toLocaleLowerCase().includes(find.trim().toLocaleLowerCase())).map(block => block.id) : []);
    for (const node of container.current?.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]') ?? []) {
      node.classList.toggle('is-document-anchored', highlightedIds.includes(node.dataset.id!));
      node.classList.toggle('is-document-find-match', matched.has(node.dataset.id!));
    }
  }, [editor, value, find, highlightedIds.join(',')]);
  return <div ref={container} className="studio-document-editor" onCompositionStartCapture={() => {
    if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current);
    compositionFrame.current = null; composing.current = true; compositionStart.current = JSON.stringify(editor.document); callbacks.current.onCompositionChange?.(true);
  }} onCompositionEndCapture={() => {
    // The final input transaction can follow compositionend; keep the editor through that frame.
    compositionFrame.current = requestAnimationFrame(() => {
      compositionFrame.current = null; composing.current = false;
      if (JSON.stringify(editor.document) !== compositionStart.current) emitChange();
      callbacks.current.onCompositionChange?.(false);
    });
  }}><BlockNoteView editor={editor} editable={editable} theme={theme} comments={false} attributionTooltip={false} onChange={() => { if (!ownChange.current) emitChange(); }} onSelectionChange={() => {
    const quote = editor.getSelectedText().trim();
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    onSelection(quote ? { quote, blockIds: blocks.map(block => block.id) } : null);
  }} /></div>;
}
