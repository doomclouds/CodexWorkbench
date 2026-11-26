import { timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { createWhiteboardServer } from './index.js';

const authPrefix = 'Bearer ';
const databaseVariable = 'LUMING_STUDIO_II_DB';
const actorVariable = 'LUMING_STUDIO_II_ACTOR';
const tokenVariable = 'LUMING_STUDIO_II_TOKEN';
const portVariable = 'LUMING_STUDIO_II_PORT';

function readSetting(name: string) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error('Set ' + name + ' before starting the whiteboard service.');
  }

  return value;
}

const actor = { id: readSetting(actorVariable) };
const token = Buffer.from(readSetting(tokenVariable), 'utf8');
const runtime = createWhiteboardServer({
  databasePath: readSetting(databaseVariable),
  resolveActor(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith(authPrefix)) {
      return undefined;
    }

    const supplied = Buffer.from(header.slice(authPrefix.length), 'utf8');

    return supplied.length === token.length && timingSafeEqual(supplied, token) ? actor : undefined;
  },
  onError(error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write('Whiteboard request failed (' + name + ').\n');
  },
});

try {
  const address = await runtime.listen(Number(process.env[portVariable] ?? '0'));
  process.stdout.write(address.origin + '\n');
} catch (error) {
  await runtime.close();
  throw error;
}

function handleShutdown() {
  runtime.close().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('Could not stop the whiteboard service. ' + message + '\n');
    process.exitCode = 1;
  });
}

process.once('SIGINT', handleShutdown);
process.once('SIGTERM', handleShutdown);
