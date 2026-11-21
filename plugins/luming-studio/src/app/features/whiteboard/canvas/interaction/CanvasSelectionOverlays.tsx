import type { ComponentProps, PointerEvent } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import type { ArrowElementIndex } from '../../../../../shared/whiteboard-geometry.js';
import type { Tool } from '../controls/CanvasEditingControls.js';
import { isHtmlEmbed } from '../objects/CanvasObject.js';
import { arrowGeometry, type Rect } from '../scene/canvas-model.js';
import type { Gesture } from './canvas-gesture-placement.js';
import ConnectionPorts from './ConnectionPorts.js';
import SelectionChrome from './SelectionChrome.js';
import { canShowConnectionPorts, ROTATABLE_TYPES } from './selection-affordances.js';

export type ArrowPointStart = Pick<
  Extract<Gesture, { kind: 'arrow-point' }>,
  'element' | 'end' | 'bendIndex' | 'points'
>;

interface SelectionView {
  bounds: Rect | null;
  count: number;
  selected?: BoardElement;
  selectedElements: readonly BoardElement[];
  renderedElements: readonly BoardElement[];
  arrowIndex: ArrowElementIndex;
  zoom: number;
}

interface SelectionMode {
  reading: boolean;
  canEdit: boolean;
  annotating: boolean;
  tool: Tool;
  spacePan: boolean;
  editing: { id: string } | null;
  gesture: Gesture | null;
}

interface SelectionActions {
  onResize: ComponentProps<typeof SelectionChrome>['onResize'];
  onRotate: ComponentProps<typeof SelectionChrome>['onRotate'];
  onConnect: ComponentProps<typeof ConnectionPorts>['onBegin'];
  onArrowPoint: (event: PointerEvent<HTMLButtonElement>, point: ArrowPointStart) => void;
}

function chromeVisible({ selected, count }: SelectionView, mode: SelectionMode) {
  const { reading, annotating, tool, spacePan, gesture, editing } = mode;
  if (reading || !count) {
    return false;
  }
  if (selected?.type === 'arrow' && !annotating && !selected.locked) {
    return false;
  }

  const usingSelection = tool === 'select' && !spacePan && gesture?.kind !== 'pan';
  if (!annotating && !usingSelection) {
    return false;
  }

  return !editing || (selected?.id === editing.id && ['text', 'note'].includes(selected.type));
}

function resizeEdges({
  count,
  selected,
  selectedElements,
}: SelectionView): ComponentProps<typeof SelectionChrome>['edges'] {
  if (selected?.type === 'text') {
    return ['w', 'e'];
  }

  const rotatedGroup = count > 1 && selectedElements.some((element) => element.rotation);
  const hasImage = selectedElements.some((element) => element.type === 'image');
  return hasImage || selected?.type === 'sticker' || rotatedGroup ? [] : undefined;
}

function renderSelectionChrome(
  view: SelectionView,
  mode: SelectionMode,
  actions: SelectionActions,
) {
  const { bounds, selected, selectedElements, renderedElements, zoom } = view;
  if (!bounds || !chromeVisible(view, mode)) {
    return null;
  }

  const element = selected && renderedElements.find((candidate) => candidate.id === selected.id);
  const resizedBounds =
    element && element.rotation
      ? { x: element.x, y: element.y, w: element.w, h: element.h }
      : bounds;

  return (
    <SelectionChrome
      bounds={resizedBounds}
      rotation={element?.rotation ?? 0}
      zoom={zoom}
      outsideResize={
        !!selected &&
        (selected.type === 'document' || selected.type === 'todo' || isHtmlEmbed(selected))
      }
      locked={mode.annotating || !mode.canEdit || selectedElements.some((item) => item.locked)}
      resizable={selectedElements.some((item) => !['arrow', 'link'].includes(item.type))}
      rotatable={selectedElements.every(
        (item) => item.type === 'arrow' || ROTATABLE_TYPES.has(item.type),
      )}
      edges={resizeEdges(view)}
      onResize={actions.onResize}
      onRotate={actions.onRotate}
    />
  );
}

function renderConnectionPorts(
  view: SelectionView,
  mode: SelectionMode,
  actions: SelectionActions,
) {
  const { selected, zoom } = view;
  const { reading, canEdit, annotating, tool, spacePan, editing, gesture } = mode;
  return (
    !reading &&
    selected &&
    canEdit &&
    !annotating &&
    tool === 'select' &&
    !spacePan &&
    !editing &&
    !gesture &&
    canShowConnectionPorts(selected, zoom) && (
      <ConnectionPorts element={selected} zoom={zoom} onBegin={actions.onConnect} />
    )
  );
}

function arrowHandleEnd(index: number, pointCount: number): ArrowPointStart['end'] {
  if (index === 0) {
    return 'from';
  }

  return index === pointCount - 1 ? 'to' : 'bends';
}

function arrowHandleLabel(end: ArrowPointStart['end'], index: number) {
  switch (end) {
    case 'from':
      return '连接线起点位置';
    case 'to':
      return '连接线终点位置';
    case 'bends':
      return `连接线折点 ${index}`;
  }
}

function renderArrowHandles(view: SelectionView, mode: SelectionMode, actions: SelectionActions) {
  const { selected, arrowIndex, zoom } = view;
  const { reading, editing, spacePan, annotating, tool, canEdit } = mode;
  if (reading || editing || selected?.type !== 'arrow') {
    return null;
  }
  if (spacePan || annotating || tool !== 'select') {
    return null;
  }
  if (!canEdit || selected.locked) {
    return null;
  }

  const points = arrowGeometry(selected, arrowIndex).points;
  return points.map((point, index) => {
    const end = arrowHandleEnd(index, points.length);
    return (
      <button
        type="button"
        key={`arrow-handle-${index}`}
        className="studio-arrow-handle"
        aria-label={arrowHandleLabel(end, index)}
        style={{
          left: point.x,
          top: point.y,
          width: 10 / zoom,
          height: 10 / zoom,
          borderWidth: 1.5 / zoom,
        }}
        onPointerDown={(event) =>
          actions.onArrowPoint(event, { element: selected, end, bendIndex: index - 1, points })
        }
      />
    );
  });
}

export function CanvasSelectionOverlays({
  view,
  mode,
  actions,
}: {
  view: SelectionView;
  mode: SelectionMode;
  actions: SelectionActions;
}) {
  return (
    <>
      {renderSelectionChrome(view, mode, actions)}
      {renderConnectionPorts(view, mode, actions)}
      {renderArrowHandles(view, mode, actions)}
    </>
  );
}

export function CanvasMarquee({ gesture, zoom }: { gesture: Gesture | null; zoom: number }) {
  return (
    (gesture?.kind === 'marquee' || gesture?.kind === 'annotate') && (
      <div
        className="studio-marquee"
        style={{
          left: Math.min(gesture.start.x, gesture.end.x),
          top: Math.min(gesture.start.y, gesture.end.y),
          width: Math.abs(gesture.end.x - gesture.start.x),
          height: Math.abs(gesture.end.y - gesture.start.y),
          borderWidth: 1 / zoom,
        }}
      />
    )
  );
}
