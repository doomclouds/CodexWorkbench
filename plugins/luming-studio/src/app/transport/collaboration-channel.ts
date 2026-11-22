import {
  BOARD_OPEN_CHECK,
  BOARD_SCENE_CHECK,
  type BoardOpenKnown,
} from '../../contracts/board-open.js';
import type { StudioClient } from '../../contracts/studio';
import { studioRequest } from './client';

interface CollaborationScope {
  artifactId: string;
  peerId?: string;
  peerEpoch?: string;
  after: string;
}

interface CollaborationStreamHandlers {
  message(data: string): void;
  change(data: string): void;
  reset(data: string): void;
  disconnected(): void;
}

function collaborationEndpoint(
  client: StudioClient,
  mode: 'events' | 'sync',
  scope: CollaborationScope,
): URL {
  const endpoint = new URL(`/api/${mode}`, client.baseUrl);
  endpoint.searchParams.set('artifactId', scope.artifactId);
  if (mode === 'sync') {
    endpoint.searchParams.set('wait', '20000');
  }
  if (scope.peerId) {
    endpoint.searchParams.set('peerId', scope.peerId);
  }
  if (scope.peerEpoch) {
    endpoint.searchParams.set('peerEpoch', scope.peerEpoch);
  }
  if (mode === 'events' && client.token) {
    endpoint.searchParams.set('token', client.token);
  }
  if (scope.after) {
    endpoint.searchParams.set('after', scope.after);
  }

  return endpoint;
}

export function requestCollaborationPoll(
  client: StudioClient,
  scope: CollaborationScope,
  init: RequestInit,
): Promise<Response> {
  return studioRequest(client, collaborationEndpoint(client, 'sync', scope), init);
}

export function requestCollaborationRevision(
  client: StudioClient,
  artifactId: string,
  init: RequestInit,
): Promise<Response> {
  const endpoint = new URL('/api/sync', client.baseUrl);
  endpoint.searchParams.set('artifactId', artifactId);
  endpoint.searchParams.set('check', 'revision');

  return studioRequest(client, endpoint, init);
}

export function requestCollaborationBoard(
  client: StudioClient,
  artifactId: string,
  known: BoardOpenKnown | undefined,
  init: RequestInit,
): Promise<Response> {
  const endpoint = new URL('/api/sync', client.baseUrl);
  endpoint.searchParams.set('artifactId', artifactId);
  endpoint.searchParams.set('check', BOARD_OPEN_CHECK);
  if (known) {
    endpoint.searchParams.set('knownRevision', String(known.revision));
    endpoint.searchParams.set('knownEpoch', known.epoch);
  }

  return studioRequest(client, endpoint, init);
}

export function requestCollaborationScene(
  client: StudioClient,
  artifactId: string,
  init: RequestInit,
) {
  const endpoint = new URL('/api/sync', client.baseUrl);
  endpoint.searchParams.set('artifactId', artifactId);
  endpoint.searchParams.set('check', BOARD_SCENE_CHECK);

  return studioRequest(client, endpoint, init);
}

export function requestCollaborationReplay(
  client: StudioClient,
  scope: Pick<CollaborationScope, 'artifactId' | 'after'>,
  init: RequestInit,
): Promise<Response> {
  const endpoint = collaborationEndpoint(client, 'sync', scope);
  endpoint.searchParams.set('wait', '0');

  return studioRequest(client, endpoint, init);
}

export function openCollaborationStream(
  client: StudioClient,
  scope: CollaborationScope,
  handlers: CollaborationStreamHandlers,
): { close(): void } | undefined {
  if (typeof EventSource === 'undefined') {
    return;
  }

  const endpoint = collaborationEndpoint(client, 'events', scope);
  const stream = new EventSource(endpoint.href);
  stream.onmessage = (message) => handlers.message(message.data);
  stream.addEventListener('change', (message) =>
    handlers.change((message as MessageEvent<string>).data),
  );
  stream.addEventListener('reset', (message) =>
    handlers.reset((message as MessageEvent<string>).data),
  );
  stream.onerror = () => handlers.disconnected();

  return { close: () => stream.close() };
}
