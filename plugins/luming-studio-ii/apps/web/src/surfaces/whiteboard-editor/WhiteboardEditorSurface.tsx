import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createWhiteboardSession, type WhiteboardService } from '../../data/whiteboard/index.js';
import { Button, OperationNotice, StatePanel, StatusText } from '../../ui/base/index.js';
import {
  Canvas,
  type CanvasHandle,
  type CanvasObjectExtension,
  type CanvasViewport,
  type CanvasViewportRequest,
} from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import { BoardHeader, BoardToolbar, BoardViewportTools, type BoardTool } from './BoardChrome.js';
import { MoveNotice, MoveStatus } from './MoveFeedback.js';
import { projectPayloads, projectScene } from './canvas-projection.js';
import { useMoveSession } from './move-session.js';
import './whiteboard-editor.css';

export interface WhiteboardEditorSurfaceProps {
  readonly boardId: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
}

type WhiteboardSession = ReturnType<typeof createWhiteboardSession>;
type WhiteboardState = ReturnType<WhiteboardSession['getSnapshot']>;
type ReadyState = Extract<WhiteboardState, { kind: 'ready' }>;
type SceneProjection = NonNullable<ReturnType<typeof projectScene>>;

interface BoardWorkspaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly projection: SceneProjection;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
}

interface BoardSurfaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
}

const movable = {
  move: true,
  resize: false,
  rotate: false,
  connect: false,
} as const;

const moveExtensions: readonly CanvasObjectExtension[] = [
  ...studioObjectExtensions.map((extension) => ({
    ...extension,
    placement: undefined,
    portClick: undefined,
    capabilities: { ...extension.capabilities, resize: false, rotate: false, connect: false },
  })),
  { kind: 'ink', capabilities: { ...movable, content: 'passive' }, blocksPlacement: false },
  { kind: 'native', capabilities: { ...movable, content: 'native' } },
];

function BoardWorkspace({
  state,
  session,
  projection,
  createCommandId,
  onBack,
}: BoardWorkspaceProps) {
  const board = state.scene;
  const canvas = useRef<CanvasHandle>(null);
  const area = useRef<HTMLDivElement>(null);
  const zoomRequest = useRef(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [tool, setTool] = useState<BoardTool>('select');
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const [viewportRequest, setViewportRequest] = useState<CanvasViewportRequest>();
  const selection = useMemo(
    () => selected.filter((id) => projection.objectsById.has(id)),
    [selected, projection.objectsById],
  );
  const projected = useMemo(
    () => projectPayloads(projection, state.payloads),
    [projection, state.payloads],
  );
  const mayEdit = board.canEdit && !state.sceneError;
  const move = useMoveSession(session, board.boardId, mayEdit, createCommandId);
  const canEdit = mayEdit && move.pendingEdits.length === 0;
  const title = board.title || '白板';

  function fitBoard() {
    canvas.current?.fitToObjects([...projection.objectsById.keys()]);
  }

  function handleZoomBoard(value: number) {
    const bounds = area.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const zoom = Math.max(0.05, Math.min(4, value));
    const scale = zoom / viewport.zoom;
    const x = bounds.width / 2;
    const y = bounds.height / 2;
    setViewportRequest({
      requestId: String(++zoomRequest.current),
      viewport: { x: x - (x - viewport.x) * scale, y: y - (y - viewport.y) * scale, zoom },
    });
  }

  return (
    <>
      <BoardHeader
        title={title}
        onBack={onBack}
        status={board.canEdit ? <MoveStatus controls={move} /> : <StatusText message="只读" />}
      />
      <MoveNotice controls={move} />
      <BoardReadNotices
        state={state}
        session={session}
        unsafePayloadVersion={projected.unsafePayloadVersion}
      />
      <div ref={area} className="whiteboard-editor__canvas">
        <Canvas
          ref={canvas}
          viewId={board.boardId}
          label={title}
          scene={projected.scene}
          selection={selection}
          tool={tool}
          fitOnMount={Boolean(onBack)}
          viewportRequest={viewportRequest}
          canEdit={canEdit}
          pendingEdits={move.pendingEdits}
          objectExtensions={moveExtensions}
          payloadById={projected.payloadById}
          onSelectionChange={setSelected}
          onEditIntent={move.handleEdit}
          onViewportChange={setViewport}
          onVisibleObjectsChange={session.observeVisible}
        />
        <BoardViewportTools
          zoom={viewport.zoom}
          onZoom={handleZoomBoard}
          onFit={fitBoard}
          hasObjects={projected.scene.objects.length > 0}
        />
        {board.canEdit && <BoardToolbar tool={tool} onToolChange={setTool} />}
        {projected.scene.objects.length === 0 && (
          <div className="whiteboard-editor__empty">
            <StatePanel kind="empty" title="白板里还没有对象" />
          </div>
        )}
      </div>
    </>
  );
}

interface BoardReadNoticesProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly unsafePayloadVersion: boolean;
}

function BoardReadNotices({ state, session, unsafePayloadVersion }: BoardReadNoticesProps) {
  return (
    <>
      {state.sceneError && (
        <OperationNotice
          id="whiteboard-reload-failed"
          level="error"
          message={'白板刷新失败。' + state.sceneError}
          actions={[{ id: 'reload', label: '重新加载', onActivate: session.reload }]}
        />
      )}
      {state.payloadError && (
        <OperationNotice
          id="whiteboard-payload-failed"
          level="warning"
          message={'对象正文加载失败。' + state.payloadError}
          actions={[{ id: 'retry-payloads', label: '重试正文', onActivate: session.retryPayloads }]}
        />
      )}
      {unsafePayloadVersion && (
        <OperationNotice
          id="whiteboard-payload-version"
          level="warning"
          message="部分对象的正文版本超出当前画布的安全整数范围。"
        />
      )}
    </>
  );
}

function LoadedBoard({ state, session, createCommandId, onBack }: BoardSurfaceProps) {
  const projection = useMemo(() => projectScene(state.scene), [state.scene]);
  if (!projection) {
    return (
      <div className="whiteboard-editor__state">
        <StatePanel
          kind="error"
          title="无法打开画布"
          detail="白板或对象的位置版本超出当前画布的安全整数范围。"
          action={<Button label="重新加载" onActivate={session.reload} />}
        />
      </div>
    );
  }

  return (
    <BoardWorkspace
      state={state}
      session={session}
      projection={projection}
      createCommandId={createCommandId}
      onBack={onBack}
    />
  );
}

export function WhiteboardEditorSurface({
  boardId,
  service,
  createCommandId,
  onBack,
}: WhiteboardEditorSurfaceProps) {
  const session = useMemo(() => createWhiteboardSession(service, boardId), [service, boardId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => session.open(), [session]);

  return (
    <section className="whiteboard-editor" aria-label="白板编辑">
      {state.kind === 'loading' && (
        <div className="whiteboard-editor__state">
          <StatePanel kind="initial-loading" title="正在打开白板" />
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="whiteboard-editor__state">
          <StatePanel
            kind="error"
            title="无法打开白板"
            detail={state.message}
            action={<Button label="重新加载" onActivate={session.reload} />}
          />
        </div>
      )}
      {state.kind === 'ready' && (
        <LoadedBoard
          key={boardId}
          state={state}
          session={session}
          createCommandId={createCommandId}
          onBack={onBack}
        />
      )}
    </section>
  );
}
