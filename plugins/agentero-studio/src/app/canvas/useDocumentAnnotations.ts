import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Anchor, CommentPin as CommentPlacement } from '../../contracts/studio.js';
import {
  documentBlockText,
  type DocumentBlock,
  type DocumentContent,
} from '../../contracts/document.js';
import { clamp, type Point } from './canvas-model.js';
import type { DocumentTextSelection } from './DocumentEditor.js';
import type useDocumentDraft from './useDocumentDraft.js';

interface AnnotationOptions {
  artifactId: string;
  elementId: string;
  interactive: boolean;
  expanded: boolean;
  composing: boolean;
  active: boolean;
  canAnnotate: boolean;
  annotatingRead: boolean;
  document: DocumentContent;
  blocks: DocumentBlock[];
  scroll: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  session: Pick<
    ReturnType<typeof useDocumentDraft>,
    'draft' | 'baseline' | 'mounted' | 'dirty' | 'save' | 'reportError'
  >;
  boardPoint?: (clientX: number, clientY: number) => Point;
  onAnnotate(anchor: Anchor, version: number, point?: Point): void;
}

function annotationPlacement(
  scroll: HTMLElement | null,
  expanded: boolean,
  blockId: string,
  point?: Point,
  boardPoint?: AnnotationOptions['boardPoint'],
): { pin?: CommentPlacement; point?: Point } {
  if (expanded && blockId) {
    const bounds = scroll
      ?.querySelector(`[data-document-block-id="${CSS.escape(blockId)}"]`)
      ?.getBoundingClientRect();

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { point };
    }

    const position = point ?? { x: bounds.right, y: bounds.top + Math.min(12, bounds.height) };
    const x = clamp((position.x - bounds.left) / bounds.width, 0, 1);
    const y = clamp((position.y - bounds.top) / bounds.height, 0, 1);

    return {
      pin: { coordinateSpace: 'document', x, y },
      point: { x: bounds.left + x * bounds.width, y: bounds.top + y * bounds.height },
    };
  }
  if (point && boardPoint) {
    return { pin: { coordinateSpace: 'board', ...boardPoint(point.x, point.y) }, point };
  }

  return { point };
}

