import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { components as blockNoteComponents } from '@blocknote/ariakit';
import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  mergeCSSClasses,
} from '@blocknote/core';
import { zh } from '@blocknote/core/locales';
import {
  BlockNoteViewRaw,
  ComponentsContext,
  type ComponentProps as BlockNoteComponentProps,
  useCreateBlockNote,
} from '@blocknote/react';
import '@blocknote/ariakit/style.css';
import './document-formatting-toolbar.css';
import type { DocumentBlock, DocumentContent, DocumentObjectProps } from './contracts.js';
import { applyEditorChange } from './document-replay.js';
import {
  emptyDocument,
  flattenBlocks,
  isPrivateDocumentAssetSource,
  safeDocumentImage,
  safeResolvedDocumentImage,
  sameDocument,
} from './model.js';

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3, 4, 5, 6] }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    table: defaultBlockSpecs.table,
    image: defaultBlockSpecs.image,
    divider: defaultBlockSpecs.divider,
  },
});

const destructiveMenuLabels = new Set<string>([
  zh.drag_handle.delete_menuitem,
  zh.table_handle.delete_row_menuitem,
  zh.table_handle.delete_column_menuitem,
]);
const destructiveButtonLabels = new Set<string>([
  zh.link_toolbar.delete.tooltip,
  ...Object.values(zh.formatting_toolbar.file_delete.tooltip),
]);

function DocumentMenuItem(props: BlockNoteComponentProps['Generic']['Menu']['Item']) {
  const danger = typeof props.children === 'string' && destructiveMenuLabels.has(props.children);
  const className = mergeCSSClasses(props.className ?? '', danger ? 'studio-document-delete' : '');

  return <blockNoteComponents.Generic.Menu.Item {...props} className={className} />;
}

function DocumentToolbarButton(props: BlockNoteComponentProps['Generic']['Toolbar']['Button']) {
  const danger = props.label !== undefined && destructiveButtonLabels.has(props.label);
  const className = mergeCSSClasses(props.className ?? '', danger ? 'studio-document-delete' : '');

  return <blockNoteComponents.Generic.Toolbar.Button {...props} className={className} />;
}

const documentComponents = {
  ...blockNoteComponents,
  Generic: {
    ...blockNoteComponents.Generic,
    Menu: { ...blockNoteComponents.Generic.Menu, Item: DocumentMenuItem },
  },
  FormattingToolbar: { ...blockNoteComponents.FormattingToolbar, Button: DocumentToolbarButton },
  LinkToolbar: { ...blockNoteComponents.LinkToolbar, Button: DocumentToolbarButton },
};

type DocumentEditorInstance = typeof schema.BlockNoteEditor;
type EditableBlock = typeof schema.PartialBlock;
type EditorBlock = typeof schema.Block;

export interface DocumentEditorProps {
  readonly value: DocumentContent;
  readonly editable: boolean;
  readonly theme: 'light' | 'dark';
  readonly focusBlockId?: string;
  readonly onChange: (value: DocumentContent) => void;
  readonly onCompositionChange: (active: boolean) => void;
  readonly resolveImage?: DocumentObjectProps['resolveImage'];
  readonly uploadImage?: DocumentObjectProps['uploadImage'];
}

const textControls =
  'button,a[href],input,textarea,select,[contenteditable],[role="button"],[role="menu"],[role="listbox"]';

function editableBlocks(value: DocumentContent): EditableBlock[] {
  const blocks = value.blocks.length ? value.blocks : emptyDocument.blocks;

  return blocks as unknown as EditableBlock[];
}

function portableBlock(block: EditorBlock): DocumentBlock {
  const stored = block as unknown as DocumentBlock;
  const children = block.children.length ? block.children.map(portableBlock) : undefined;
  if (block.type !== 'table') {
    return children ? { ...stored, children } : stored;
  }

  const { headerRows, headerCols, columnWidths, ...content } = block.content;
  const tableContent = {
    ...content,
    columnWidths: columnWidths.map((width) => width ?? null),
    ...(headerRows === undefined ? {} : { headerRows }),
    ...(headerCols === undefined ? {} : { headerCols }),
  } as unknown as DocumentBlock['content'];

  return { ...stored, content: tableContent, ...(children ? { children } : {}) };
}

function editorValue(editor: DocumentEditorInstance): DocumentContent {
  return { schemaVersion: 1, blocks: editor.document.map(portableBlock) };
}

function insidePaper(element: HTMLElement, event: PointerEvent) {
  const rect = element.getBoundingClientRect();
  const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
  const localX = (event.clientX - rect.left) / scaleX - element.clientLeft;
  const localY = (event.clientY - rect.top) / scaleY - element.clientTop;
  const withinColumns = localX >= 0 && localX < element.clientWidth;
  const withinRows = localY >= 0 && localY < element.clientHeight;

  return withinColumns && withinRows;
}

function plainMouse(event: PointerEvent) {
  const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  const mouse = !event.pointerType || event.pointerType === 'mouse';

  return event.button === 0 && mouse && !modified;
}

