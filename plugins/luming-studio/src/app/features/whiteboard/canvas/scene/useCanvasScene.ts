import { useMemo } from 'react';
import type {
  BoardElement,
  Operation,
  Presence,
  StyleProfile,
} from '../../../../../contracts/studio.js';
import { nativeFill, nativeSurfaces } from '../../../../../shared/native-surface.js';
import { createArrowElementIndex } from '../../../../../shared/whiteboard-geometry.js';
import type { PeerGesture } from '../../../../shared/useNativeGestureSync.js';
import {
  drawnElement,
  projectGestureGeometry,
  type Gesture,
} from '../interaction/canvas-gesture-placement.js';
import { connectionAtPoint, connectionPoint } from '../interaction/selection-affordances.js';
import { boundsOf, elementBounds, makeElement, moveOperations } from './canvas-model.js';
import { sectionTitleDetails, showHtmlCaption } from './canvas-presentation.js';
import { nativePaint } from './native-palette.js';

interface RemoteProjection {
  contentElements: BoardElement[];
  movingIds: readonly string[];
  editingIds: readonly string[];
  queueTasks: readonly { keys: readonly string[] }[];
  peerGestures: readonly PeerGesture[];
}

interface GestureProjection {
  contentElements: BoardElement[];
  gesture: Gesture | null;
  zoom: number;
  penColor: string;
  penWidth: number;
  currentMoveElements: (
    moving: Extract<Gesture, { kind: 'move' }>,
    elements: BoardElement[],
    patches: Operation[],
  ) => BoardElement[];
}

interface CanvasSceneInput extends RemoteProjection, GestureProjection {
  presence: readonly Presence[];
  presentationZoom: number;
  editingId?: string;
  reading: { ids: readonly string[] } | null;
  viewStyle: StyleProfile;
  viewTheme: 'light' | 'dark';
}

function applyPeerGeometry(
  elements: BoardElement[],
  element: BoardElement,
  kind: PeerGesture['kind'],
) {
  const index = elements.findIndex((item) => item.id === element.id);
  if (index < 0) {
    if (kind !== 'upload') {
      elements.push(element);
    }
    return;
  }
  const geometry = Object.fromEntries(
    [
      'x',
      'y',
      'w',
      'h',
      'rotation',
      'points',
      'from',
      'to',
      'bends',
      'fromSide',
      'toSide',
      'labelOffset',
      'labelSize',
    ]
      .filter((key) => element[key] !== undefined)
      .map((key) => [key, element[key]]),
  );

  elements[index] = { ...elements[index]!, ...geometry };
}

function projectRemoteElements({
  contentElements,
  movingIds,
  editingIds,
  queueTasks,
  peerGestures,
}: RemoteProjection) {
  if (!peerGestures.length) {
    return contentElements;
  }

  const elements = contentElements.slice();
  const localIntentIds = new Set([
    ...movingIds,
    ...editingIds,
    ...queueTasks.flatMap((task) => task.keys),
  ]);

  for (const peer of peerGestures) {
    for (const element of peer.elements) {
      if (localIntentIds.has(element.id)) {
        continue;
      }

      applyPeerGeometry(elements, element, peer.kind);
    }
  }
  return elements;
}

