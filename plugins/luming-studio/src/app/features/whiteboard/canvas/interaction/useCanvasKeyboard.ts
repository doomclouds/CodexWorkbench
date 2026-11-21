import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, BoardElement, Operation } from '../../../../../contracts/studio.js';
import { isEscapeActive, registerEscapeLayer } from '../../../../shared/escape.js';
import type { CanvasCommand } from '../controls/CanvasActionsMenu.js';
import { TOOL_OPTIONS, type Tool } from '../controls/CanvasEditingControls.js';
import type { DocumentFocusSurface } from '../objects/document/DocumentRegion.js';
import { moveOperations, type Viewport } from '../scene/canvas-model.js';
import { alignSelection } from '../scene/native-geometry.js';
import { useCommittedRef } from '../useCommittedRef.js';
import { cloneCanvasSelection } from './canvas-clipboard.js';
import type { Gesture } from './canvas-gesture-placement.js';

interface CanvasKeyboardActions {
  remove: () => void;
  duplicate: () => void;
  changeHistory: (direction: 'undo' | 'redo') => void;
  fit: (scope?: 'all' | 'selection' | 'auto') => void;
  handleCanvasCommand: (command: CanvasCommand) => Promise<void>;
  stepZoom: (factor: number) => void;
  chooseTool: (tool: Tool) => Promise<boolean>;
  editSelected: () => boolean;
}

interface ReadingSelection {
  ids: string[];
}

interface CanvasKeyboardOptions {
  viewportElement: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<Viewport>;
  boardRef: RefObject<Board>;
  readingRef: RefObject<ReadingSelection | null>;
  documentFocusSurface: RefObject<DocumentFocusSurface | null>;
  selectionRef: RefObject<string[]>;
  gestureRef: RefObject<Gesture | null>;
  clipboard: RefObject<BoardElement[]>;
  spaceHeld: RefObject<boolean>;
  blocked: boolean;
  singleKeys: boolean;
  canEdit: boolean;
  canAnnotate: boolean;
  actions: CanvasKeyboardActions;
  onEscape: (target: EventTarget | null) => boolean;
  selectIds: (ids: string[]) => void;
  updateGesture: (gesture: null) => void;
  setSpacePan: (active: boolean) => void;
  setAnnotationHoverId: (id: null) => void;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  apply: (operations: Operation[], summary: string) => Promise<Board | null>;
  reportCanvasFailure: (failure: unknown) => void;
}

