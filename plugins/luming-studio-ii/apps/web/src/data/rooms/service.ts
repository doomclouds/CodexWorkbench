import {
  create,
  fromBinary,
  fromJsonString,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomService as roomService,
  type ChangeBoardTimerRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { checkWorkspaceRelease } from './agent-workspaces.js';
import type {
  BoardRoomEvent,
  BoardRoomEventPort,
  BoardRoomPost,
  BoardRoomService,
  BoardRoomStreamObserver,
  BoardRoomTimerAction,
} from './contracts.js';
import { writeRoomGesture } from './room-gesture.js';
import { readRoomEvent, readServerTime, readTimerReceipt } from './room-message.js';

interface EventCursor {
  readonly instanceId: string;
  readonly sequence: bigint;
}

type ReadEvents = (
  cursor: EventCursor | undefined,
  signal: AbortSignal,
) => Promise<readonly BoardRoomEvent[]>;

interface WaitObserver {
  readonly waitForEvents: (
    read: ReadEvents,
    observer: BoardRoomStreamObserver,
    signal: AbortSignal,
  ) => void;
}

async function request<Input extends DescMessage, Output extends DescMessage>(
  post: BoardRoomPost,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
  signal?: AbortSignal,
  keepalive?: boolean,
) {
  const path = '/' + method.parent.typeName + '/' + method.name;
  const body = toBinary(method.input, create(method.input, input));
  const response = keepalive
    ? await post(path, body, signal, true)
    : await post(path, body, signal);

  return fromBinary(method.output, response, { readUnknownFields: false });
}

function writeTimerAction(
  action: BoardRoomTimerAction,
): MessageInitShape<typeof ChangeBoardTimerRequestSchema>['action'] {
  switch (action.kind) {
    case 'start':
    case 'pause':
    case 'resume':
    case 'reset':
      return { case: action.kind, value: {} };
    case 'setDuration':
      return { case: 'setDurationMs', value: action.durationMs };
    case 'adjustDuration':
      return { case: 'adjustDurationMs', value: action.deltaMs };
  }
}

export function createBoardRoomService(
  post: BoardRoomPost,
  events: BoardRoomEventPort | WaitObserver | Pick<BoardRoomService, 'subscribe'>,
): BoardRoomService {
  const methods = roomService.method;

  async function getRoom(boardId: string, signal?: AbortSignal) {
    const response = await request(post, methods.getBoardRoom, { boardId }, signal);

    return readRoomEvent(response.event, boardId);
  }

  function subscribe(
    boardId: string,
    viewId: string,
    observer: BoardRoomStreamObserver,
    signal: AbortSignal,
  ) {
    if (typeof events !== 'function') {
      if ('subscribe' in events) {
        events.subscribe(boardId, viewId, observer, signal);
        return;
      }

      events.waitForEvents(
        async (cursor, scope) => {
          const result = await request(
            post,
            methods.waitBoardRoomEvents,
            {
              boardId,
              viewId,
              after: cursor && { roomInstanceId: cursor.instanceId, sequence: cursor.sequence },
            },
            scope,
          );

          return result.events.map((event) => readRoomEvent(event, boardId));
        },
        observer,
        signal,
      );

      return;
    }

    events(
      boardId,
      viewId,
      {
        onEvent(text) {
          if (signal.aborted) {
            return;
          }

          let event: BoardRoomEvent;
          try {
            event = readRoomEvent(fromJsonString(BoardRoomEventSchema, text), boardId);
          } catch (error) {
            observer.onDisconnect(undefined, error);
            return;
          }

          observer.onEvent(event);
        },
        onDisconnect(reason) {
          if (!signal.aborted) {
            observer.onDisconnect(reason);
          }
        },
      },
      signal,
    );
  }

  return {
    subscribe,
    getRoom,
    async updatePresence(boardId, viewId, sequence, presence, signal) {
      const result = await request(
        post,
        methods.updateBoardPresence,
        {
          boardId,
          viewId,
          sequence,
          ...presence,
          gesture: writeRoomGesture(presence.gesture),
          editingObjectIds: [...(presence.editingObjectIds ?? [])],
        },
        signal,
      );

      return result.accepted;
    },
    async leavePresence(boardId, viewId, sequence, signal) {
      const result = await request(
        post,
        methods.leaveBoardPresence,
        { boardId, viewId, sequence },
        signal,
        true,
      );

      return result.accepted;
    },
    async changeTimer(boardId, { commandId, expectedVersion, action }, signal) {
      const { receipt, serverTimeUnixMs } = await request(
        post,
        methods.changeBoardTimer,
        { boardId, commandId, expectedVersion, action: writeTimerAction(action) },
        signal,
      );

      return {
        receipt: readTimerReceipt(receipt, boardId, commandId),
        serverTimeUnixMs: readServerTime(serverTimeUnixMs),
      };
    },
    async getTimerReceipt(boardId, commandId, signal) {
      const { receipt, serverTimeUnixMs } = await request(
        post,
        methods.getBoardTimerReceipt,
        { boardId, commandId },
        signal,
      );

      return {
        receipt: readTimerReceipt(receipt, boardId, commandId),
        serverTimeUnixMs: readServerTime(serverTimeUnixMs),
      };
    },
    async releaseAgentWorkspace(boardId, { agentId, taskId, generation }, signal) {
      const result = await request(
        post,
        methods.changeAgentActivity,
        {
          boardId,
          agentId,
          taskId,
          action: { case: 'release', value: { generation } },
        },
        signal,
      );
      checkWorkspaceRelease(result, generation);
    },
  };
}
