import type { ComponentProps } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import { copyPlainText } from '../../../../clipboard.js';
import { duplicateElements, expandMoveIds } from '../scene/canvas-model.js';

const CLIPBOARD_PREFIX = 'LUMING_STUDIO_ELEMENTS_V1\n';
const CLIPBOARD_TYPE = 'application/x-luming-studio';
const MAX_CLIPBOARD_BYTES = 8 * 1024 * 1024;
const MAX_CLIPBOARD_ELEMENTS = 200;
const MAX_CLIPBOARD_TEXT = 20_000;
const SUPPORTED_NATIVE_TYPES = new Set([
  'shape',
  'container',
  'text',
  'stroke',
  'arrow',
  'image',
  'html',
  'document',
  'table',
  'link',
  'note',
  'sticker',
]);

interface CanvasClipboardOptions {
  selection: () => { elements: BoardElement[]; ids: string[] };
  remember: (elements: BoardElement[]) => void;
  canPaste: boolean;
  addElements: (elements: BoardElement[], label: string) => Promise<unknown>;
  makeText: (element: Partial<BoardElement>) => BoardElement;
  uploadFiles: (files: FileList) => Promise<unknown>;
  reportFailure: (failure: unknown) => void;
}

export function cloneCanvasSelection(
  elements: BoardElement[],
  selection: string[],
): BoardElement[] {
  const ids = expandMoveIds(elements, selection);

  return structuredClone(elements.filter((element) => ids.includes(element.id)));
}

function isClipboardElement(value: unknown): value is BoardElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

function readElements(encoded: string): BoardElement[] | null {
  const elements: unknown = JSON.parse(encoded);
  if (!Array.isArray(elements) || elements.length > MAX_CLIPBOARD_ELEMENTS) {
    return null;
  }

  return elements.every(isClipboardElement) ? elements : null;
}

function isTextEditing(target: EventTarget) {
  return Boolean(
    (target as HTMLElement).closest(
      'input,textarea,[contenteditable="true"],[data-document-content]',
    ),
  );
}

export function createCanvasClipboard({
  selection,
  remember,
  canPaste,
  addElements,
  makeText,
  uploadFiles,
  reportFailure,
}: CanvasClipboardOptions) {
  function pasteElements(elements: BoardElement[]) {
    return addElements(
      duplicateElements(
        elements,
        elements.map((element) => element.id),
      ),
      '粘贴元素',
    );
  }

  async function copySelection() {
    const { elements, ids } = selection();
    const copied = cloneCanvasSelection(elements, ids);
    await copyPlainText(CLIPBOARD_PREFIX + JSON.stringify(copied));
    remember(copied);
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.readText) {
      throw new Error('此浏览器无法直接读取剪贴板，请按 Ctrl/⌘ V 粘贴。');
    }

    const value = await navigator.clipboard.readText();
    if (value.length > MAX_CLIPBOARD_BYTES) {
      throw new Error('剪贴板内容超过8 MB，请分批粘贴。');
    }

    if (value.startsWith(CLIPBOARD_PREFIX)) {
      const pasted = readElements(value.slice(CLIPBOARD_PREFIX.length));
      if (!pasted) {
        throw new Error('剪贴板中的白板内容无效。');
      }

      await pasteElements(pasted);
      return;
    }
    if (value.trim()) {
      await addElements([makeText({ text: value.slice(0, MAX_CLIPBOARD_TEXT) })], '粘贴文字');
    }
  }

  const handleCanvasCopy: NonNullable<ComponentProps<'div'>['onCopy']> = (event) => {
    const { elements, ids } = selection();
    if (isTextEditing(event.target) || !ids.length) {
      return;
    }

    const copied = cloneCanvasSelection(elements, ids);
    remember(copied);
    event.clipboardData.setData(CLIPBOARD_TYPE, JSON.stringify(copied));
    event.clipboardData.setData(
      'text/plain',
      copied
        .map((element) => element.text ?? element.label ?? '')
        .filter(Boolean)
        .join('\n'),
    );
    event.preventDefault();
  };

  const handleCanvasPaste: NonNullable<ComponentProps<'div'>['onPaste']> = (event) => {
    if (!canPaste || isTextEditing(event.target)) {
      return;
    }

    if (event.clipboardData.files.length) {
      event.preventDefault();
      uploadFiles(event.clipboardData.files).catch(reportFailure);
      return;
    }

    const text = event.clipboardData.getData('text/plain');
    const encoded =
      event.clipboardData.getData(CLIPBOARD_TYPE) ||
      (text.startsWith(CLIPBOARD_PREFIX) ? text.slice(CLIPBOARD_PREFIX.length) : '');

    if (encoded && encoded.length < MAX_CLIPBOARD_BYTES) {
      try {
        const elements = readElements(encoded);
        if (elements?.every((element) => SUPPORTED_NATIVE_TYPES.has(element.type))) {
          event.preventDefault();
          pasteElements(elements).catch(reportFailure);
          return;
        }
      } catch (failure) {
        if (!(failure instanceof SyntaxError)) {
          reportFailure(failure);
        }
      }
    }

    if (text.trim() && text.length <= MAX_CLIPBOARD_TEXT) {
      event.preventDefault();
      addElements(
        [makeText({ text, w: 380, h: Math.max(70, Math.min(600, text.split('\n').length * 30)) })],
        '粘贴文字',
      ).catch(reportFailure);
    }
  };

  return { copySelection, pasteFromClipboard, handleCanvasCopy, handleCanvasPaste };
}
