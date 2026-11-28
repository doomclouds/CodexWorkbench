import type { IncomingMessage, ServerResponse } from 'node:http';
import { create, toBinary } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type { CatalogChangeEvents } from '../../modules/catalog/application/index.js';
import { decodeRequest, HttpRequestError, readBody } from './request.js';
import { sendProtobuf, sendStatus } from './response.js';
import { canReadTrashedBoard, type HttpActor } from './unary-route.js';

const method = BoardCatalogService.method.waitForBoardCatalogChange;
export const catalogChangeWaitPath = `/${method.parent.typeName}/${method.name}`;
const waitMs = 20_000;
const maxCursorLength = 128;

function wait(changes: CatalogChangeEvents, response: ServerResponse) {
  return new Promise<void>((resolve) => {
    const stop = changes.subscribe(finish);
    const timer = setTimeout(finish, waitMs);
    timer.unref();
    response.once('close', finish);

    function finish() {
      stop();
      clearTimeout(timer);
      response.off('close', finish);
      resolve();
    }
  });
}

export async function serveCatalogChangeWait(
  changes: CatalogChangeEvents,
  request: IncomingMessage,
  response: ServerResponse,
  actor: HttpActor,
): Promise<void> {
  if (!canReadTrashedBoard(actor)) {
    sendStatus(response, 403);
    return;
  }

  const input = decodeRequest(method.input, await readBody(request, 512));
  actor.authorize?.(input);
  if (input.afterCursor.length > maxCursorLength) {
    throw new HttpRequestError(400, 'The catalog change cursor is too long.');
  }

  if (!changes.closed && !response.destroyed && input.afterCursor === changes.cursor) {
    await wait(changes, response);
  }
  if (response.destroyed) {
    return;
  }

  const output = create(method.output, { catalogCursor: changes.cursor });
  sendProtobuf(response, toBinary(method.output, output));
}
