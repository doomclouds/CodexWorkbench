import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  type PartialBlock,
} from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/ariakit';
import { zh } from '@blocknote/core/locales';
import '@blocknote/ariakit/style.css';
import type { DocumentBlock, DocumentContent } from '../../contracts/document.js';
import {
  defaultDocument,
  documentBlockText,
  flattenDocumentBlocks,
} from '../../contracts/document.js';
import { jsonEqual } from '../../core/shared/safe-merge.js';
import { newClientId } from '../shared/client-id.js';
import { isInsideDocumentClientBox, isPlainDocumentMouse } from './document-interactions.js';

const {
  paragraph,
  bulletListItem,
  numberedListItem,
  checkListItem,
  quote,
  codeBlock,
  table,
  image,
  divider,
} = defaultBlockSpecs;
const heading = createHeadingBlockSpec({ levels: [1, 2, 3, 4, 5, 6] });
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading,
    bulletListItem,
    numberedListItem,
    checkListItem,
    quote,
    codeBlock,
    table,
    image,
    divider,
  },
});

export interface DocumentTextSelection {
  quote: string;
  blockIds: string[];
}
interface Props {
  value: DocumentContent;
  editable: boolean;
  theme: 'light' | 'dark';
  initialFocusBlockId?: string;
  highlightedIds?: string[];
  find?: string;
  onChange(value: DocumentContent): void;
  onSelection(selection: DocumentTextSelection | null): void;
  onCompositionChange?(active: boolean): void;
  uploadFile(file: File): Promise<string>;
  resolveFileUrl(source: string): Promise<string>;
}

export default function DocumentEditor({
  value,
  editable,
  theme,
  initialFocusBlockId,
  highlightedIds = [],
  find = '',
  onChange,
  onSelection,
  onCompositionChange,
  uploadFile,
  resolveFileUrl,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [initial] = useState(value);
  const appliedValue = useRef(value);
  const [empty] = useState(() => defaultDocument(newClientId('block')));
  const files = useRef({ uploadFile, resolveFileUrl });
  useLayoutEffect(() => {
    files.current = { uploadFile, resolveFileUrl };
  }, [uploadFile, resolveFileUrl]);
  const editor = useCreateBlockNote({
    schema,
    dictionary: zh,
    initialContent: (initial.blocks.length
      ? initial.blocks
      : empty.blocks) as unknown as PartialBlock<
      typeof schema.blockSchema,
      typeof schema.inlineContentSchema,
      typeof schema.styleSchema
    >[],
    uploadFile: (file) => files.current.uploadFile(file),
    resolveFileUrl: (source) => files.current.resolveFileUrl(source),
  });
  const ownChange = useRef(false);
  const emittedValues = useRef(new WeakSet<DocumentContent>());
  const focusBlock = useRef(initialFocusBlockId);
  const composing = useRef(false);
  const compositionFrame = useRef<number | null>(null);
  const compositionStart = useRef('');
  const callbacks = useRef({ onChange, onCompositionChange });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onCompositionChange };
  }, [onChange, onCompositionChange]);
  const emitChange = () => {
    const next: DocumentContent = {
      schemaVersion: 1,
      blocks: editor.document as unknown as DocumentBlock[],
    };
    emittedValues.current.add(next);
    callbacks.current.onChange(next);
  };

  useLayoutEffect(() => {
    if (!editable) {
      return;
    }

    const blockId = focusBlock.current;
    focusBlock.current = undefined;
    if (blockId && editor.getBlock(blockId)) {
      editor.setTextCursorPosition(blockId, 'end');
    }

    editor.focus();
  }, [editor, editable]);
  useEffect(() => {
    if (!editable) {
      return;
    }

    const scroll = container.current?.closest<HTMLElement>('.studio-document-scroll');
    if (!scroll) {
      return;
    }

    const focusBlank = (event: PointerEvent) => {
      if (event.defaultPrevented || !isPlainDocumentMouse(event) || composing.current) {
        return;
      }

      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(
          'button,a[href],input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="menu"],[role="listbox"],[role="dialog"]',
        )
      ) {
        return;
      }
      if (!isInsideDocumentClientBox(scroll, { x: event.clientX, y: event.clientY })) {
        return;
      }

      const last = flattenDocumentBlocks(editor.document as unknown as DocumentBlock[]).at(-1);
      if (!last) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const block =
        last.type === 'image' || last.type === 'divider'
          ? editor.insertBlocks([{ type: 'paragraph' }], last.id, 'after')[0]
          : last;
      editor.setTextCursorPosition(block.id, 'end');
      editor.focus();
    };

    scroll.addEventListener('pointerdown', focusBlank);

    return () => scroll.removeEventListener('pointerdown', focusBlank);
  }, [editor, editable]);
  useEffect(
    () => () => {
      if (compositionFrame.current !== null) {
        cancelAnimationFrame(compositionFrame.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (composing.current || value === appliedValue.current) {
      return;
    }

    if (emittedValues.current.has(value)) {
      appliedValue.current = value;

      return;
    }

    if (jsonEqual(value, appliedValue.current)) {
      appliedValue.current = value;

      return;
    }

    const incoming = value.blocks.length ? value.blocks : empty.blocks;
    if (jsonEqual(editor.document, incoming)) {
      appliedValue.current = value;

      return;
    }

    ownChange.current = true;
    try {
      editor.replaceBlocks(
        editor.document,
        incoming as unknown as PartialBlock<
          typeof schema.blockSchema,
          typeof schema.inlineContentSchema,
          typeof schema.styleSchema
        >[],
      );
      appliedValue.current = value;
    } finally {
      ownChange.current = false;
    }
  }, [editor, value, empty]);
  useLayoutEffect(() => {
    const matched = new Set(
      find.trim()
        ? flattenDocumentBlocks(value.blocks)
            .filter((block) =>
              documentBlockText(block)
                .toLocaleLowerCase()
                .includes(find.trim().toLocaleLowerCase()),
            )
            .map((block) => block.id)
        : [],
    );

    for (const node of container.current?.querySelectorAll<HTMLElement>(
      '.bn-block-outer[data-id]',
    ) ?? []) {
      node.classList.toggle('is-document-anchored', highlightedIds.includes(node.dataset.id!));
      node.classList.toggle('is-document-find-match', matched.has(node.dataset.id!));
    }
  }, [editor, value, find, highlightedIds]);
  function handleCompositionStart() {
    if (compositionFrame.current !== null) {
      cancelAnimationFrame(compositionFrame.current);
    }

    compositionFrame.current = null;
    composing.current = true;
    compositionStart.current = JSON.stringify(editor.document);
    callbacks.current.onCompositionChange?.(true);
  }

  function handleCompositionEnd() {
    compositionFrame.current = requestAnimationFrame(() => {
      compositionFrame.current = null;
      composing.current = false;
      if (JSON.stringify(editor.document) !== compositionStart.current) {
        emitChange();
      }

      callbacks.current.onCompositionChange?.(false);
    });
  }

  function handleEditorChange() {
    if (!ownChange.current) {
      emitChange();
    }
  }

  function handleSelectionChange() {
    const quote = editor.getSelectedText().trim();
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    onSelection(quote ? { quote, blockIds: blocks.map((block) => block.id) } : null);
  }

  return (
    <div
      ref={container}
      className="studio-document-editor"
      onCompositionStartCapture={handleCompositionStart}
      onCompositionEndCapture={handleCompositionEnd}
    >
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={theme}
        comments={false}
        attributionTooltip={false}
        onChange={handleEditorChange}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  );
}
