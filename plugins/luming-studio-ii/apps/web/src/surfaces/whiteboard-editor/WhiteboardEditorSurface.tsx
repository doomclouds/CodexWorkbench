import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createWhiteboardSession, type WhiteboardService } from '../../data/whiteboard/index.js';
import { Button, OperationNotice, StatePanel, StatusText } from '../../ui/base/index.js';
import {
  Canvas,
  type CanvasHandle,
  type CanvasObjectExtension,
} from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import { MoveNotice, MoveStatus } from './MoveFeedback.js';
import { projectPayloads, projectScene } from './canvas-projection.js';
import { useMoveSession } from './move-session.js';
import './whiteboard-editor.css';

export interface WhiteboardEditorSurfaceProps {
  readonly boardId: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
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
}

interface BoardSurfaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly createCommandId: () => string;
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

function BoardWorkspace({ state, session, projection, createCommandId }: BoardWorkspaceProps) {
  const board = state.scene;
  const canvas = useRef<CanvasHandle>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
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

  return (
    <>
      <header className="whiteboard-editor__header">
        <h1 className="whiteboard-editor__title">{title}</h1>
        <div className="whiteboard-editor__actions">
          {!board.canEdit && <StatusText message="只读" />}
          <MoveStatus controls={move} />
          <Button
            label="适应画布"
            variant="ghost"
            disabled={projected.scene.objects.length === 0}
            onActivate={fitBoard}
          />
        </div>
      </header>
      <MoveNotice controls={move} />
      <BoardReadNotices
        state={state}
        session={session}
        unsafePayloadVersion={projected.unsafePayloadVersion}
      />
      <div className="whiteboard-editor__canvas">
        <Canvas
          ref={canvas}
          viewId={board.boardId}
          label={title}
          scene={projected.scene}
          selection={selection}
          tool="select"
          canEdit={canEdit}
          pendingEdits={move.pendingEdits}
          objectExtensions={moveExtensions}
          payloadById={projected.payloadById}
          onSelectionChange={setSelected}
          onEditIntent={move.handleEdit}
          onVisibleObjectsChange={session.observeVisible}
        />
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

function LoadedBoard({ state, session, createCommandId }: BoardSurfaceProps) {
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
    />
  );
}

export function WhiteboardEditorSurface({
  boardId,
  service,
  createCommandId,
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
        />
      )}
    </section>
  );
}
