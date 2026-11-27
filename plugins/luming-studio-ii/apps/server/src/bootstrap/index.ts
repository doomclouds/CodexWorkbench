import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  boardSuggestionSubmitPath,
  createWhiteboardHttpServer,
  createWhiteboardRequestHandler,
  type GuestHttpOptions,
} from '../entrypoints/http/index.js';
import { createArchiveImportRepository } from '../infrastructure/adapters/archives/index.js';
import { readBoardAccess } from '../infrastructure/adapters/authorization/index.js';
import { createCatalogRepository } from '../infrastructure/adapters/catalog/index.js';
import { createFeedbackRepository } from '../infrastructure/adapters/feedback/index.js';
import {
  createBoardSuggestionRepository,
  createWhiteboardRepository,
} from '../infrastructure/adapters/index.js';
import { createRoomsRepository } from '../infrastructure/adapters/rooms/index.js';
import { createSharingRepository } from '../infrastructure/adapters/sharing/index.js';
import { openSqliteDatabase } from '../infrastructure/platform/index.js';
import { createArchiveImportApplication } from '../modules/archives/application/index.js';
import { createCatalogApplication } from '../modules/catalog/application/index.js';
import {
  createFeedbackApplication,
  FeedbackThreadNotFoundError,
} from '../modules/feedback/application/index.js';
import {
  createRoomsApplication,
  type RoomsApplication,
} from '../modules/rooms/application/index.js';
import {
  createSharingApplication,
  type SharingApplication,
  type SharingScope,
} from '../modules/sharing/application/index.js';
import {
  createBoardEditorApplication,
  createBoardHistoryApplication,
  createBoardSuggestionApplication,
  createWhiteboardApplication,
} from '../modules/whiteboard/application/index.js';

type HttpOptions = Parameters<typeof createWhiteboardHttpServer>[0];
type HttpServer = ReturnType<typeof createWhiteboardHttpServer>;

export interface WhiteboardServerOptions {
  readonly databasePath: string;
  readonly resolveActor: HttpOptions['resolveActor'];
  readonly onError: HttpOptions['onError'];
  readonly sharing?: {
    readonly inviteOrigin: (scope: SharingScope) => string | undefined;
    readonly activateScope?: (scope: SharingScope) => Promise<void>;
  };
}

export interface WhiteboardServer {
  listen(port?: number): Promise<URL>;
  createGuestHandler(guest: GuestHttpOptions): ReturnType<typeof createWhiteboardRequestHandler>;
  activeSharingScopes(): readonly SharingScope[];
  close(): Promise<void>;
}

const loopback = '127.0.0.1';
const maxPort = 65_535;

function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function equalToken(left: string, right: string) {
  const supplied = Buffer.from(left);
  const expected = Buffer.from(right);

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function listenOnLoopback(server: HttpServer, port: number): Promise<URL> {
  if (!Number.isInteger(port) || port < 0 || port > maxPort) {
    return Promise.reject(new RangeError('The HTTP port must be between 0 and 65535.'));
  }

  return new Promise((resolve, reject) => {
    function handleListenError(error: Error) {
      server.off('listening', handleListening);
      reject(error);
    }

    function handleListening() {
      server.off('error', handleListenError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('The whiteboard service did not obtain a TCP address.'));
        return;
      }

      resolve(new URL('http://' + loopback + ':' + address.port));
    }

    server.once('error', handleListenError);
    server.once('listening', handleListening);
    server.listen(port, loopback);
  });
}

function stopListening(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function createWhiteboardServer(options: WhiteboardServerOptions): WhiteboardServer {
  const database = openSqliteDatabase(options.databasePath);
  let server: HttpServer;
  let httpOptions: HttpOptions;
  let rooms: RoomsApplication;
  let sharing: SharingApplication;
  try {
    const repository = createWhiteboardRepository(database);
    const application = createWhiteboardApplication(repository, Date.now);
    const archives = createArchiveImportRepository(database);
    const catalog = createCatalogRepository(database);
    const catalogApplication = createCatalogApplication(catalog, {
      newBoardId: randomUUID,
      now: Date.now,
    });
    const archiveApplication = createArchiveImportApplication(archives, {
      newBoardId: randomUUID,
      now: Date.now,
    });
    const feedbackRepository = createFeedbackRepository(database);
    const feedback = createFeedbackApplication(feedbackRepository, { now: Date.now, digest });
    const suggestions = createBoardSuggestionApplication(
      createBoardSuggestionRepository(database),
      {
        now: Date.now,
        newId: randomUUID,
        digest,
        readFeedbackSource(actor, boardId, feedbackThreadId) {
          try {
            const { thread } = feedback.getThread(actor, boardId, feedbackThreadId, {
              pageSize: 1,
            });
            const anchor = thread.anchor;

            return {
              capturedBoardRevision: anchor.sourceBoardRevision,
              objectId: anchor.target.kind === 'object' ? anchor.target.objectId : undefined,
            };
          } catch (error) {
            if (error instanceof FeedbackThreadNotFoundError) {
              return undefined;
            }

            throw error;
          }
        },
      },
    );
    const sharingRepository = createSharingRepository(database);
    sharing = createSharingApplication(sharingRepository, {
      now: Date.now,
      digest,
      equalToken,
      newInvitationSeed: () => randomBytes(32).toString('hex'),
      newGuestId: () => 'guest-' + randomUUID(),
      inviteOrigin: options.sharing?.inviteOrigin ?? (() => undefined),
    });
    rooms = createRoomsApplication(
      createRoomsRepository(database, readBoardAccess),
      { nowMillis: Date.now },
      randomUUID(),
    );

    httpOptions = {
      application,
      catalogApplication,
      archiveApplication,
      features: {
        editor: createBoardEditorApplication(repository, Date.now),
        history: createBoardHistoryApplication(repository, Date.now),
        feedback,
        rooms,
        suggestions,
        digest,
      },
      sharing: {
        application: sharing,
        activateScope: options.sharing?.activateScope,
        newBrowserToken: () => randomBytes(32).toString('base64url'),
        onActivationError: options.onError,
        onAccessChanged: (boardId) => rooms.notifyAccessChanged(boardId),
      },
      resolveActor: options.resolveActor,
      agentSuggestionPath: boardSuggestionSubmitPath,
      onError: options.onError,
    };
    server = createWhiteboardHttpServer(httpOptions);
  } catch (error) {
    database.close();
    throw error;
  }

  let starting: Promise<URL> | undefined;
  let closing: Promise<void> | undefined;

  function listen(port = 0) {
    if (closing) {
      return Promise.reject(new Error('The whiteboard service is closed.'));
    }

    starting ??= listenOnLoopback(server, port).catch((error: unknown) => {
      starting = undefined;
      throw error;
    });

    return starting;
  }

  async function shutDown() {
    try {
      rooms.close();
      if (starting) {
        await starting;
        await stopListening(server);
      }
    } finally {
      database.close();
    }
  }

  function close() {
    closing ??= shutDown();

    return closing;
  }

  return {
    listen,
    close,
    activeSharingScopes: () => sharing.activeSharingScopes(),
    createGuestHandler: (guest) => createWhiteboardRequestHandler(httpOptions, guest),
  };
}
