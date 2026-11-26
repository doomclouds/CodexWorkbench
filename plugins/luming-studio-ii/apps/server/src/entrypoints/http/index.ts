import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  ArchiveRequestError,
  type ArchiveImportApplication,
} from '../../modules/archives/application/index.js';
import {
  CatalogQueryError,
  type CatalogApplication,
} from '../../modules/catalog/application/index.js';
import {
  WhiteboardAccessError,
  type WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { archiveRoute, createArchiveReceiptRoute } from './archive-routes.js';
import { createCatalogRoutes } from './catalog-routes.js';
import { HttpRequestError, mediaType, readBody } from './request.js';
import { protobufContentType, sendProtobuf, sendStatus } from './response.js';
import { createWhiteboardRoutes } from './routes.js';
import type { HttpActor, ProtobufRoute } from './unary-route.js';

const REQUEST_METHOD = 'POST';

export interface WhiteboardHttpOptions {
  readonly application: WhiteboardApplication;
  readonly catalogApplication: CatalogApplication;
  readonly archiveApplication: ArchiveImportApplication;
  readonly resolveActor: (request: IncomingMessage) => HttpActor | undefined;
  readonly onError: (error: unknown) => void;
}

type Routes = ReadonlyMap<string, ProtobufRoute>;

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Routes,
  { archiveApplication, resolveActor }: WhiteboardHttpOptions,
): Promise<void> {
  const path = request.url ?? '';
  const route = routes.get(path);
  const rawRoute = archiveRoute(path, archiveApplication);
  if (!route && !rawRoute) {
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

  if (rawRoute) {
    await rawRoute.run(actor, request, response);
    return;
  }
  if (mediaType(request) !== protobufContentType) {
    sendStatus(response, 415);
    return;
  }

  if (route) {
    sendProtobuf(response, route(actor, await readBody(request)));
  }
}

function handleError(
  response: ServerResponse,
  error: unknown,
  onError: WhiteboardHttpOptions['onError'],
): void {
  const canRespond = !response.destroyed && !response.headersSent;
  if (
    error instanceof HttpRequestError ||
    error instanceof CatalogQueryError ||
    error instanceof ArchiveRequestError
  ) {
    if (canRespond) {
      sendStatus(response, error instanceof HttpRequestError ? error.status : 400);
    }

    return;
  }

  if (error instanceof WhiteboardAccessError) {
    if (canRespond) {
      sendStatus(response, 403);
    }

    return;
  }

  if (canRespond) {
    sendStatus(response, 500);
  }

  onError(error);
}

export function createWhiteboardHttpServer(options: WhiteboardHttpOptions): Server {
  const { application, catalogApplication, archiveApplication, onError } = options;
  const routes = new Map([
    ...createWhiteboardRoutes(application),
    ...createCatalogRoutes(catalogApplication),
    createArchiveReceiptRoute(archiveApplication),
  ]);

  return createServer((request, response) => {
    handleRequest(request, response, routes, options).catch((error: unknown) =>
      handleError(response, error, onError),
    );
  });
}
