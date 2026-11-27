import type { ClipboardEvent } from 'react';
import type { BoardClipboardSelection } from './geometry-commands.js';

const clipboardMime = 'application/x-luming-studio-ii';
const clipboardPrefix = 'LUMING_STUDIO_II_SELECTION\n';
const copyLimit = 200;
const objectIdLimit = 256;
const encodedLimit = 64 * 1024;
const boardRevisionPattern = /^\d{1,19}$/u;
const clipboardControl =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), iframe, [role="dialog"], [role="menu"], [data-canvas-native]';

export function encodeBoardSelection({
  sourceBoardId,
  sourceRevision,
  objectIds,
}: BoardClipboardSelection) {
  if (objectIds.length === 0 || objectIds.length > copyLimit) {
    throw new Error('一次最多复制 200 个白板对象。');
  }

  return JSON.stringify({ sourceBoardId, sourceRevision: sourceRevision.toString(), objectIds });
}

function validIdentifier(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= objectIdLimit;
}

function readClipboardIdentity(value: unknown) {
  const message = '剪贴板中的白板选区无效。';
  if (typeof value !== 'object' || !value) {
    throw new Error(message);
  }
  if (!('sourceBoardId' in value) || !('sourceRevision' in value) || !('objectIds' in value)) {
    throw new Error(message);
  }

  const { sourceBoardId, sourceRevision, objectIds } = value;
  const validRevision =
    typeof sourceRevision === 'string' && boardRevisionPattern.test(sourceRevision);

  if (!validIdentifier(sourceBoardId) || !validRevision || !Array.isArray(objectIds)) {
    throw new Error(message);
  }

  const boundedSelection = objectIds.length > 0 && objectIds.length <= copyLimit;
  const uniqueSelection = new Set(objectIds).size === objectIds.length;
  if (!boundedSelection || !uniqueSelection || !objectIds.every(validIdentifier)) {
    throw new Error(message);
  }

  return { sourceBoardId, sourceRevision: BigInt(sourceRevision), objectIds };
}

export function readBoardClipboard(
  text: string,
  encoded?: string,
): BoardClipboardSelection | undefined {
  const fallback = text.startsWith(clipboardPrefix) ? text.slice(clipboardPrefix.length) : '';
  const serialized = encoded || fallback;
  if (!serialized) {
    return undefined;
  }
  if (serialized.length > encodedLimit) {
    throw new Error('剪贴板中的白板选区太大。');
  }

  return readClipboardIdentity(JSON.parse(serialized));
}

export function writeClipboardEvent(event: ClipboardEvent, encoded: string) {
  event.clipboardData.setData(clipboardMime, encoded);
  event.clipboardData.setData('text/plain', boardClipboardText(encoded));
  event.preventDefault();
}

export function boardClipboardText(encoded: string) {
  return clipboardPrefix + encoded;
}

export function readClipboardEvent(event: ClipboardEvent) {
  const { clipboardData } = event;
  return {
    text: clipboardData.getData('text/plain'),
    encoded: clipboardData.getData(clipboardMime),
  };
}

export function canvasOwnsClipboard(event: Pick<ClipboardEvent, 'target' | 'defaultPrevented'>) {
  const { target } = event;
  return (
    !event.defaultPrevented &&
    target instanceof Element &&
    Boolean(target.closest('[data-canvas-root]')) &&
    !target.closest(clipboardControl)
  );
}
