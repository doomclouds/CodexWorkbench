import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach } from 'vitest';
import { createWhiteboardServer } from '../../src/bootstrap/index.js';
import { actorHeader } from '../support/whiteboard-client.js';
import { createTemporaryDatabase } from '../support/whiteboard-database.js';

type Scope = 'local' | 'lan';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  return new URL('http://127.0.0.1:' + address.port);
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function sharableAddress(addresses: Map<Scope, URL>, scope: Scope) {
  const address = addresses.get(scope);
  assert.ok(address);

  return address;
}

function fetchable(address: URL) {
  return fetch(address, { method: 'HEAD', signal: AbortSignal.timeout(3_000) });
}

async function start(
  databasePath: string,
  activated: Scope[],
  errors: unknown[],
  failActivation: () => boolean,
) {
  const addresses = new Map<Scope, URL>();
  const runtime = createWhiteboardServer({
    databasePath,
    resolveActor(request) {
      const id = request.headers[actorHeader];

      return typeof id === 'string' ? { id } : undefined;
    },
    sharing: {
      inviteOrigin: (scope) => addresses.get(scope)?.origin,
      activateScope(scope) {
        activated.push(scope);

        return failActivation()
          ? Promise.reject(new Error('Could not bind sharing listener.'))
          : Promise.resolve();
      },
    },
    onError: (error) => errors.push(error),
  });
  const guests: Server[] = [];

  async function stop() {
    try {
      await Promise.all(guests.map(close));
    } finally {
      await runtime.close();
    }
  }

  try {
    const owner = await runtime.listen();
    await fetchable(owner);

    for (const scope of ['local', 'lan'] as const) {
      const handler = runtime.createGuestHandler({
        scope,
        origin: () => addresses.get(scope)?.origin,
      });
      const guest = createServer(handler);
      const address = await listen(guest);
      guests.push(guest);
      addresses.set(scope, address);
      await fetchable(address);
    }

    return {
      owner,
      guest: (scope: Scope) => sharableAddress(addresses, scope),
      activeSharingScopes: () => runtime.activeSharingScopes(),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function useSharingTestServer() {
  let database: ReturnType<typeof createTemporaryDatabase>;
  let server: Awaited<ReturnType<typeof start>>;
  let activated: Scope[];
  let errors: unknown[];
  let failActivation = false;

  function activationFails() {
    return failActivation;
  }

  async function open() {
    let lastError: unknown;

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        server = await start(database.path, activated, errors, activationFails);

        return;
      } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        if (!(cause instanceof Error) || cause.message !== 'bad port') {
          throw error;
        }

        lastError = error;
      }
    }

    throw new Error('No test sharing listener accepted a Fetch request.', { cause: lastError });
  }

  beforeEach(async () => {
    database = createTemporaryDatabase();
    activated = [];
    errors = [];
    failActivation = false;
    await open();
  });

  afterEach(async () => {
    try {
      await server?.stop();
    } finally {
      database.dispose();
    }
  });

  return {
    get owner() {
      return server.owner;
    },
    guest: (scope: Scope) => server.guest(scope),
    activeSharingScopes: () => server.activeSharingScopes(),
    get databasePath() {
      return database.path;
    },
    get activated() {
      return activated;
    },
    get errors() {
      return errors;
    },
    failActivation() {
      failActivation = true;
    },
    async restart() {
      await server.stop();
      await open();
    },
  };
}
