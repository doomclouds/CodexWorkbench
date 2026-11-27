import { useEffect, useEffectEvent } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { DocumentNoteSource, DocumentObjectProps } from './contracts.js';

interface NotePoint {
  readonly x: number;
  readonly y: number;
}

interface AnnotationOptions {
  readonly active?: boolean;
  readonly editing: boolean;
  readonly interactive: boolean;
  readonly focused: boolean;
  readonly onAnnotate: DocumentObjectProps['onAnnotate'];
  readonly readSelection: () => DocumentNoteSource | undefined;
  readonly noteForBlock: (id: string, requested?: NotePoint) => DocumentNoteSource | undefined;
}

function annotationBlock(target: EventTarget | null) {
  if (target instanceof Element) {
    return target.closest<HTMLElement>('[data-document-annotation-target]')?.dataset
      .documentReadBlock;
  }
}

export function plainDocumentInput(event: KeyboardEvent | MouseEvent): boolean {
  return ![event.altKey, event.ctrlKey, event.metaKey, event.shiftKey].some(Boolean);
}

export function useDocumentAnnotations({
  active,
  editing,
  interactive,
  focused,
  onAnnotate,
  readSelection,
  noteForBlock,
}: AnnotationOptions) {
  const enabled = active === true && !editing && Boolean(onAnnotate);
  const annotateSelection = useEffectEvent(() => {
    const selection = interactive && readSelection();
    if (selection) {
      onAnnotate?.(selection);
    }
  });

  useEffect(() => {
    if (enabled) {
      annotateSelection();
    }
  }, [enabled]);

  function send(
    event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>,
    point?: NotePoint,
  ) {
    const id = annotationBlock(event.target);
    const note = id && noteForBlock(id, point);
    if (!note) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    onAnnotate?.(note);

    return true;
  }

  function handleAnnotationClick(event: MouseEvent<HTMLDivElement>) {
    if (!enabled || event.button !== 0 || event.defaultPrevented) {
      return;
    }

    if (plainDocumentInput(event)) {
      send(event, { x: event.clientX, y: event.clientY });
    }
  }

  function handleAnnotationKey(event: KeyboardEvent<HTMLDivElement>) {
    const activates = event.key === 'Enter' || event.key === ' ';
    const ignored = event.nativeEvent.isComposing || event.repeat || event.defaultPrevented;
    if (!enabled || !activates || ignored) {
      return false;
    }

    return plainDocumentInput(event) && send(event);
  }

  return {
    enabled,
    allowReadBody: interactive || enabled,
    useNativeSurface: focused || enabled,
    handleAnnotationClick,
    handleAnnotationKey,
  };
}
