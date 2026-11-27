import { Code, ConnectError, createClient, type Transport } from '@connectrpc/connect';
import { BoardRoomService as roomProtocol } from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import type { BoardRoomService, BoardRoomStreamObserver } from './contracts.js';
import { readRoomEvent } from './room-message.js';

function disconnectReason(error: unknown) {
  if (error instanceof ConnectError) {
    if (error.code === Code.PermissionDenied || error.code === Code.Unauthenticated) {
      return 'accessLost';
    }
  }
}

export function createBoardRoomStream(transport: Transport): Pick<BoardRoomService, 'subscribe'> {
  const client = createClient(roomProtocol, transport);

  async function observe(
    boardId: string,
    viewId: string,
    observer: BoardRoomStreamObserver,
    signal: AbortSignal,
  ) {
    const incoming = client.streamBoardRoomEvents({ boardId, viewId }, { signal });
    for await (const response of incoming) {
      signal.throwIfAborted();
      observer.onEvent(readRoomEvent(response.event, boardId));
    }
  }

  return {
    subscribe(boardId, viewId, observer, signal) {
      if (signal.aborted) {
        return;
      }

      function disconnect(error?: unknown) {
        if (!signal.aborted) {
          observer.onDisconnect(disconnectReason(error), error);
        }
      }

      observe(boardId, viewId, observer, signal).then(() => disconnect(), disconnect);
    },
  };
}
