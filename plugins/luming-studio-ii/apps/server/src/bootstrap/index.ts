import { randomUUID } from 'node:crypto';
import { createWhiteboardHttpServer } from '../entrypoints/http/index.js';
import { createArchiveImportRepository } from '../infrastructure/adapters/archives/index.js';
import { createCatalogRepository } from '../infrastructure/adapters/catalog/index.js';
import { createWhiteboardRepository } from '../infrastructure/adapters/index.js';
import { openSqliteDatabase } from '../infrastructure/platform/index.js';
import { createArchiveImportApplication } from '../modules/archives/application/index.js';
import { createCatalogApplication } from '../modules/catalog/application/index.js';
import { createWhiteboardApplication } from '../modules/whiteboard/application/index.js';

type HttpOptions = Parameters<typeof createWhiteboardHttpServer>[0];
type HttpServer = ReturnType<typeof createWhiteboardHttpServer>;

export interface WhiteboardServerOptions {
  readonly databasePath: string;
  readonly resolveActor: HttpOptions['resolveActor'];
  readonly onError: HttpOptions['onError'];
}

export interface WhiteboardServer {
  listen(port?: number): Promise<URL>;
  close(): Promise<void>;
}

const loopback = '127.0.0.1';
const maxPort = 65_535;

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
  try {
    const repository = createWhiteboardRepository(database);
    const application = createWhiteboardApplication(repository);
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

    server = createWhiteboardHttpServer({
      application,
      catalogApplication,
      archiveApplication,
      resolveActor: options.resolveActor,
      onError: options.onError,
    });
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

  return { listen, close };
}
