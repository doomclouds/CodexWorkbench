import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { useCanvasFrame, useCanvasSize } from './canvas-frame.js';
import { canvasNativeId, useCanvasInput } from './canvas-input.js';
import { editableTarget, useCanvasModel } from './canvas-model.js';
import type { CanvasProps } from './contracts.js';
import { CanvasOverlays } from './overlays/index.js';
import { CanvasObjects } from './rendering/index.js';
import { projectObject } from './scene/index.js';
import { fitViewport, getObjectBounds, mergeRects } from './viewport/index.js';
import './Canvas.css';

function sameIds(previous: readonly string[] | undefined, next: readonly string[]) {
  if (!previous || previous.length !== next.length) {
    return false;
  }

  return previous.every((id, index) => id === next[index]);
}

function CanvasSession(props: CanvasProps) {
  const { label, tool, canEdit, initialViewport, onViewportChange, onVisibleObjectsChange, ref } =
    props;
  const root = useRef<HTMLDivElement>(null);
  const size = useCanvasSize(root);
  const [retainedId, setRetainedId] = useState<string>();
  const controller = useCanvasFrame(root, initialViewport);
  const { frame, update } = controller;
  const { index, pending, selected, painted, visibleIds } = useCanvasModel(
    props,
    frame,
    size,
    retainedId,
  );
  const input = useCanvasInput({ root, size, index, pending, frame: controller, props });
  const firstSelected = selected[0]?.object.id;
  const canTransform = canEdit && tool === 'select' && selected.length === 1;
  const editable =
    canTransform && firstSelected ? editableTarget(index, pending, firstSelected)?.id : undefined;
  const previousVisible = useRef<readonly string[] | undefined>(undefined);
  const observeVisible = useEffectEvent((ids: readonly string[]) => onVisibleObjectsChange?.(ids));
  const observeViewport = useEffectEvent(onViewportChange ?? (() => undefined));

  useEffect(() => {
    if (sameIds(previousVisible.current, visibleIds)) {
      return;
    }

    previousVisible.current = visibleIds;
    observeVisible(visibleIds);
  }, [visibleIds]);

  useEffect(() => {
    observeViewport(frame.viewport);
  }, [frame.viewport]);

  function focus() {
    root.current?.focus({ preventScroll: true });
  }

  function fitToObjects(ids: readonly string[]) {
    const bounds = ids.flatMap((id) => {
      const item = projectObject(index, pending, id);

      return item ? [getObjectBounds(item.geometry)] : [];
    });
    const target = mergeRects(bounds);
    if (!target || size.width <= 0 || size.height <= 0) {
      return;
    }

    input.cancel();
    update({ viewport: fitViewport(target, size) }, 'now');
  }

  useImperativeHandle(ref, () => ({ focus, fitToObjects }));

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    setRetainedId(canvasNativeId(event.target, event.currentTarget));
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextNative = canvasNativeId(event.relatedTarget, event.currentTarget);
    setRetainedId(nextNative);
    if (nextNative) {
      input.clearSpace();
    }
    if (!event.currentTarget.contains(event.relatedTarget)) {
      input.clearSpace();
      input.cancel();
    }
  }

  const { x, y, zoom } = frame.viewport;
  const transform = `translate(${x}px, ${y}px) scale(${zoom})`;

  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="studio-canvas"
      data-canvas-root={props.viewId}
      data-tool={tool}
      onPointerDown={input.handlePointerDown}
      onPointerMove={input.handlePointerMove}
      onPointerUp={input.handlePointerUp}
      onPointerCancel={input.handlePointerCancel}
      onLostPointerCapture={input.handlePointerCancel}
      onKeyDown={input.handleKeyDown}
      onKeyUp={input.handleKeyUp}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="studio-canvas__background" aria-hidden="true" />
      <div className="studio-canvas__world" style={{ transform }}>
        <CanvasObjects objects={painted} contentById={props.contentById} />
      </div>
      <CanvasOverlays
        viewport={frame.viewport}
        selected={selected}
        marquee={frame.marquee}
        editableId={editable}
        onHandlePointerDown={input.handleHandlePointerDown}
      />
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return <CanvasSession key={JSON.stringify([props.viewId, props.scene.boardId])} {...props} />;
}
