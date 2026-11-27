import type { IncomingMessage, ServerResponse } from 'node:http';
import { create, toBinary } from '@bufbuild/protobuf';
import {
  BoardRoomEventSchema,
  BoardRoomService,
  type BoardRoomEvent,
  type StreamBoardRoomEventsRequest,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { Code, ConnectError, createContextKey, createContextValues } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import {
  RoomAccessError,
  RoomCapacityError,
  RoomInputError,
  type ParticipantKey,
  type RoomEvent,
  type RoomEventCursor,
  type RoomsApplication,
} from '../../modules/rooms/application/index.js';
import { SharingAccessError } from '../../modules/sharing/application/index.js';
import { compactPayload, eventWire } from './room-route-wire.js';
import type { HttpActor } from './unary-route.js';

const method = BoardRoomService.method.streamBoardRoomEvents;
export const roomEventStreamPath = `/${method.parent.typeName}/${method.name}`;

const maxEventBytes = 96 * 1024;
const maxQueuedEvents = 32;
const maxQueuedBytes = 512 * 1024;
const recheckIntervalMs = 1500;

interface BufferedEvent {
  readonly event: BoardRoomEvent;
  readonly bytes: number;
}

const packedEvents = new WeakMap<RoomEvent, BufferedEvent>();

function packEvent(event: RoomEvent): BufferedEvent {
  const cached = packedEvents.get(event);
  if (cached) {
    return cached;
  }

  let wire = create(BoardRoomEventSchema, eventWire(event));
  let bytes = toBinary(BoardRoomEventSchema, wire).byteLength;
  if (bytes > maxEventBytes) {
    wire = create(BoardRoomEventSchema, eventWire({ ...event, payload: compactPayload(event) }));
    bytes = toBinary(BoardRoomEventSchema, wire).byteLength;
  }
  if (bytes > maxEventBytes) {
    throw new RoomCapacityError('Room event exceeds the stream message limit');
  }

  const packed = { event: wire, bytes };
  packedEvents.set(event, packed);
  return packed;
}

function decodeCursor({
  boardId,
  after,
}: StreamBoardRoomEventsRequest): RoomEventCursor | undefined {
  if (!boardId.trim() || boardId.length > 160) {
    throw new RoomInputError('Invalid room identifier');
  }
  if (!after) {
    return;
  }

  const { roomInstanceId, sequence } = after;
  if (!roomInstanceId.trim() || roomInstanceId.length > 160 || sequence === undefined) {
    throw new RoomInputError('Invalid room event cursor');
  }

  return { roomInstanceId, sequence };
}

type ErrorReporter = (error: unknown) => void;

function streamError(error: unknown, reportError: ErrorReporter): ConnectError {
  if (error instanceof ConnectError) {
    return error;
  }
  if (error instanceof RoomInputError) {
    return new ConnectError(error.message, Code.InvalidArgument);
  }
  if (error instanceof RoomAccessError || error instanceof SharingAccessError) {
    return new ConnectError('Room access is unavailable', Code.PermissionDenied);
  }
  if (error instanceof RoomCapacityError) {
    return new ConnectError(error.message, Code.ResourceExhausted);
  }

  reportError(error);
  return new ConnectError('Room stream failed', Code.Internal);
}

function authorizeBoardRead(actor: HttpActor, boardId: string) {
  if (actor.authorizeRead) {
    actor.authorizeRead(boardId);
  } else {
    actor.authorize?.({ boardId });
  }
}

interface StreamRequest {
  readonly authorize: () => HttpActor | undefined;
  readonly disconnectBlockedWriter: () => void;
}

interface StreamOptions extends StreamRequest {
  readonly application: RoomsApplication;
  readonly boardId: string;
  readonly key: ParticipantKey;
  readonly reportError: ErrorReporter;
}

class RoomEventStream {
  private readonly pending: BufferedEvent[] = [];
  private pendingBytes = 0;
  private wake?: () => void;
  private failure?: ConnectError;
  private subscription?: ReturnType<RoomsApplication['subscribeAfter']>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly options: StreamOptions) {}

  async *read(cursor: RoomEventCursor | undefined, signal: AbortSignal) {
    const cancel = () => this.fail(ConnectError.from(signal.reason, Code.Canceled));
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) {
        cancel();
        return;
      }

      this.open(cursor);
      for (;;) {
        const event = await this.take();
        if (!event) {
          return;
        }

        this.checkAccess();
        yield { event };
      }
    } catch (error) {
      throw this.fail(error);
    } finally {
      signal.removeEventListener('abort', cancel);
      this.dispose();
    }
  }

  private open(cursor: RoomEventCursor | undefined) {
    const { application, boardId, key } = this.options;
    const subscription = application.subscribeAfter(boardId, key, cursor, {
      deliver: (event) => this.run(() => this.enqueue(event)),
      recheck: () => this.run(() => this.checkAccess()),
      close: () => this.fail(new ConnectError('Room stream closed', Code.Unavailable)),
    });
    this.subscription = subscription;
    for (const event of subscription.events) {
      this.enqueue(event);
    }

    this.interval = setInterval(() => this.run(() => this.tick()), recheckIntervalMs);
    this.interval.unref();
  }

  private checkAccess() {
    const { application, boardId, key, authorize } = this.options;
    const actor = authorize();
    if (!actor || actor.id !== key.actorId || actor.kind === 'agent') {
      throw new RoomAccessError('Room stream authorization has changed');
    }

    authorizeBoardRead(actor, boardId);
    const access = application.access(boardId, key.actorId);
    const baseline = this.subscription?.access;
    if (!access || access.role !== baseline?.role || access.canEdit !== baseline.canEdit) {
      throw new RoomAccessError('Room stream authorization has changed');
    }

    return access;
  }

  private tick() {
    const access = this.checkAccess();
    this.options.application.tick(this.options.boardId, access.boardRevision);
  }

  private enqueue(event: RoomEvent) {
    const packed = packEvent(event);
    const pendingBytes = this.pendingBytes + packed.bytes;
    if (this.pending.length >= maxQueuedEvents || pendingBytes > maxQueuedBytes) {
      throw new RoomCapacityError('Room stream cannot keep up with events');
    }

    this.pending.push(packed);
    this.pendingBytes = pendingBytes;
    this.notify();
  }

  private async take() {
    if (!this.pending.length && !this.failure) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
    if (this.failure) {
      throw this.failure;
    }

    const next = this.pending.shift();
    if (next) {
      this.pendingBytes -= next.bytes;
      return next.event;
    }
  }

  private notify() {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  private run(action: () => void) {
    if (this.failure) {
      return;
    }

    try {
      action();
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    if (this.failure) {
      return this.failure;
    }

    this.failure = streamError(error, this.options.reportError);
    this.dispose();
    this.notify();
    this.options.disconnectBlockedWriter();
    if (this.failure.code === Code.PermissionDenied) {
      const { application, boardId, key } = this.options;
      application.revokeView(boardId, key);
    }

    return this.failure;
  }

  private dispose() {
    clearInterval(this.interval);
    this.subscription?.release();
    this.subscription = undefined;
    this.pending.length = 0;
    this.pendingBytes = 0;
  }
}

const roomStreamRequest = createContextKey<StreamRequest | undefined>(undefined);

export function createRoomEventStreamRoute(
  application: RoomsApplication,
  reportError: ErrorReporter,
) {
  const requests = new WeakMap<object, StreamRequest>();
  const handler = connectNodeAdapter({
    connect: true,
    grpc: false,
    grpcWeb: true,
    readMaxBytes: 2048,
    writeMaxBytes: 2 * maxEventBytes,
    acceptCompression: [],
    contextValues: (request) => createContextValues().set(roomStreamRequest, requests.get(request)),
    routes(router) {
      router.rpc(method, async function* (input, context) {
        const request = context.values.get(roomStreamRequest);
        const actor = request?.authorize();
        if (!request || !actor) {
          throw new ConnectError('Room authentication is required', Code.Unauthenticated);
        }
        if (actor.kind === 'agent') {
          throw new ConnectError('Room streams are for human viewers', Code.PermissionDenied);
        }

        let cursor: RoomEventCursor | undefined;
        try {
          cursor = decodeCursor(input);
          authorizeBoardRead(actor, input.boardId);
        } catch (error) {
          throw streamError(error, reportError);
        }

        context.responseHeader.set('cache-control', 'no-store, no-transform');
        context.responseHeader.set('x-accel-buffering', 'no');
        yield* new RoomEventStream({
          application,
          boardId: input.boardId,
          key: { actorId: actor.id, viewId: input.viewId },
          reportError,
          ...request,
        }).read(cursor, context.signal);
      });
    },
  });

  return (
    request: IncomingMessage,
    response: ServerResponse,
    authorize: StreamRequest['authorize'],
  ) => {
    requests.set(request, {
      authorize,
      disconnectBlockedWriter() {
        if (response.writableNeedDrain) {
          response.destroy();
        }
      },
    });

    try {
      handler(request, response);
    } finally {
      requests.delete(request);
    }
  };
}