export function useCanvasKeyboard({
  viewportElement,
  viewportRef,
  boardRef,
  readingRef,
  documentFocusSurface,
  selectionRef,
  gestureRef,
  clipboard,
  spaceHeld,
  blocked,
  singleKeys,
  canEdit,
  canAnnotate,
  actions,
  onEscape,
  selectIds,
  updateGesture,
  setSpacePan,
  setAnnotationHoverId,
  setViewport,
  apply,
  reportCanvasFailure,
}: CanvasKeyboardOptions) {
  const actionsRef = useCommittedRef(actions);
  const shortcutBlockedRef = useCommittedRef(blocked);
  const activateNumericTool = (key: string) => {
    const canvas = viewportElement.current?.closest('.studio-whiteboard');
    if (readingRef.current || !singleKeys || document.visibilityState === 'hidden') {
      return false;
    }
    if (!(canvas instanceof HTMLElement) || !isEscapeActive(canvas) || shortcutBlockedRef.current) {
      return false;
    }
    if (canvas.querySelector('.studio-format-popover,[role="menu"],[role="dialog"]')) {
      return false;
    }

    const choice = key === '9' ? 'annotate' : TOOL_OPTIONS.find((item) => item.key === key)?.tool;
    if (!choice) {
      return false;
    }

    const annotationBlocked = choice === 'annotate' && !canAnnotate;
    const editingToolBlocked = !canEdit && !['select', 'pan', 'annotate'].includes(choice);
    if (annotationBlocked || editingToolBlocked) {
      return false;
    }

    actions.chooseTool(choice).catch(reportCanvasFailure);
    return true;
  };
  const numericTool = useCommittedRef(activateNumericTool);
  const escapeAction = useCommittedRef(onEscape);
  useEffect(
    () =>
      registerEscapeLayer(
        viewportElement.current!.closest<HTMLElement>('.studio-whiteboard')!,
        (target) => escapeAction.current(target),
        0,
      ),
    [escapeAction, viewportElement],
  );
  useEffect(() => {
    function documentOwnsShortcut(target: Element, host: HTMLDivElement) {
      const reading = readingRef.current;
      if (reading?.ids.length !== 1) {
        return false;
      }

      const id = reading.ids[0];
      const document = boardRef.current.elements.find((element) => element.id === id);
      if (document?.type !== 'document') {
        return false;
      }

      return (
        target === host ||
        target.closest<HTMLElement>('.studio-document-focus')?.dataset.documentId === id
      );
    }

    function handleViewportShortcut(
      event: KeyboardEvent,
      commandKey: boolean,
      ownsExpandedDocument: boolean,
    ) {
      const zoomShortcut = commandKey && ['+', '=', '-', '0'].includes(event.key);
      const viewShortcut = event.shiftKey && ['Digit0', 'Digit1', 'Digit2'].includes(event.code);
      if (!zoomShortcut && !viewShortcut) {
        return false;
      }
      if (readingRef.current && !ownsExpandedDocument) {
        return false;
      }

      event.preventDefault();
      if (readingRef.current) {
        return true;
      }

      const actions = actionsRef.current;
      if (zoomShortcut) {
        if (event.key === '0') {
          actions.fit();
        } else {
          actions.stepZoom(event.key === '-' ? 1 / 1.2 : 1.2);
        }
      } else if (event.code === 'Digit0') {
        actions.stepZoom(1 / viewportRef.current.zoom);
      } else {
        actions.fit(event.code === 'Digit1' ? 'all' : 'selection');
      }
      return true;
    }

    function primaryShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const actions = actionsRef.current;
      switch (key) {
        case 'a':
          event.preventDefault();
          selectIds(boardRef.current.elements.map((element) => element.id));
          return true;
        case 'c':
          if (selectionRef.current.length) {
            clipboard.current = cloneCanvasSelection(
              boardRef.current.elements,
              selectionRef.current,
            );
          }
          return true;
        case 'x':
          event.preventDefault();
          actions.handleCanvasCommand('cut').catch(reportCanvasFailure);
          return true;
        case 'l':
          if (event.shiftKey) {
            event.preventDefault();
            actions.handleCanvasCommand('lock').catch(reportCanvasFailure);
            return true;
          }
          return false;
        default:
          return editShortcut(event, key);
      }
    }

    function editShortcut(event: KeyboardEvent, key: string) {
      if (!canEdit) {
        return false;
      }

      const actions = actionsRef.current;
      switch (key) {
        case 'g':
          event.preventDefault();
          actions
            .handleCanvasCommand(event.shiftKey ? 'ungroup' : 'group')
            .catch(reportCanvasFailure);

          return true;
        case '[':
        case ']': {
          event.preventDefault();
          const front = event.shiftKey ? 'front' : 'forward';
          const back = event.shiftKey ? 'back' : 'backward';
          actions.handleCanvasCommand(key === ']' ? front : back).catch(reportCanvasFailure);
          return true;
        }
        case 'd':
          event.preventDefault();
          actions.duplicate();
          return true;
        case 'z':
          event.preventDefault();
          actions.changeHistory(event.shiftKey ? 'redo' : 'undo');
          return true;
        case 'y':
          event.preventDefault();
          actions.changeHistory('redo');
          return true;
        default:
          return false;
      }
    }

    function handleAlignmentShortcut(event: KeyboardEvent, commandKey: boolean) {
      const alignmentKey = event.altKey && !event.shiftKey;
      if (!canEdit || commandKey || !alignmentKey) {
        return false;
      }

      type AlignmentEdge = Parameters<typeof alignSelection>[2];
      const edges: Partial<Record<string, AlignmentEdge>> = {
        a: 'left',
        h: 'hcenter',
        d: 'right',
        w: 'top',
        v: 'vcenter',
        s: 'bottom',
      };
      const edge = edges[event.key.toLowerCase()];
      if (!edge) {
        return false;
      }

      event.preventDefault();
      apply(
        alignSelection(boardRef.current.elements, selectionRef.current, edge),
        '对齐元素',
      ).catch(reportCanvasFailure);

      return true;
    }

    function handleArrowShortcut(event: KeyboardEvent) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const delta = {
        x: Number(event.key === 'ArrowRight') * step - Number(event.key === 'ArrowLeft') * step,
        y: Number(event.key === 'ArrowDown') * step - Number(event.key === 'ArrowUp') * step,
      };

      if (canEdit && selectionRef.current.length) {
        apply(
          moveOperations(boardRef.current.elements, selectionRef.current, delta),
          '移动元素',
        ).catch(reportCanvasFailure);
      } else {
        setViewport((value) => ({
          ...value,
          x: value.x - delta.x * 24,
          y: value.y - delta.y * 24,
        }));
      }
    }

    function handleSelectionShortcut(event: KeyboardEvent, commandKey: boolean) {
      if (commandKey && primaryShortcut(event)) {
        return;
      }
      if (handleAlignmentShortcut(event, commandKey)) {
        return;
      }

      if (canEdit && selectionRef.current.length && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        actionsRef.current.remove();
        return;
      }
      if (!commandKey && event.key.startsWith('Arrow')) {
        handleArrowShortcut(event);
        return;
      }
      const modified = commandKey || event.altKey || event.shiftKey;
      if (modified || event.repeat) {
        return;
      }

      if (['Enter', 'F2'].includes(event.key) && actionsRef.current.editSelected()) {
        event.preventDefault();
        return;
      }
      if (numericTool.current(event.key)) {
        event.preventDefault();
      }
    }

    function handleCanvasNavigation(
      event: KeyboardEvent,
      target: Element,
      commandKey: boolean,
      ownsExpandedDocument: boolean,
    ) {
      if (handleViewportShortcut(event, commandKey, ownsExpandedDocument)) {
        return;
      }
      if (target.closest('[data-document-content],[data-document-controls]')) {
        return;
      }

      const activatesButton = ['Enter', ' '].includes(event.key) || event.code === 'Space';
      if (target.closest('button,a[href]') && activatesButton) {
        return;
      }

      if (event.code === 'Space') {
        setAnnotationHoverId(null);
        spaceHeld.current = true;
        setSpacePan(true);
        event.preventDefault();
        return;
      }
      if (readingRef.current) {
        const documentSearch = commandKey && event.key.toLowerCase() === 'f';
        if (documentFocusSurface.current && documentSearch) {
          event.preventDefault();
          viewportElement.current
            ?.querySelector<HTMLInputElement>('.studio-document-focus [aria-label="文档内查找"]')
            ?.focus();
        } else if (['Delete', 'Backspace'].includes(event.key)) {
          event.preventDefault();
        }
        return;
      }
      handleSelectionShortcut(event, commandKey);
    }

    const keyDown = (event: KeyboardEvent) => {
      const usesComposition = event.isComposing || event.key === 'Process';
      const host = viewportElement.current;
      if (event.defaultPrevented || usesComposition || !host) {
        return;
      }
      if (!isEscapeActive(host)) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const canvas = host.closest('.studio-whiteboard');
      if (!target || !canvas?.contains(target) || document.visibilityState === 'hidden') {
        return;
      }

      const commandKey = event.ctrlKey || event.metaKey;
      const ownsExpandedDocument = documentOwnsShortcut(target, host);
      if (ownsExpandedDocument && commandKey && ['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        return;
      }
      if (
        shortcutBlockedRef.current ||
        canvas.querySelector('.studio-format-popover,[role="menu"],[role="dialog"]')
      ) {
        return;
      }
      if (
        target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),iframe,[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]',
        )
      ) {
        return;
      }

      handleCanvasNavigation(event, target, commandKey, ownsExpandedDocument);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeld.current = false;
        setSpacePan(false);
      }
    };
    const resetSpace = () => {
      spaceHeld.current = false;
      setSpacePan(false);
      if (gestureRef.current?.kind === 'pan') {
        updateGesture(null);
      }
    };
    window.addEventListener('blur', resetSpace);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', resetSpace);
    };
  }, [
    canEdit,
    selectIds,
    apply,
    actionsRef,
    readingRef,
    shortcutBlockedRef,
    viewportRef,
    numericTool,
    updateGesture,
    selectionRef,
    reportCanvasFailure,
    setAnnotationHoverId,
    setViewport,
    viewportElement,
    boardRef,
    documentFocusSurface,
    clipboard,
    spaceHeld,
    gestureRef,
    setSpacePan,
  ]);

  return activateNumericTool;
}