export default function useDocumentAnnotations({
  artifactId,
  elementId,
  interactive,
  expanded,
  composing,
  active,
  canAnnotate,
  annotatingRead,
  document,
  blocks,
  scroll,
  content,
  session,
  boardPoint,
  onAnnotate,
}: AnnotationOptions) {
  const { draft, baseline, mounted, dirty, save, reportError } = session;
  const [selection, setSelection] = useState<DocumentTextSelection | null>(null);
  const canKeepSelection = interactive || expanded;
  const [selectionContext, setSelectionContext] = useState({
    annotating: active,
    reading: canKeepSelection,
  });
  const annotationHover = useRef<{ point: Point; block: HTMLElement | null } | null>(null);
  const annotationRequest = useRef(0);
  const selectedText = useRef<DocumentTextSelection | null>(null);
  const selectedDocument = useRef('');
  const createAnnotation = useRef(onAnnotate);

  useLayoutEffect(() => {
    createAnnotation.current = onAnnotate;
  }, [onAnnotate]);
  useLayoutEffect(() => {
    annotationRequest.current++;
  }, [artifactId, elementId, interactive, active, canAnnotate, expanded]);
  useLayoutEffect(() => {
    if (!active) {
      selectedText.current = null;
    }
  }, [active]);
  useLayoutEffect(() => {
    if (!interactive && !expanded) {
      selectedText.current = null;
    }
  }, [interactive, expanded]);

  if (selectionContext.annotating !== active || selectionContext.reading !== canKeepSelection) {
    const exitedAnnotation = selectionContext.annotating && !active;
    const exitedReader = selectionContext.reading && !canKeepSelection;
    setSelectionContext({ annotating: active, reading: canKeepSelection });
    if (exitedAnnotation || exitedReader) {
      setSelection(null);
    }
  }

  function handleSelectionChange(value: DocumentTextSelection | null, preserveOnBlur = true) {
    const focused = window.document.activeElement;
    const focusOutsideDocument =
      focused instanceof Element && !focused.closest('.studio-document-content');

    if (!value && preserveOnBlur && focusOutsideDocument) {
      return;
    }

    annotationRequest.current++;
    selectedText.current = value;
    selectedDocument.current = JSON.stringify(draft.current.document);
    setSelection(value);
  }

  function readingSelection() {
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) {
      return null;
    }

    return scroll.current?.contains(selected.anchorNode) &&
      scroll.current.contains(selected.focusNode)
      ? selected
      : null;
  }

  function readTextSelection(selected = readingSelection()): DocumentTextSelection | null {
    if (!selected || !scroll.current) {
      return null;
    }

    const range = selected.getRangeAt(0);
    const quote = selected.toString().trim();
    const blockIds = [...scroll.current.querySelectorAll<HTMLElement>('[data-document-block-id]')]
      .filter((node) => range.intersectsNode(node))
      .map((node) => node.dataset.documentBlockId!);

    return quote && blockIds.length ? { quote, blockIds } : null;
  }

  const annotationBlock = useCallback(
    (target: EventTarget | null) => {
      const block =
        target instanceof Element
          ? target.closest<HTMLElement>('[data-document-annotation-target]')
          : null;

      return block && scroll.current?.contains(block) ? block : null;
    },
    [scroll],
  );
  const previewAnnotation = useCallback(
    (point: { x: number; y: number } | null, target: EventTarget | null = null) => {
      const previous = annotationHover.current?.block;
      const block = annotationBlock(target);
      if (previous !== block) {
        previous?.removeAttribute('data-document-annotation-hover');
        block?.setAttribute('data-document-annotation-hover', '');
      }

      annotationHover.current = point ? { point, block } : null;
    },
    [annotationBlock],
  );
  useLayoutEffect(
    () => () => previewAnnotation(null),
    [annotatingRead, expanded, artifactId, elementId, document, previewAnnotation],
  );
  const handleAnnotationPointer = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') {
      previewAnnotation(null);

      return;
    }

    previewAnnotation({ x: event.clientX, y: event.clientY }, event.target);
  };

  const handleAnnotationScroll = () => {
    const point = annotationHover.current?.point;
    if (point) {
      previewAnnotation(point, window.document.elementFromPoint(point.x, point.y));
    }
  };

  function pickAnnotationBlock(target: EventTarget | null): DocumentTextSelection | null {
    const id = annotationBlock(target)?.dataset.documentBlockId;
    const block = id && blocks.find((item) => item.id === id);

    return block ? { blockIds: [block.id], quote: documentBlockText(block).trim() } : null;
  }

  async function saveAnnotation(selected: DocumentTextSelection, requestedPoint?: Point) {
    if (!canAnnotate || composing) {
      return;
    }

    const { pin, point } = annotationPlacement(
      scroll.current,
      expanded,
      selected.blockIds[0],
      requestedPoint,
      boardPoint,
    );
    const request = ++annotationRequest.current;
    const expected = JSON.stringify(draft.current);
    try {
      if (dirty && !(await save())) {
        return;
      }
      if (!mounted.current || request !== annotationRequest.current) {
        return;
      }

      if (expected !== JSON.stringify(draft.current)) {
        reportError('选中文字已变化，请重新选择后添加备注。');

        return;
      }

      const source = baseline.current;
      const rect = scroll.current?.getBoundingClientRect();
      const fallback = rect ? { x: rect.right - 12, y: rect.top + 70 } : undefined;
      createAnnotation.current(
        {
          coordinateSpace: 'document',
          elementIds: [elementId],
          blockIds: selected.blockIds,
          sourceVersion: source.version,
          quote: selected.quote,
          ...(pin ? { pin } : {}),
        },
        source.version,
        point ?? fallback,
      );
      selectedText.current = null;
      if (!active) {
        setSelection(null);
      }
    } catch (cause) {
      if (request === annotationRequest.current) {
        reportError(cause);
      }
    }
  }

  function annotate(selected: DocumentTextSelection, point?: Point) {
    saveAnnotation(selected, point).catch(reportError);
  }

  function handleReadingSelection(event: React.MouseEvent) {
    if (event.button !== 0 || !(canKeepSelection || annotatingRead)) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-feedback-pin]')) {
      return;
    }

    const selected = readingSelection();
    let picked = readTextSelection(selected);
    if (!selected && annotatingRead) {
      picked = pickAnnotationBlock(event.target);
    }

    handleSelectionChange(picked, false);
    if (picked && annotatingRead) {
      annotate(picked, { x: event.clientX, y: event.clientY });
    }
  }

  function annotateBlock(target: EventTarget) {
    const picked = pickAnnotationBlock(target);
    if (!picked) {
      return false;
    }

    handleSelectionChange(picked, false);
    annotate(picked);

    return true;
  }

  function selectAll() {
    const selected = window.getSelection();
    const prose = content.current?.querySelector('.studio-doc-prose');
    if (selected && prose) {
      const range = window.document.createRange();
      range.selectNodeContents(prose);
      selected.removeAllRanges();
      if (range.toString().trim() || prose.querySelector('img,table,hr,input[type=checkbox]')) {
        selected.addRange(range);
      }
    }

    const picked = readTextSelection();
    handleSelectionChange(picked, false);
    if (picked && active && canAnnotate) {
      annotate(picked);
    }
  }

  const annotateSelectedText = useEffectEvent(() => {
    const picked = selectedText.current;
    const matchesCurrentDraft = selectedDocument.current === JSON.stringify(draft.current.document);
    if (canKeepSelection && picked && matchesCurrentDraft) {
      annotate(picked);
    }
  });
  useEffect(() => {
    if (active) {
      annotateSelectedText();
    }
  }, [active]);

  return {
    selection,
    handleSelectionChange,
    handleReadingSelection,
    handleAnnotationPointer,
    handleAnnotationScroll,
    clearPreview: () => previewAnnotation(null),
    selectAll,
    annotateBlock,
  };
}