function useEditorPaper(
  root: React.RefObject<HTMLDivElement | null>,
  editor: DocumentEditorInstance,
  editable: boolean,
  composing: boolean,
) {
  useEffect(() => {
    const paper = root.current?.closest<HTMLElement>('.studio-ui-scroll-region');
    if (!paper || !editable || composing) {
      return;
    }

    const surface = paper;
    function focusBlank(event: PointerEvent) {
      if (event.defaultPrevented || !plainMouse(event) || !insidePaper(surface, event)) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element) || target.closest(textControls)) {
        return;
      }

      const last = flattenBlocks(editorValue(editor).blocks).at(-1);
      if (!last) {
        return;
      }

      const trailingBlock = last.type === 'image' || last.type === 'divider';
      const block = trailingBlock
        ? editor.insertBlocks([{ type: 'paragraph' }], last.id, 'after')[0]
        : last;

      if (block) {
        event.preventDefault();
        event.stopPropagation();
        editor.setTextCursorPosition(block.id, 'end');
        editor.focus();
      }
    }

    surface.addEventListener('pointerdown', focusBlank);

    return () => surface.removeEventListener('pointerdown', focusBlank);
  }, [root, editor, editable, composing]);
}

function useEditorDraft(
  editor: DocumentEditorInstance,
  { value, editable, focusBlockId, onChange, onCompositionChange }: DocumentEditorProps,
) {
  const applied = useRef(value);
  const initiallyFocused = useRef<DocumentEditorInstance | undefined>(undefined);
  const [initialEditorValue] = useState(() => editorValue(editor));
  const editorSnapshot = useRef(initialEditorValue);
  const emitted = useRef(new WeakSet<DocumentContent>());
  const pendingFocus = useRef(focusBlockId);
  const ownChange = useRef(false);
  const composition = useRef<DocumentContent | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const callbacks = useRef({ onChange, onCompositionChange });

  useLayoutEffect(() => {
    callbacks.current = { onChange, onCompositionChange };
  }, [onChange, onCompositionChange]);

  useLayoutEffect(() => {
    if (!editable || initiallyFocused.current === editor) {
      return;
    }

    initiallyFocused.current = editor;
    const target = pendingFocus.current;
    pendingFocus.current = undefined;
    if (target && editor.getBlock(target)) {
      editor.setTextCursorPosition(target, 'end');
    }
    editor.focus();
  }, [editable, editor]);

  useEffect(
    () => () => {
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (composition.current || applied.current === value) {
      return;
    }

    const fromEditor = emitted.current.has(value);
    const sameValue = sameDocument(applied.current, value);
    const current = sameDocument(editorValue(editor), value);
    applied.current = value;
    if (fromEditor || sameValue || current) {
      return;
    }

    ownChange.current = true;
    try {
      editor.replaceBlocks(editor.document, editableBlocks(value));
      editorSnapshot.current = editorValue(editor);
    } finally {
      ownChange.current = false;
    }
  }, [composing, editor, value]);

  function emit(next: DocumentContent) {
    const previous = editorSnapshot.current;
    editorSnapshot.current = next;
    if (sameDocument(previous, next)) {
      return;
    }

    const draft = applyEditorChange(previous, next, applied.current);
    emitted.current.add(draft);
    applied.current = draft;
    callbacks.current.onChange(draft);
  }

  function handleChange() {
    if (editable && !ownChange.current && !composition.current) {
      emit(editorValue(editor));
    }
  }

  function handleCompositionStart() {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }

    composition.current = editorValue(editor);
    setComposing(true);
    callbacks.current.onCompositionChange(true);
  }

  function handleCompositionEnd() {
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const start = composition.current;
      composition.current = undefined;
      setComposing(false);
      if (start) {
        const next = editorValue(editor);
        if (!sameDocument(start, next)) {
          emit(next);
        }
      }
      callbacks.current.onCompositionChange(false);
    });
  }

  return { composing, handleChange, handleCompositionStart, handleCompositionEnd };
}

export default function DocumentEditor(props: DocumentEditorProps) {
  const { value, editable, theme, uploadImage, resolveImage } = props;
  const root = useRef<HTMLDivElement>(null);
  const [initial] = useState(value);
  const assets = useRef({ uploadImage, resolveImage });
  const requests = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    assets.current = { uploadImage, resolveImage };
  }, [uploadImage, resolveImage]);
  useEffect(() => {
    const pending = requests.current;

    return () => {
      for (const request of pending) {
        request.abort();
      }
      pending.clear();
    };
  }, []);

  const editor = useCreateBlockNote({
    schema,
    dictionary: zh,
    initialContent: editableBlocks(initial),
    uploadFile: uploadImage
      ? (file) =>
          assets.current.uploadImage?.(file) ??
          Promise.reject(new Error('当前没有上传文档图片的权限。'))
      : undefined,
    async resolveFileUrl(source) {
      const needsAuthority = assets.current.resolveImage && isPrivateDocumentAssetSource(source);
      const direct = needsAuthority ? undefined : safeDocumentImage(source);
      if (direct) {
        return direct;
      }

      const controller = new AbortController();
      requests.current.add(controller);
      try {
        const url = await assets.current.resolveImage?.(source, controller.signal);

        return !controller.signal.aborted ? (safeResolvedDocumentImage(url) ?? '') : '';
      } finally {
        requests.current.delete(controller);
      }
    },
  });
  const draft = useEditorDraft(editor, props);
  useEditorPaper(root, editor, editable, draft.composing);

  return (
    <div
      ref={root}
      data-document-editor=""
      onCompositionStartCapture={draft.handleCompositionStart}
      onCompositionEndCapture={draft.handleCompositionEnd}
    >
      <ComponentsContext.Provider value={documentComponents}>
        <BlockNoteViewRaw
          className="bn-ariakit"
          editor={editor}
          editable={editable}
          theme={theme}
          comments={false}
          onChange={draft.handleChange}
        />
      </ComponentsContext.Provider>
    </div>
  );
}
