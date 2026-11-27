import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  RoomAccessError,
  RoomCapacityError,
  RoomInputError,
  type ParticipantKey,
  type RoomAccess,
  type RoomEvent,
  type RoomsApplication,
} from '../../modules/rooms/application/index.js';
import { SharingAccessError } from '../../modules/sharing/application/index.js';
import { sendStatus } from './response.js';
import { eventFrame } from './room-route-wire.js';
import type { HttpActor } from './unary-route.js';

const roomPath = '/studio-room-events';
const recheckIntervalMs = 1500;
const maxRoomEventCharacters = 128 * 1024;
const headers = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
};

export function roomEventPath(url: string | undefined): boolean {
  return url?.split('?', 1)[0] === roomPath;
}

function authorizedBoard(actor: HttpActor, boardId: string): boolean {
  try {
    actor.authorize?.({ boardId });
    return true;
  } catch (error) {
    if (error instanceof SharingAccessError) {
      return false;
    }

    throw error;
  }
}

interface StreamOptions {
  readonly application: RoomsApplication;
  readonly boardId: string;
  readonly key: ParticipantKey;
  readonly response: ServerResponse;
  readonly authorize: () => HttpActor | undefined;
  readonly reportError: (error: unknown) => void;
}

class RoomStream {
  private interval?: ReturnType<typeof setInterval>;
  private release?: () => void;
  private baseline?: RoomAccess;
  private last?: RoomEvent;
  private stopped = false;
  private backpressured = false;

  constructor(private readonly options: StreamOptions) {}

  open(): void {
    const { application, boardId, key, response } = this.options;
    const subscription = application.subscribe(boardId, key, {
      deliver: (event) => this.run(() => this.deliver(event)),
      close: () => this.end(),
      recheck: () =>
        this.run(() => {
          this.checkAccess();
        }),
    });
    this.release = subscription.release;
    this.baseline = subscription.access;
    this.last = subscription.initial;
    response.once('close', () => this.stop());
    response.on('drain', () => {
      this.backpressured = false;
    });
    response.writeHead(200, headers);
    this.write(eventFrame(subscription.initial));
    if (!this.stopped) {
      this.interval = setInterval(() => this.run(() => this.tick()), recheckIntervalMs);
      this.interval.unref();
    }
  }

  private currentAccess(): RoomAccess | undefined {
    const { application, boardId, key, authorize } = this.options;
    const actor = authorize();
    if (actor?.id !== key.actorId || !authorizedBoard(actor, boardId)) {
      return undefined;
    }

    const live = application.access(boardId, key.actorId);
    const baseline = this.baseline;
    if (live?.canEdit === baseline?.canEdit && live?.role === baseline?.role) {
      return live;
    }
  }

  private checkAccess(): RoomAccess | undefined {
    const access = this.currentAccess();
    if (!access) {
      this.accessLost();
    }

    return access;
  }

  private deliver(event: RoomEvent): void {
    if (!this.checkAccess()) {
      return;
    }

    this.last = event;
    this.write(eventFrame(event));
  }

  private tick(): void {
    const access = this.checkAccess();
    if (!access) {
      return;
    }

    this.options.application.tick(this.options.boardId, access.boardRevision);
    if (!this.backpressured) {
      this.write(': keepalive\n\n');
    }
  }

  private write(frame: string): void {
    if (this.stopped || this.options.response.destroyed) {
      return;
    }

    if (frame.length > maxRoomEventCharacters || this.backpressured) {
      this.end();
      return;
    }

    this.backpressured = !this.options.response.write(frame);
  }

  private accessLost(): void {
    if (this.stopped) {
      return;
    }

    const last = this.last;
    const terminal =
      last &&
      eventFrame({
        ...last,
        sequence: last.sequence + 1n,
        payload: { kind: 'accessLost' },
      });
    this.end(terminal);

    const { application, boardId, key } = this.options;
    application.revokeView(boardId, key);
  }

  private run(action: () => void): void {
    if (this.stopped) {
      return;
    }

    try {
      action();
    } catch (error) {
      this.end();
      this.options.reportError(error);
    }
  }

  private stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    clearInterval(this.interval);
    this.release?.();
  }

  private end(frame?: string): void {
    this.stop();
    if (!this.options.response.destroyed) {
      this.options.response.end(frame);
    }
  }
}

function readScope(request: IncomingMessage): { boardId: string; viewId: string } | undefined {
  const url = URL.parse(request.url ?? '', 'http://127.0.0.1');
  if (!url) {
    return undefined;
  }

  const boardId = url.searchParams.get('boardId') ?? '';
  const viewId = url.searchParams.get('viewId') ?? '';
  if (boardId.trim() && boardId.length <= 160 && viewId.trim()) {
    return { boardId, viewId };
  }
}

export function serveRoomEvents(
  application: RoomsApplication,
  request: IncomingMessage,
  response: ServerResponse,
  authorize: () => HttpActor | undefined,
  reportError: (error: unknown) => void,
): void {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    sendStatus(response, 405);
    return;
  }

  const scope = readScope(request);
  if (!scope) {
    sendStatus(response, 400);
    return;
  }

  const actor = authorize();
  if (!actor) {
    sendStatus(response, 401);
    return;
  }

  try {
    const { boardId, viewId } = scope;
    if (!authorizedBoard(actor, boardId)) {
      sendStatus(response, 403);
      return;
    }

    new RoomStream({
      application,
      boardId,
      key: { viewId, actorId: actor.id },
      response,
      authorize,
      reportError,
    }).open();
  } catch (error) {
    if (error instanceof RoomAccessError) {
      sendStatus(response, 403);
      return;
    }
    if (error instanceof RoomCapacityError) {
      sendStatus(response, 503);
      return;
    }

    if (error instanceof RoomInputError) {
      sendStatus(response, 400);
      return;
    }

    throw error;
  }
}
