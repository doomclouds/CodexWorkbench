import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  WhiteboardAccessError,
  type Actor,
  type WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError, readBody } from './request.js';
import { createRoutes } from './routes.js';

const PROTOBUF_CONTENT_TYPE = 'application/protobuf';
const REQUEST_METHOD = 'POST';

export interface WhiteboardHttpOptions {
  readonly application: WhiteboardApplication;
  readonly resolveActor: (request: IncomingMessage) => Actor | undefined;
  readonly onError: (error: unknown) => void;
}

type Routes = ReturnType<typeof createRoutes>;

function sendStatus(response: ServerResponse, status: number): void {
  if (status === 413) {
    response.setHeader('connection', 'close');
  }

  response.writeHead(status, { 'cache-control': 'no-store', 'content-length': 0 }).end();
}

function acceptsProtobuf(request: IncomingMessage): boolean {
  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === PROTOBUF_CONTENT_TYPE;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Routes,
  resolveActor: WhiteboardHttpOptions['resolveActor'],
): Promise<void> {
  const route = routes.get(request.url ?? '');
  if (!route) {
    sendStatus(response, 404);
    return;
  }

  if (request.method !== REQUEST_METHOD) {
    response.setHeader('allow', REQUEST_METHOD);
    sendStatus(response, 405);
    return;
  }

  const actor = resolveActor(request);
  if (!actor) {
    sendStatus(response, 401);
    return;
  }

  if (!acceptsProtobuf(request)) {
    sendStatus(response, 415);
    return;
  }

  const body = await readBody(request);
  const result = route(actor, body);

  response.writeHead(200, {
    'content-type': PROTOBUF_CONTENT_TYPE,
    'content-length': result.byteLength,
    'cache-control': 'no-store',
  });
  response.end(result);
}

function handleError(
  response: ServerResponse,
  error: unknown,
  onError: WhiteboardHttpOptions['onError'],
): void {
  const canRespond = !response.destroyed && !response.headersSent;
  if (error instanceof HttpRequestError) {
    if (canRespond) {
      sendStatus(response, error.status);
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
  const { application, resolveActor, onError } = options;
  const routes = createRoutes(application);

  return createServer((request, response) => {
    handleRequest(request, response, routes, resolveActor).catch((error: unknown) =>
      handleError(response, error, onError),
    );
  });
}
