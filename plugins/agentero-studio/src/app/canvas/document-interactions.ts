import { useEffect, useEffectEvent, type RefObject } from 'react';
import { isEscapeActive, registerEscapeLayer } from '../shared/escape.js';
import type { Point } from './canvas-model.js';
import type useDocumentAnnotations from './useDocumentAnnotations.js';

export function isPlainDocumentMouse(event: MouseEvent | React.MouseEvent): boolean {
  const hasModifiers = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
  const pointerType = 'pointerType' in event ? event.pointerType : undefined;
  const isMouse = !pointerType || pointerType === 'mouse';

  return event.button === 0 && isMouse && !hasModifiers;
}

export function isInsideDocumentClientBox(node: HTMLElement, { x, y }: Point): boolean {
  const rect = node.getBoundingClientRect();
  const scaleX = rect.width / node.offsetWidth;
  const scaleY = rect.height / node.offsetHeight;
  const left = rect.left + node.clientLeft * scaleX;
  const top = rect.top + node.clientTop * scaleY;
  const outsideColumns = x < left || x >= left + node.clientWidth * scaleX;
  const outsideRows = y < top || y >= top + node.clientHeight * scaleY;

  return !(outsideColumns || outsideRows);
}

interface RegionEventsOptions {
  expanded: boolean;
  focusHost: HTMLElement | null;
  interactive: boolean;
  canEdit: boolean;
  locked: boolean;
  annotationActive: boolean;
  annotatingRead: boolean;
  editing: boolean;
  composing: boolean;
  leaving: boolean;
  comparing: boolean;
  exportMenu: boolean;
  shell: RefObject<HTMLDivElement | null>;
  focusShell: RefObject<HTMLElement | null>;
  scroll: RefObject<HTMLDivElement | null>;
  annotations: Pick<ReturnType<typeof useDocumentAnnotations>, 'annotateBlock' | 'selectAll'>;
  closeExport(): void;
  closeComparison(): void;
  closeEditor(): void;
  requestBack(): void;
  requestEdit(blockId?: string): void;
  onAnnotationModeChange?: (active: boolean) => void;
  onInteract(active: boolean): void;
  onMoveStart?: (event: React.PointerEvent) => void;
}

function readerShortcut(event: React.KeyboardEvent, ...keys: string[]) {
  const modified = event.ctrlKey || event.metaKey || event.altKey;

  return !modified && !event.nativeEvent.isComposing && keys.includes(event.key);
}

function isCanvasNavigationKey(event: React.KeyboardEvent): boolean {
  if (event.code === 'Space' || event.key === 'Escape') {
    return true;
  }

  const zoom = (event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key);
  const view = event.shiftKey && ['Digit0', 'Digit1', 'Digit2'].includes(event.code);

  return zoom || view;
}

