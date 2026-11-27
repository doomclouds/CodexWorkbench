import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  ArchiveRequestError,
  type ArchiveImportApplication,
} from '../../modules/archives/application/index.js';
import {
  CatalogQueryError,
  type CatalogApplication,
} from '../../modules/catalog/application/index.js';
import {
  FeedbackAccessError,
  FeedbackQueryError,
  FeedbackThreadNotFoundError,
  type FeedbackApplication,
} from '../../modules/feedback/application/index.js';
import {
  RoomAccessError,
  RoomCapacityError,
  RoomInputError,
  type RoomsApplication,
} from '../../modules/rooms/application/index.js';
import {
  BoardSuggestionError,
  WhiteboardAccessError,
  type BoardEditorApplication,
  type BoardHistoryApplication,
  type BoardSuggestionApplication,
  type WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { SharingAccessError } from '../../modules/sharing/application/index.js';
import { archiveRoute, createArchiveReceiptRoute } from './archive-routes.js';
import { createCatalogRoutes } from './catalog-routes.js';
import { boardDocumentImageRoutePath, createDocumentImageRoute } from './document-image-route.js';
import {
  boardImageRequestLimit,
  boardImageRoutePath,
  createBoardEditRoutes,
} from './edit-routes.js';
import { createFeedbackRoutes } from './feedback-routes.js';
import { createBoardHistoryRoutes } from './history-routes.js';
import {
  allowsGuestOrigin,
  guestAccessForPath,
  handleGuestInvitation,
  isGuestInvitationPath,
  resolveGuestActor,
  type GuestHttpOptions,
} from './guest-sharing.js';
import { HttpRequestError, mediaType, readBody } from './request.js';
import { protobufContentType, sendProtobuf, sendStatus } from './response.js';
import { agentActivityPath, agentActivityRequestLimit } from './room-agent-activity.js';
import { observeRoomChange } from './room-changes.js';
import { createRoomEventStreamRoute, roomEventStreamPath } from './room-event-stream.js';
import { roomEventWaitPath, serveRoomEventWait } from './room-event-wait.js';
import { createRoomRoutes, roomEventPath, serveRoomEvents } from './room-routes.js';
import { createWhiteboardRoutes } from './routes.js';
import { createSharingRoutes, type SharingRoutesOptions } from './share-routes.js';
import { createBoardSuggestionRoutes } from './suggestion-routes.js';
import type { HttpActor, ProtobufRoute } from './unary-route.js';
import {
  boardVideoRequestLimit,
  boardVideoRoutePath,
  createVideoEditRoute,
} from './video-edits.js';

export type { GuestHttpOptions } from './guest-sharing.js';
export { createGuestWeb } from './guest-web.js';
export { createModelSuggestionSubmitter } from './model-suggestion.js';
export { toPayloadResult } from './payload.js';
export { boardSuggestionSubmitPath } from './suggestion-routes.js';

const REQUEST_METHOD = 'POST';

interface BoardHttpFeatures {
  readonly editor: BoardEditorApplication;
  readonly history: BoardHistoryApplication;
  readonly feedback: FeedbackApplication;
  readonly rooms?: RoomsApplication;
  readonly suggestions?: BoardSuggestionApplication;
  readonly digest: (value: Uint8Array) => string;
}

export interface WhiteboardHttpOptions {
  readonly application: WhiteboardApplication;
  readonly catalogApplication: CatalogApplication;
  readonly archiveApplication: ArchiveImportApplication;
  readonly features?: BoardHttpFeatures;
  readonly sharing?: SharingRoutesOptions;
  readonly agentSuggestionPath?: string;
  readonly resolveActor: (request: IncomingMessage) => HttpActor | undefined;
  readonly onError: (error: unknown) => void;
}

interface Routes {
  readonly unary: ReadonlyMap<string, ProtobufRoute>;
  readonly roomStream?: ReturnType<typeof createRoomEventStreamRoute>;
}

const requestLimits = new Map([
  [boardImageRoutePath, boardImageRequestLimit],
  [boardDocumentImageRoutePath, boardImageRequestLimit],
  [boardVideoRoutePath, boardVideoRequestLimit],
  [agentActivityPath, agentActivityRequestLimit],
]);

function serveRoomConnection(
  request: IncomingMessage,
  response: ServerResponse,
  { features, resolveActor, onError }: WhiteboardHttpOptions,
  roomStream: Routes['roomStream'],
) {
  const path = request.url ?? '';
  const rooms = features?.rooms;
  if (roomStream && path === roomEventStreamPath) {
    roomStream(request, response, () => resolveActor(request));
    return true;
  }

  if (!rooms || !roomEventPath(path)) {
    return false;
  }

  serveRoomEvents(
    rooms,
    request,
    response,
    () => {
      const actor = resolveActor(request);

      return actor?.kind === 'agent' ? undefined : actor;
    },
    onError,
  );

  return true;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Routes,
  options: WhiteboardHttpOptions,
): Promise<void> {
  if (serveRoomConnection(request, response, options, routes.roomStream)) {
    return;
  }

  const { archiveApplication, features, resolveActor, agentSuggestionPath } = options;
  const path = request.url ?? '';
  const rooms = features?.rooms;
  const route = routes.unary.get(path);
  const rawRoute = archiveRoute(path, archiveApplication);
  const waitForRoom = path === roomEventWaitPath && rooms;
  if (!route && !rawRoute && !waitForRoom) {
    sendStatus(response, 404);
    return;
  }

  const method = rawRoute?.method ?? REQUEST_METHOD;
  if (request.method !== method) {
    response.setHeader('allow', method);
    sendStatus(response, 405);
    return;
  }

  const actor = resolveActor(request);
  if (!actor) {
    sendStatus(response, 401);
    return;
  }
  if (actor.kind === 'agent' && path !== agentSuggestionPath && path !== agentActivityPath) {
    sendStatus(response, 403);
    return;
  }

  if (rawRoute) {
    await rawRoute.run(actor, request, response);
    return;
  }
  if (mediaType(request) !== protobufContentType) {
    sendStatus(response, 415);
    return;
  }

  if (waitForRoom) {
    await serveRoomEventWait(waitForRoom, request, response, actor, () => resolveActor(request));
    return;
  }

  if (route) {
    const limit = requestLimits.get(path);
    sendProtobuf(response, await route(actor, await readBody(request, limit)));
  }
}

function handleError(
  response: ServerResponse,
  error: unknown,
  onError: WhiteboardHttpOptions['onError'],
): void {
  const canRespond = !response.destroyed && !response.headersSent;
  const invalidRequest =
    error instanceof CatalogQueryError ||
    error instanceof ArchiveRequestError ||
    error instanceof FeedbackQueryError;
  const routeError = error instanceof HttpRequestError || error instanceof BoardSuggestionError;

  if (routeError || invalidRequest || error instanceof RoomInputError) {
    if (canRespond) {
      sendStatus(response, routeError ? error.status : 400);
    }

    return;
  }

  const forbidden = error instanceof WhiteboardAccessError || error instanceof FeedbackAccessError;
  if (forbidden || error instanceof SharingAccessError || error instanceof RoomAccessError) {
    if (canRespond) {
      sendStatus(response, 403);
    }

    return;
  }

  if (error instanceof RoomCapacityError) {
    if (canRespond) {
      sendStatus(response, 503);
    }

    return;
  }

  if (error instanceof FeedbackThreadNotFoundError) {
    if (canRespond) {
      sendStatus(response, 404);
    }

    return;
  }

  if (canRespond) {
    sendStatus(response, 500);
  }

  onError(error);
}

async function handleGuestRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Routes,
  options: WhiteboardHttpOptions,
  guest: GuestHttpOptions,
) {
  const { sharing } = options;
  if (!sharing) {
    sendStatus(response, 404);
    return;
  }
  if (!allowsGuestOrigin(request, guest)) {
    sendStatus(response, 403);
    return;
  }

  const path = request.url ?? '';
  if (isGuestInvitationPath(path)) {
    await handleGuestInvitation(request, response, sharing, guest);

    return;
  }

  const access = guestAccessForPath(path);
  if (!access) {
    sendStatus(response, 404);
    return;
  }

  await handleRequest(request, response, routes, {
    ...options,
    resolveActor: (incoming) => resolveGuestActor(incoming, sharing, guest, access),
  });
}

