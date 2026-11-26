import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createWhiteboardSession } from '../../data/whiteboard/index.js';
import { StatePanel } from '../../ui/base/index.js';
import { Canvas } from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import type { BoardPreviewFrame } from './board-features.js';
import { projectPayloads, projectScene } from './canvas-projection.js';

function readOnly() {
  return undefined;
}

function HistoryCanvasView({
  scene,
  loadPayloads,
  selection,
  onSelectionChange,
}: BoardPreviewFrame) {
  const [session] = useState(() =>
    createWhiteboardSession(
      {
        getScene: () => Promise.resolve(scene),
        getPayloads: (_boardId, ids, signal) => loadPayloads(ids, signal),
      },
      scene.boardId,
    ),
  );
  useEffect(() => session.open(), [session]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const source = state.kind === 'ready' ? state.scene : undefined;
  const projection = useMemo(() => (source ? projectScene(source) : undefined), [source]);
  if (state.kind === 'loading') {
    return <StatePanel kind="initial-loading" title="正在加载此版本" />;
  }
  if (state.kind === 'failed' || !projection) {
    return <StatePanel kind="error" title="无法显示这个版本" />;
  }

  const { scene: projected, payloadById } = projectPayloads(projection, state.payloads);

  return (
    <div className="whiteboard-editor__history-canvas">
      <Canvas
        viewId={scene.boardId + ':' + scene.revision.toString()}
        label={scene.title || '白板版本'}
        scene={projected}
        selection={selection}
        tool="select"
        canEdit={false}
        fitOnMount
        objectExtensions={studioObjectExtensions}
        payloadById={payloadById}
        onSelectionChange={onSelectionChange}
        onEditIntent={readOnly}
        onVisibleObjectsChange={session.observeVisible}
      />
      {state.payloadError && (
        <div role="status" className="whiteboard-editor__history-error">
          {state.payloadError}
        </div>
      )}
    </div>
  );
}

export function renderBoardHistoryCanvas(frame: BoardPreviewFrame) {
  return (
    <HistoryCanvasView
      key={frame.scene.boardId + ':' + frame.scene.revision.toString()}
      {...frame}
    />
  );
}
