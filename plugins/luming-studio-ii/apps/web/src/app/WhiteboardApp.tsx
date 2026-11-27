import { useMemo, type ComponentProps } from 'react';
import type { BoardRoomSession } from '../data/rooms/index.js';
import './app.css';
import { studioPages } from './routes.js';

const { whiteboard: WhiteboardPage } = studioPages;

type WhiteboardPageProps = ComponentProps<typeof WhiteboardPage>;

export type CreateRoomSession = (boardId: string) => BoardRoomSession;

type RoomWhiteboardProps = WhiteboardPageProps & {
  readonly createRoomSession?: CreateRoomSession;
};

export function RoomWhiteboard({
  boardId,
  room,
  createRoomSession,
  ...props
}: RoomWhiteboardProps) {
  const session = useMemo(
    () => room ?? (boardId ? createRoomSession?.(boardId) : undefined),
    [room, boardId, createRoomSession],
  );

  return <WhiteboardPage {...props} boardId={boardId} room={session} />;
}

export function WhiteboardApp(props: RoomWhiteboardProps) {
  return (
    <div className="studio-whiteboard-app">
      <RoomWhiteboard {...props} />
    </div>
  );
}
