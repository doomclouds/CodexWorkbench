import { afterEach, beforeEach } from 'vitest';
import { createWhiteboardServer } from '../../src/bootstrap/index.js';
import { actorHeader } from '../support/whiteboard-client.js';
import { createTemporaryDatabase, seedWhiteboardDatabase } from '../support/whiteboard-database.js';

export function useWhiteboardTestServer() {
  let database: ReturnType<typeof createTemporaryDatabase> | undefined;
  let server: ReturnType<typeof createWhiteboardServer> | undefined;
  let address: URL | undefined;
  let errors: unknown[];

  async function start() {
    if (!database) {
      throw new Error('The test database has not been created');
    }

    server = createWhiteboardServer({
      databasePath: database.path,
      resolveActor(request) {
        const actorId = request.headers[actorHeader];

        return typeof actorId === 'string' ? { id: actorId } : undefined;
      },
      onError(error) {
        errors.push(error);
      },
    });
    address = await server.listen();
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