export function useDocumentRegionEvents({
  expanded,
  focusHost,
  interactive,
  canEdit,
  locked,
  annotationActive,
  annotatingRead,
  editing,
  composing,
  leaving,
  comparing,
  exportMenu,
  shell,
  focusShell,
  scroll,
  annotations,
  closeExport,
  closeComparison,
  closeEditor,
  requestBack,
  requestEdit,
  onAnnotationModeChange,
  onInteract,
  onMoveStart,
}: RegionEventsOptions) {
  function activeShell() {
    return expanded ? focusShell.current : shell.current;
  }

  function leaveEditor() {
    closeEditor();
    if (!expanded) {
      onInteract(false);
    }
  }

  const escapeRegion = useEffectEvent((target: EventTarget | null) => {
    if (target instanceof Node && !activeShell()?.contains(target)) {
      return false;
    }
    if (composing) {
      return;
    }

    if (exportMenu) {
      closeExport();

      return;
    }
    if (comparing) {
      closeComparison();

      return;
    }
    if (annotationActive) {
      if (onAnnotationModeChange) {
        onAnnotationModeChange(false);

        return;
      }

      return false;
    }
    if (editing) {
      leaveEditor();

      return;
    }
    if (expanded) {
      requestBack();

      return;
    }
    if (interactive) {
      onInteract(false);

      return;
    }

    return false;
  });

  useEffect(() => {
    const root = expanded ? focusShell.current : shell.current;
    if (root) {
      return registerEscapeLayer(root, (target) => escapeRegion(target), 30);
    }
  }, [expanded, focusHost, focusShell, shell]);

  function handleEscapeCapture(event: React.KeyboardEvent) {
    const composingNow = composing || event.nativeEvent.isComposing || event.key === 'Process';
    const overlayOpen = comparing || exportMenu;
    if (event.key !== 'Escape' || event.repeat || composingNow) {
      return;
    }
    if (!editing || overlayOpen) {
      return;
    }

    const root = activeShell();
    const menuSelector = '.bn-suggestion-menu,[role="menu"],[role="listbox"],[role="dialog"]';
    if (!root || [...root.querySelectorAll<HTMLElement>(menuSelector)].some(isEscapeActive)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    leaveEditor();
  }

  function handleMovement(event: React.PointerEvent, target: HTMLElement) {
    const readingOrEditing = expanded || editing || annotationActive;
    const movable = canEdit && !locked && !readingOrEditing;
    if (!movable || !onMoveStart || !isPlainDocumentMouse(event)) {
      return false;
    }

    const overHeading =
      target.closest('.studio-document-heading') &&
      !target.closest('button,a[href],input,textarea,select,[role="menu"]');
    const blank =
      target === shell.current ||
      target.matches(
        '.studio-document-body,.studio-document-scroll,.studio-document-content,.studio-doc-prose',
      );

    if (!overHeading && !blank) {
      return false;
    }

    const reader = scroll.current;
    if (
      blank &&
      target === reader &&
      !isInsideDocumentClientBox(reader, { x: event.clientX, y: event.clientY })
    ) {
      return true;
    }

    event.preventDefault();
    event.stopPropagation();
    onMoveStart(event);
    if (blank && interactive) {
      reader?.focus({ preventScroll: true });
    }

    return true;
  }

  function handlePointerDown(event: React.PointerEvent) {
    const target = event.target as HTMLElement;
    if (handleMovement(event, target)) {
      return;
    }
    if (event.button !== 0 || (!interactive && !target.closest('button,input'))) {
      return;
    }

    const readerActive = interactive && !editing && !annotationActive;
    const readingArea =
      target.closest('.studio-document-scroll') &&
      !target.closest(
        'button,a[href],input:not([disabled]),textarea,select,[contenteditable="true"]',
      );

    if (readerActive && readingArea) {
      scroll.current?.focus({ preventScroll: true });
    }

    event.stopPropagation();
  }

  function handleAnnotationKey(event: React.KeyboardEvent) {
    if (!annotatingRead || event.repeat || !readerShortcut(event, 'Enter', ' ')) {
      return false;
    }
    if (!annotations.annotateBlock(event.target)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    return true;
  }

  function handleSelectAllKey(event: React.KeyboardEvent, target: HTMLElement) {
    const readerActive = !editing && interactive && !event.nativeEvent.isComposing;
    const selectAll =
      !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a';
    const textArea = target.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
    );
    const readingArea = target.closest('.studio-document-scroll') && !textArea;
    if (!readerActive || !selectAll || !readingArea) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    annotations.selectAll();

    return true;
  }

  function handleEditKey(event: React.KeyboardEvent, target: HTMLElement) {
    const blocked = editing || leaving || annotationActive;
    if (blocked || !canEdit || !readerShortcut(event, 'Enter', 'F2')) {
      return false;
    }
    if (
      !target.closest('.studio-document-scroll') ||
      target.closest('a,button,input,textarea,select')
    ) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    requestEdit();

    return true;
  }

  function handleFindKey(event: React.KeyboardEvent) {
    const composingNow = event.nativeEvent.isComposing || event.key === 'Process';
    const find = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
    if (!expanded || composingNow || !find) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    focusShell.current?.querySelector<HTMLInputElement>('[aria-label="文档内查找"]')?.focus();

    return true;
  }

  function handleDocumentKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (
      handleAnnotationKey(event) ||
      handleSelectAllKey(event, target) ||
      handleEditKey(event, target)
    ) {
      return;
    }
    if (handleFindKey(event)) {
      return;
    }

    const readerOwnsKey = interactive && !(editing && canEdit);
    if (
      readerOwnsKey &&
      target.closest('.studio-document-scroll') &&
      !isCanvasNavigationKey(event)
    ) {
      event.stopPropagation();
    }
  }

  function handleClickCapture(event: React.MouseEvent) {
    if (annotationActive && (event.target as HTMLElement).closest('.studio-document-scroll')) {
      event.preventDefault();
    }
  }

  function handleDoubleClick(event: React.MouseEvent) {
    const target = event.target as HTMLElement;
    const blocked = editing || annotationActive || leaving;
    const readingArea =
      target.closest('.studio-document-scroll') &&
      !target.closest('button,input,textarea,select,a');

    if (blocked || !readingArea) {
      return;
    }

    event.stopPropagation();
    if (canEdit) {
      requestEdit(target.closest<HTMLElement>('[data-document-block-id]')?.dataset.documentBlockId);
    }
  }

  return {
    onKeyDownCapture: handleEscapeCapture,
    onPointerDown: handlePointerDown,
    onClickCapture: handleClickCapture,
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleDocumentKeyDown,
  };
}
