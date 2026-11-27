import type { IncomingMessage, ServerResponse } from 'node:http';
import { create, toBinary } from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomService,
  WaitBoardRoomEventsResponseSchema,
  type BoardRoomEvent,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import {
  RoomAccessError,
  RoomCapacityError,
  type ParticipantKey,
  type RoomAccess,
  type RoomEvent,
  type RoomEventCursor,
  type RoomsApplication,
} from '../../modules/rooms/application/index.js';
import { decodeRequest, HttpRequestError, readBody, requireId } from './request.js';
import { sendProtobuf } from './response.js';
import { compactPayload, eventWire } from './room-route-wire.js';
import type { HttpActor } from './unary-route.js';

const method = BoardRoomService.method.waitBoardRoomEvents;
export const roomEventWaitPath = `/${method.parent.typeName}/${method.name}`;

const waitMs = 20_000;
const recheckMs = 1500;
const maxEvents = 12;
const maxResponseBytes = 96 * 1024;
const eventEnvelopeBytes = 5;

function packEvents(events: readonly RoomEvent[]): Uint8Array {
  const packed: BoardRoomEvent[] = [];
  let size = 0;
  for (const event of events.slice(0, maxEvents)) {
    let wire = create(BoardRoomEventSchema, eventWire(event));
    let bytes = toBinary(BoardRoomEventSchema, wire).byteLength + eventEnvelopeBytes;
    if (bytes > maxResponseBytes) {
      wire = create(BoardRoomEventSchema, eventWire({ ...event, payload: compactPayload(event) }));
      bytes = toBinary(BoardRoomEventSchema, wire).byteLength + eventEnvelopeBytes;
    }
    if (size + bytes > maxResponseBytes) {
      if (packed.length === 0) {
        throw new RoomCapacityError('Room event exceeds the wait response limit');
      }

      break;
    }

    packed.push(wire);
    size += bytes;
  }

  return toBinary(
    WaitBoardRoomEventsResponseSchema,
    create(WaitBoardRoomEventsResponseSchema, {
      events: packed,
    }),
  );
}

interface WaitOptions {
  readonly application: RoomsApplication;
  readonly boardId: string;
  readonly key: ParticipantKey;
  readonly cursor?: RoomEventCursor;
  readonly response: ServerResponse;
  readonly authorize: () => HttpActor | undefined;
}

function waitForEvents({ application, boardId, key, cursor, response, authorize }: WaitOptions) {
  return new Promise<readonly RoomEvent[] | undefined>((resolve, reject) => {
    let release: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let baseline: RoomAccess;
    let finished = false;

    function stop() {
      finished = true;
      clearTimeout(timeout);
      clearInterval(interval);
      response.off('close', cancel);
      release?.();
    }

    function cancel() {
      stop();
      resolve(undefined);
    }

    function run(action: () => void) {
      if (finished) {
        return;
      }

      try {
        action();
      } catch (error) {
        stop();
        reject(error);
      }
    }

    function currentAccess(): RoomAccess {
      const actor = authorize();
      if (actor?.id !== key.actorId) {
        throw new RoomAccessError('Room access has changed');
      }

      actor.authorizeRead?.(boardId);
      const access = application.access(boardId, key.actorId);
      if (!access || access.canEdit !== baseline.canEdit || access.role !== baseline.role) {
        throw new RoomAccessError('Room access has changed');
      }

      return access;
    }

    function complete(events: readonly RoomEvent[]) {
      currentAccess();
      stop();
      resolve(events);
    }

    run(() => {
      if (response.destroyed) {
        cancel();
        return;
      }

      const subscription = application.subscribeAfter(boardId, key, cursor, {
        deliver: (event) => run(() => complete([event])),
        recheck: () =>
          run(() => {
            currentAccess();
          }),
        close: () =>
          run(() => {
            throw new RoomCapacityError('Room event subscription closed');
          }),
      });
      baseline = subscription.access;
      release = subscription.release;
      if (subscription.events.length > 0) {
        complete(subscription.events);
        return;
      }

      response.once('close', cancel);
      timeout = setTimeout(() => run(() => complete([])), waitMs);
      interval = setInterval(
        () => run(() => application.tick(boardId, currentAccess().boardRevision)),
        recheckMs,
      );
      timeout.unref();
      interval.unref();
    });
  });
}

export async function serveRoomEventWait(
  application: RoomsApplication,
  request: IncomingMessage,
  response: ServerResponse,
  actor: HttpActor,
  authorize: () => HttpActor | undefined,
): Promise<void> {
  const input = decodeRequest(method.input, await readBody(request, 2048));
  actor.authorize?.(input);
  const boardId = requireId(input.boardId);
  const { after } = input;
  if (boardId.length > 160) {
    throw new HttpRequestError(400, 'Room identifier is too long');
  }

  let cursor: RoomEventCursor | undefined;
  if (after) {
    if (
      !after.roomInstanceId ||
      after.roomInstanceId.length > 160 ||
      after.sequence === undefined
    ) {
      throw new HttpRequestError(400, 'Invalid room event cursor');
    }

    cursor = { roomInstanceId: after.roomInstanceId, sequence: after.sequence };
  }

  const events = await waitForEvents({
    application,
    boardId,
    key: { actorId: actor.id, viewId: input.viewId },
    cursor,
    response,
    authorize,
  });

  if (events && !response.destroyed) {
    sendProtobuf(response, packEvents(events));
  }
}
