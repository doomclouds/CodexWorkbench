import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces, userInfo } from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createGuestWeb } from '../entrypoints/http/index.js';
import { loadGuestWebAssets } from '../infrastructure/platform/index.js';
import { createWhiteboardServer } from './index.js';

const authPrefix = 'Bearer ';
const databaseVariable = 'LUMING_STUDIO_II_DB';
const actorVariable = 'LUMING_STUDIO_II_ACTOR';
const tokenVariable = 'LUMING_STUDIO_II_TOKEN';
const agentTokenVariable = 'LUMING_STUDIO_II_AGENT_TOKEN';
const portVariable = 'LUMING_STUDIO_II_PORT';
const webRootVariable = 'LUMING_STUDIO_II_WEB_ROOT';
const lanHostVariable = 'LUMING_STUDIO_II_LAN_HOST';
const lanPortVariable = 'LUMING_STUDIO_II_LAN_PORT';
const privateAddress = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;

function readSetting(name: string) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error('Set ' + name + ' before starting the whiteboard service.');
  }

  return value;
}

function lanHost() {
  const configured = process.env[lanHostVariable];
  if (configured) {
    return configured;
  }

  const addresses = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []);
  const available = addresses.find(
    ({ internal, family, address }) =>
      family === 'IPv4' && !internal && privateAddress.test(address),
  );

  if (!available) {
    throw new Error('No local network address is available for Studio sharing.');
  }

  return available.address;
}

const actorId = readSetting(actorVariable);
const token = Buffer.from(readSetting(tokenVariable), 'utf8');
const agentSecret = process.env[agentTokenVariable]?.trim();
const agentToken = agentSecret ? Buffer.from(agentSecret, 'utf8') : undefined;

function matchesToken(supplied: Uint8Array, expected: Uint8Array | undefined) {
  return (
    expected !== undefined &&
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}

if (matchesToken(token, agentToken)) {
  throw new Error('Studio App and Agent credentials must be distinct.');
}

function reportFailure(error: unknown) {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write('Whiteboard request failed (' + name + ').\n');
}

function readOwnerDisplayName() {
  try {
    return userInfo().username;
  } catch (error) {
    reportFailure(error);
    return undefined;
  }
}

const guestWeb = createGuestWeb({
  loadAssets: () =>
    loadGuestWebAssets(
      process.env[webRootVariable] ??
        fileURLToPath(new URL('../../../web/dist/app/', import.meta.url)),
    ),
  lanHost,
  lanPort: Number(process.env[lanPortVariable] ?? '0'),
  createHandler: (scope, origin) => runtime.createGuestHandler({ scope, origin }),
  onError: reportFailure,
});
const runtime: ReturnType<typeof createWhiteboardServer> = createWhiteboardServer({
  databasePath: readSetting(databaseVariable),
  resolveActor(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith(authPrefix)) {
      return undefined;
    }

    const supplied = Buffer.from(header.slice(authPrefix.length), 'utf8');

    if (matchesToken(supplied, token)) {
      return { id: actorId, kind: 'human' as const };
    }

    if (matchesToken(supplied, agentToken)) {
      const author = request.headers['x-studio-feedback-agent-id'];
      const feedbackAuthorId =
        typeof author === 'string' && /^agent-[A-Za-z0-9_-]{1,128}$/u.test(author)
          ? author
          : undefined;

      return { id: actorId, kind: 'agent' as const, feedbackAuthorId };
    }

    return undefined;
  },
  onError: reportFailure,
  sharing: {
    inviteOrigin: guestWeb.origin,
    activateScope: guestWeb.activate,
    ownerDisplayName: readOwnerDisplayName(),
  },
});

try {
  const address = await runtime.listen(Number(process.env[portVariable] ?? '0'));
  await Promise.all(
    runtime.activeSharingScopes().map((scope) => guestWeb.activate(scope).catch(reportFailure)),
  );
  process.stdout.write(address.origin + '\n');
} catch (error) {
  await runtime.close();
  throw error;
}

async function shutdown() {
  try {
    await guestWeb.close();
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  }

  await runtime.close();
}

function handleShutdown() {
  shutdown().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('Could not stop the whiteboard service. ' + message + '\n');
    process.exitCode = 1;
  });
}

process.once('SIGINT', handleShutdown);
process.once('SIGTERM', handleShutdown);
