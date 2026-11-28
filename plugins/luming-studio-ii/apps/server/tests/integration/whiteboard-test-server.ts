import { afterEach, beforeEach } from 'vitest';
import { createWhiteboardServer } from '../../src/bootstrap/index.js';
import { actorHeader } from '../support/whiteboard-client.js';
import { createTemporaryDatabase, seedWhiteboardDatabase } from '../support/whiteboard-database.js';

const listenAttempts = 6;
const probeTimeout = 3_000;

function isBlockedFetchPort(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;

  return cause instanceof Error && cause.message === 'bad port';
}

type ResolveTestActor = Parameters<typeof createWhiteboardServer>[0]['resolveActor'];

function resolveTestActor(request: Parameters<ResolveTestActor>[0]) {
  const actorId = request.headers[actorHeader];

  return typeof actorId === 'string' ? { id: actorId } : undefined;
}

export function useWhiteboardTestServer(resolveActor: ResolveTestActor = resolveTestActor) {
  let database: ReturnType<typeof createTemporaryDatabase> | undefined;
  let server: ReturnType<typeof createWhiteboardServer> | undefined;
  let address: URL | undefined;
  let errors: unknown[];

  function openServer(databasePath: string) {
    return createWhiteboardServer({
      databasePath,
      resolveActor,
      onError(error) {
        errors.push(error);
      },
    });
  }

  async function start() {
    if (!database) {
      throw new Error('The test database has not been created');
    }

    let lastError: unknown;
    for (let count = 0; count < listenAttempts; count++) {
      const instance = openServer(database.path);
      try {
        const url = await instance.listen();
        await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(probeTimeout) });
        server = instance;
        address = url;

        return;
      } catch (error) {
        await instance.close();
        if (!isBlockedFetchPort(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new Error('No test listener accepted a Fetch request.', { cause: lastError });
  }

  beforeEach(async () => {
    database = createTemporaryDatabase();
    errors = [];
    seedWhiteboardDatabase(database.path);
    await start();
  });

  afterEach(async () => {
    try {
      await server?.close();
    } finally {
      database?.dispose();
      database = undefined;
      server = undefined;
      address = undefined;
    }
  });

  return {
    get address() {
      if (!address) {
        throw new Error('The test server has not started');
      }

      return address;
    },
    get databasePath() {
      if (!database) {
        throw new Error('The test database has not been created');
      }

      return database.path;
    },
    get errors() {
      return errors;
    },
    async restart() {
      await server?.close();
      server = undefined;
      address = undefined;
      await start();
    },
  };
}