function projectRenderedElements(
  { contentElements, gesture, zoom, penColor, penWidth, currentMoveElements }: GestureProjection,
  remoteElements: BoardElement[],
) {
  if (!gesture) {
    return remoteElements;
  }

  if (gesture.kind === 'move') {
    const patches = moveOperations(gesture.elements, gesture.ids, {
      x: gesture.current.x - gesture.start.x,
      y: gesture.current.y - gesture.start.y,
    });

    return currentMoveElements(gesture, remoteElements, patches);
  }
  if (gesture.kind === 'resize' || gesture.kind === 'rotate' || gesture.kind === 'arrow-point') {
    return projectGestureGeometry(remoteElements, gesture.operations);
  }
  if (gesture.kind === 'create') {
    return gesture.element.type === 'document'
      ? remoteElements
      : [...remoteElements, gesture.element];
  }

  if (
    gesture.kind === 'connect' &&
    gesture.element.type !== 'note' &&
    Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y) * zoom >= 5
  ) {
    const target = connectionAtPoint(contentElements, gesture.current, zoom, [gesture.element.id]);

    return [
      ...remoteElements,
      makeElement('arrow', connectionPoint(gesture.element, gesture.side), {
        id: 'connection-preview',
        from: gesture.element.id,
        fromSide: gesture.side,
        to: target?.element.id ?? [gesture.current.x, gesture.current.y],
        ...(target?.side ? { toSide: target.side } : {}),
        color: penColor,
        stroke: penColor,
        strokeWidth: penWidth,
      }),
    ];
  }
  if (gesture.kind === 'draw') {
    return [...remoteElements, drawnElement(gesture)];
  }

  return remoteElements;
}

function previewFrames(
  peerGestures: readonly PeerGesture[],
  presence: readonly Presence[],
  remoteElements: BoardElement[],
) {
  return peerGestures.flatMap((peer) => {
    const page = presence.find((page) => page.peerId === peer.peerId);
    const busyIds = [
      ...(page?.context?.editingIds ?? []),
      ...(Array.isArray(page?.context?.movingIds) ? (page.context.movingIds as string[]) : []),
    ];

    if (
      peer.kind === 'upload' &&
      peer.elements.length &&
      peer.elements.every((element) => busyIds.includes(element.id))
    ) {
      return [];
    }

    const bounds = boundsOf(peer.elements.map((element) => elementBounds(element, remoteElements)));
    return bounds ? [{ peer, bounds }] : [];
  });
}

export function useCanvasScene({
  contentElements,
  movingIds,
  editingIds,
  queueTasks,
  peerGestures,
  presence,
  gesture,
  zoom,
  penColor,
  penWidth,
  presentationZoom,
  editingId,
  reading,
  viewStyle,
  viewTheme,
  currentMoveElements,
}: CanvasSceneInput) {
  const remoteElements = useMemo(
    () =>
      projectRemoteElements({ contentElements, movingIds, editingIds, queueTasks, peerGestures }),
    [contentElements, movingIds, editingIds, queueTasks, peerGestures],
  );
  const renderedElements = useMemo(
    () =>
      projectRenderedElements(
        { contentElements, gesture, zoom, penColor, penWidth, currentMoveElements },
        remoteElements,
      ),
    [contentElements, remoteElements, gesture, zoom, penColor, penWidth, currentMoveElements],
  );
  const arrowElementIndex = useMemo(
    () => createArrowElementIndex(renderedElements),
    [renderedElements],
  );
  const sectionTitles = useMemo(
    () => sectionTitleDetails(renderedElements, presentationZoom),
    [renderedElements, presentationZoom],
  );
  const titleElements = useMemo(
    () =>
      renderedElements.filter((element) => element.type === 'html' || element.type === 'container'),
    [renderedElements],
  );
  const titleCandidates = useMemo(
    () =>
      titleElements.filter(
        (element) =>
          showHtmlCaption(element, zoom) ||
          (element.type === 'container' &&
            (element.id === editingId || sectionTitles.has(element.id))),
      ),
    [titleElements, zoom, sectionTitles, editingId],
  );
  const surfaceScene = useMemo(
    () =>
      nativeSurfaces(
        reading
          ? renderedElements.filter((element) => reading.ids.includes(element.id))
          : renderedElements,
        viewStyle,
        (element) => nativeFill(element, viewStyle, nativePaint(element.fill, viewTheme)),
      ),
    [renderedElements, reading, viewStyle, viewTheme],
  );
  const peerPreviewFrames = previewFrames(peerGestures, presence, remoteElements);

  return {
    renderedElements,
    arrowElementIndex,
    sectionTitles,
    titleCandidates,
    surfaceScene,
    peerPreviewFrames,
  };
}
