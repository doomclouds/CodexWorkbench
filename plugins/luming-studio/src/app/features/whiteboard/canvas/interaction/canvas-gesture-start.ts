import type { PointerEvent } from 'react';
import type { BoardElement, ElementType } from '../../../../../contracts/studio.js';
import { defaultDocument } from '../../../../../contracts/document.js';
import { getBoardSticker } from '../../../../../shared/whiteboard-stickers.js';
import { newClientId } from '../../../../shared/client-id.js';
import {
  duplicateElements,
  expandMoveIds,
  makeElement,
  type Point,
} from '../scene/canvas-model.js';
import { selectionBounds, type ResizeHandle } from '../scene/native-geometry.js';
import { ROTATABLE_TYPES } from './selection-affordances.js';
import type { Gesture } from './canvas-gesture-placement.js';

interface CreationStyle {
  shapeKind: BoardElement['kind'];
  pen: { color: string; width: number };
  sticker: string;
}

export type SelectionTransform = { kind: 'resize'; handle: ResizeHandle } | { kind: 'rotate' };

export function pointerBelongsToObjectControl(
  event: PointerEvent<Element>,
  element: BoardElement | undefined,
  annotating: boolean,
  moveHandle: boolean,
) {
  if (moveHandle) {
    return false;
  }

  const target = event.target as Element;
  if (element?.type === 'document' && target.closest('[data-document-content]')) {
    event.stopPropagation();
    return true;
  }

  return Boolean(!annotating && target.closest('[data-native-interactive]'));
}

export function selectForPointerMove(
  element: BoardElement,
  elements: BoardElement[],
  current: string[],
  additive: boolean,
) {
  const groupIds = element.groupId
    ? elements.filter((item) => item.groupId === element.groupId).map((item) => item.id)
    : [element.id];
  const wasSelected = current.includes(element.id);
  let ids = wasSelected ? current : groupIds;
  if (additive) {
    ids = wasSelected
      ? current.filter((id) => !groupIds.includes(id))
      : [...new Set([...current, ...groupIds])];
  }

  return { ids, newlySingle: !wasSelected && ids.length === 1, toggleOff: additive && wasSelected };
}

export function startMoveGesture(
  elements: BoardElement[],
  selectedIds: string[],
  start: Point,
  screenStart: Point,
  copy: boolean,
): Gesture {
  const moveIds = expandMoveIds(
    elements,
    selectedIds.filter((id) => !elements.find((item) => item.id === id)?.locked),
  );
  const copies = copy ? duplicateElements(elements, moveIds, { x: 0, y: 0 }) : undefined;
  return {
    kind: 'move',
    start,
    screenStart,
    current: start,
    ids: copies ? copies.map((element) => element.id) : moveIds,
    elements: copies ?? elements.filter((item) => moveIds.includes(item.id)),
    copies,
  };
}

export function startCreationGesture(
  type: ElementType,
  point: Point,
  anchor: BoardElement | undefined,
  { shapeKind, pen, sticker }: CreationStyle,
): Gesture {
  const drawing = type === 'stroke' || type === 'arrow';
  const created = makeElement(type, point, {
    ...(type === 'shape' ? { kind: shapeKind } : {}),
    ...(['text', 'shape', 'note'].includes(type) ? { text: '' } : {}),
    ...(type === 'document' ? { document: defaultDocument(newClientId('block')) } : {}),
    ...(drawing ? { stroke: pen.color, color: pen.color, strokeWidth: pen.width } : {}),
    ...(type === 'sticker'
      ? { text: getBoardSticker(sticker)!.label, data: { stickerIconId: sticker } }
      : {}),
  });

  if (drawing) {
    if (type === 'arrow') {
      created.from = anchor?.id ?? [point.x, point.y];
      created.to = [point.x, point.y];
    }

    return {
      kind: 'draw',
      start: point,
      points: [point],
      element: created,
      ...(anchor ? { from: anchor.id } : {}),
    };
  }

  return {
    kind: 'create',
    start: point,
    element: created,
    initialSize: { w: created.w, h: created.h },
  };
}

export function prepareSelectionTransform(
  transform: SelectionTransform,
  elements: BoardElement[],
  ids: string[],
) {
  const box = selectionBounds(elements, ids);
  if (!box) {
    return;
  }

  const blocked = elements.some((element) => {
    if (!ids.includes(element.id)) {
      return false;
    }

    const canRotate = element.type === 'arrow' || ROTATABLE_TYPES.has(element.type);
    return element.locked || (transform.kind === 'rotate' && !canRotate);
  });

  if (!blocked) {
    return { ...transform, elements, ids, box, operations: [] };
  }
}
