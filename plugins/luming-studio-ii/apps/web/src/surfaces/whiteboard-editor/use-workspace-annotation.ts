import { useState, type MouseEvent } from 'react';
import type { WhiteboardObject } from '../../data/whiteboard/index.js';
import type {
  CanvasGeometry,
  CanvasPresentation,
  CanvasProps,
  CanvasViewport,
  CanvasViewportSize,
} from '../../ui/domain/canvas/index.js';
import type { BoardFeedbackFrame } from './board-features.js';
import { isCanvasAnnotationTarget } from './canvas-annotation.js';
import type { projectPayloads, projectScene } from './canvas-projection.js';
import { useAnnotationRange } from './use-annotation-range.js';

type SceneProjection = NonNullable<ReturnType<typeof projectScene>>;

function annotationActions(
  online: boolean,
  feedbackEnabled: boolean,
  onToggleAnnotation: () => void,
  onAnnotate: () => void,
) {
  if (!online || !feedbackEnabled) {
    return {};
  }

  return { onToggleAnnotation, onAnnotate };
}

function feedbackCoordinates(
  viewport: CanvasViewport,
  geometry: CanvasGeometry | undefined,
  size: CanvasViewportSize | undefined,
): BoardFeedbackFrame['viewport'] {
  if (!geometry || !size || size.width <= 0) {
    return viewport;
  }

  const zoom = size.width / geometry.width;
  const zoomY = size.height / geometry.height;
  return { x: -geometry.x * zoom, y: -geometry.y * zoomY, zoom, zoomY };
}

export function readFeedbackView(
  scope: CanvasPresentation | undefined,
  projection: SceneProjection,
  viewport: CanvasViewport,
  viewportSize: CanvasViewportSize | undefined,
  history: boolean,
) {
  const focusedObjectId = scope?.focusObjectId;
  const documentReading = Boolean(focusedObjectId);
  const geometry = focusedObjectId
    ? projection.objectsById.get(focusedObjectId)?.geometry
    : undefined;

  return {
    documentReading,
    focusedObjectId,
    viewport: feedbackCoordinates(viewport, geometry, viewportSize),
    hidingFeedback: history || Boolean(scope && !documentReading),
  };
}

interface WorkspaceAnnotationOptions {
  readonly canComment: boolean;
  readonly feedbackEnabled: boolean;
  readonly documentReading: boolean;
  readonly viewport: BoardFeedbackFrame['viewport'];
  readonly canvasArea: HTMLDivElement | null;
  readonly objects: readonly WhiteboardObject[];
  readonly objectsById: SceneProjection['objectsById'];
  readonly revision: bigint;
  readonly payloadById: ReturnType<typeof projectPayloads>['payloadById'];
  readonly selection: readonly string[];
  readonly onActivate: () => void;
  readonly onToggle: () => void;
}

export function useWorkspaceAnnotation({
  canComment,
  feedbackEnabled,
  documentReading,
  viewport,
  canvasArea,
  objects,
  objectsById,
  revision,
  payloadById,
  selection,
  onActivate,
  onToggle,
}: WorkspaceAnnotationOptions) {
  const [annotationActive, setAnnotationActive] = useState(false);
  const [unresolvedFeedback, setUnresolvedFeedback] = useState(false);
  const [annotationRequest, setAnnotationRequest] =
    useState<BoardFeedbackFrame['annotationRequest']>();
  const [contentAnnotationRequest, setContentAnnotationRequest] =
    useState<BoardFeedbackFrame['contentAnnotationRequest']>();
  const [pointAnnotationRequest, setPointAnnotationRequest] =
    useState<BoardFeedbackFrame['pointAnnotationRequest']>();

  function changeAnnotation(active: boolean) {
    if (active) {
      onActivate();
    }

    setAnnotationActive(active);
  }

  function handleToggleAnnotation() {
    onToggle();
    changeAnnotation(!annotationActive);
  }

  const annotationRange = useAnnotationRange({
    enabled: canComment && annotationActive && !documentReading,
    viewport,
    objects,
    revision,
  });

  function handleCanvasAnnotation(event: MouseEvent<HTMLDivElement>) {
    const accepting = canComment && annotationActive && event.detail > 0;
    const hit = !event.defaultPrevented && isCanvasAnnotationTarget(event.target);
    if (annotationRange.takeClickSuppression() || !accepting || !hit) {
      return;
    }

    const bounds = canvasArea?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    event.preventDefault();
    const x = (event.clientX - bounds.left - viewport.x) / viewport.zoom;
    const y = (event.clientY - bounds.top - viewport.y) / (viewport.zoomY ?? viewport.zoom);
    setPointAnnotationRequest((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      point: { x, y },
    }));
  }

  function handleAnnotateSelection() {
    if (selection.length > 1) {
      annotationRange.annotateSelected(selection);
      return;
    }
    const [objectId] = selection;
    if (objectId) {
      setAnnotationRequest((current) => ({ objectId, sequence: (current?.sequence ?? 0) + 1 }));
    }
  }

  const attachContentAnnotation: NonNullable<CanvasProps['onAnnotateContent']> = (id, request) => {
    const version = payloadById.get(id)?.version;
    const object = objectsById.get(id);
    if (!canComment || !object || version === undefined) {
      return;
    }

    const { u, v, target: content, excerpt } = request;
    if (content.kind === 'object') {
      setAnnotationRequest((current) => ({
        objectId: id,
        sequence: (current?.sequence ?? 0) + 1,
        u,
        v,
      }));

      return;
    }

    setContentAnnotationRequest((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      excerpt,
      target: {
        kind: 'content',
        objectId: id,
        geometryVersion: BigInt(object.version),
        payloadVersion: BigInt(version),
        u,
        v,
        content,
      },
    }));
  };

  return {
    active: annotationActive,
    unresolved: unresolvedFeedback,
    onUnresolvedChange: setUnresolvedFeedback,
    onActiveChange: changeAnnotation,
    reset: () => setAnnotationActive(false),
    request: annotationRequest,
    contentRequest: contentAnnotationRequest,
    pointRequest: pointAnnotationRequest,
    range: annotationRange,
    onClick: handleCanvasAnnotation,
    onAnnotateContent: attachContentAnnotation,
    ...annotationActions(
      canComment,
      feedbackEnabled,
      handleToggleAnnotation,
      handleAnnotateSelection,
    ),
  };
}
