import { useMemo, useRef, useState } from 'react';
import type { WhiteboardReadyState } from '../../data/whiteboard/index.js';
import type { ActionMenuAnchor } from '../../ui/base/index.js';
import type { CanvasInlineFormat, CanvasPoint, CanvasProps } from '../../ui/domain/canvas/index.js';
import type { projectScene } from './canvas-projection.js';
import { describeSelectionLocks } from './organization-selection.js';

type SceneProjection = NonNullable<ReturnType<typeof projectScene>>;

function selectedObjectsFor(projected: SceneProjection, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const object = projected.objectsById.get(id);

    return object ? [object] : [];
  });
}

function selectedSection(objects: ReturnType<typeof selectedObjectsFor>) {
  const [first] = objects;
  return objects.length === 1 && first?.kind === 'section' ? first : undefined;
}

function selectedHtmlObjectId(
  objects: ReturnType<typeof selectedObjectsFor>,
  payloads: WhiteboardReadyState['payloads'],
) {
  const [object] = objects;
  if (objects.length !== 1 || !object) {
    return undefined;
  }
  if (object.kind !== 'html' && object.kind !== 'diagram') {
    return undefined;
  }

  const body = payloads.get(object.id)?.body;
  return body?.kind === 'embed' && typeof body.value.html === 'string' ? object.id : undefined;
}

interface WorkspaceSelectionOptions {
  readonly initialSelectedIds: readonly string[];
  readonly projection: SceneProjection;
  readonly payloads: WhiteboardReadyState['payloads'];
}

export function useWorkspaceSelection({
  initialSelectedIds,
  projection,
  payloads,
}: WorkspaceSelectionOptions) {
  const [selected, setSelected] = useState(initialSelectedIds);
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor | null>(null);
  const [objectEdit, setObjectEdit] = useState<CanvasProps['editObjectRequest']>();
  const [formatObjectRequest, setFormatObjectRequest] =
    useState<CanvasProps['formatObjectRequest']>();
  const nextFormatRequest = useRef(0);
  const selectionEpoch = useRef(0);
  const selectionBeforePlacement = useRef<readonly string[]>([]);
  const selection = useMemo(
    () => selected.filter((id) => projection.objectsById.has(id)),
    [selected, projection.objectsById],
  );
  const selectedObjects = selectedObjectsFor(projection, selection);
  const selectionLocks = describeSelectionLocks(selectedObjects, projection.objectsById);
  const selectedHtmlId = selectedHtmlObjectId(selectedObjects, payloads);

  function readSelectionEpoch() {
    return selectionEpoch.current;
  }

  function advanceSelectionEpoch() {
    selectionEpoch.current += 1;
  }

  function clearFormatRequest() {
    setFormatObjectRequest(undefined);
  }

  function dismissMenu() {
    setMenuAnchor(null);
  }

  function selectPlacement(ids: readonly string[]) {
    dismissMenu();
    setSelected(ids);
  }

  function onPlacementStarted(id: string) {
    selectionBeforePlacement.current = selection;
    selectPlacement([id]);
  }

  function onPlacementFailed(id: string, selectionCurrent: boolean) {
    const previous = selectionBeforePlacement.current;
    setSelected((current) => (selectionCurrent ? previous : current.filter((item) => item !== id)));
  }

  function handleContextMenu(anchor: CanvasPoint, ids: readonly string[]) {
    changeSelection(ids);
    setMenuAnchor(anchor);
  }

  function handleSelectionMenu(trigger: HTMLButtonElement) {
    const { left, bottom } = trigger.getBoundingClientRect();

    setMenuAnchor({ x: left, y: bottom + 6 });
  }

  function editObject(id: string) {
    setObjectEdit({ id });
  }

  const section = selectedSection(selectedObjects);
  const onRenameSection = section && (() => editObject(section.id));

  function selectAll() {
    changeSelection(projection.scene.objects.map(({ id }) => id));
  }

  function changeSelection(ids: readonly string[]) {
    advanceSelectionEpoch();
    clearFormatRequest();
    setSelected(ids);
  }

  function handleFormatObject(id: string, format: CanvasInlineFormat) {
    nextFormatRequest.current += 1;
    setFormatObjectRequest({ id, format, sequence: nextFormatRequest.current });
  }

  return {
    selected,
    selection,
    selectedObjects,
    selectionLocks,
    selectedHtmlId,
    menuAnchor,
    dismissMenu,
    objectEdit,
    editObject,
    formatObjectRequest,
    clearFormatRequest,
    readSelectionEpoch,
    advanceSelectionEpoch,
    selectPlacement,
    onPlacementStarted,
    onPlacementFailed,
    changeSelection,
    selectAll,
    handleContextMenu,
    handleSelectionMenu,
    handleFormatObject,
    onRenameSection,
  };
}