export function createWhiteboardRequestHandler(
  options: WhiteboardHttpOptions,
  guest?: GuestHttpOptions,
): RequestListener {
  const { application, catalogApplication, archiveApplication, features, sharing, onError } =
    options;
  const observe = observeRoomChange(features?.rooms, onError);
  const studioRoutes = features
    ? [
        ...createBoardEditRoutes(features.editor, features.digest, observe),
        createVideoEditRoute(features.editor, features.digest, observe),
        createDocumentImageRoute(features.editor, features.digest),
        ...createBoardHistoryRoutes(features.history, features.digest, observe),
        ...createFeedbackRoutes(features.feedback),
        ...(features.rooms ? createRoomRoutes(features.rooms) : []),
        ...(features.suggestions
          ? createBoardSuggestionRoutes(features.suggestions, features.digest, observe)
          : []),
      ]
    : [];
  const routes: Routes = {
    unary: new Map([
      ...createWhiteboardRoutes(application, observe),
      ...studioRoutes,
      ...createCatalogRoutes(catalogApplication),
      createArchiveReceiptRoute(archiveApplication),
      ...(sharing ? createSharingRoutes(sharing) : []),
    ]),
    roomStream: features?.rooms && createRoomEventStreamRoute(features.rooms, onError),
  };

  return (request, response) => {
    const pending = guest
      ? handleGuestRequest(request, response, routes, options, guest)
      : handleRequest(request, response, routes, options);
    pending.catch((error: unknown) => handleError(response, error, onError));
  };
}

export function createWhiteboardHttpServer(options: WhiteboardHttpOptions): Server {
  return createServer(createWhiteboardRequestHandler(options));
}
