import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';

export type GuestWebScope = 'local' | 'lan';

interface WebAsset {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

type GuestWebAssets = (pathname: string) => Promise<WebAsset | undefined>;

export interface GuestWebOptions {
  readonly loadAssets: () => Promise<GuestWebAssets>;
  readonly lanHost: () => string;
  readonly lanPort?: number;
  readonly createHandler: (
    scope: GuestWebScope,
    origin: () => string | undefined,
  ) => RequestListener;
  readonly onError?: (error: unknown) => void;
}

const loopback = '127.0.0.1';
const originProtocol = 'http://';

async function sendAsset(
  read: GuestWebAssets,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const asset = await read(path);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }

  response
    .writeHead(200, {
      'content-type': asset.contentType,
      'content-length': asset.bytes.byteLength,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    })
    .end(request.method === 'HEAD' ? undefined : asset.bytes);
}

function listener(
  read: GuestWebAssets,
  guest: RequestListener,
  onError: GuestWebOptions['onError'],
): RequestListener {
  return (request, response) => {
    response.setHeader('referrer-policy', 'no-referrer');
    const path = request.url?.split('?', 1)[0] ?? '/';
    const asset = path === '/' || path.startsWith('/assets/');
    const readable = request.method === 'GET' || request.method === 'HEAD';
    if (asset && readable) {
      sendAsset(read, path, request, response).catch((error: unknown) => {
        onError?.(error);
        response.writeHead(500).end();
      });

      return;
    }

    guest(request, response);
  };
}

type GuestListener = Awaited<ReturnType<typeof startGuestListener>>;

async function startGuestListener(options: GuestWebOptions, scope: GuestWebScope) {
  const host = scope === 'local' ? loopback : options.lanHost();
  const port = scope === 'lan' ? (options.lanPort ?? 0) : 0;
  const read = await options.loadAssets();
  const listenerState: { origin?: string } = {};
  const guest = options.createHandler(scope, () => listenerState.origin);
  const server = createServer(listener(read, guest, options.onError));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Studio sharing did not get an HTTP address.');
  }

  const hostname = address.family === 'IPv6' ? '[' + address.address + ']' : address.address;
  const origin = originProtocol + hostname + ':' + address.port;
  listenerState.origin = origin;
  function close() {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
      server.closeAllConnections();
    });
  }

  return { origin, close };
}

export function createGuestWeb(options: GuestWebOptions) {
  const starts = new Map<GuestWebScope, Promise<GuestListener>>();
  const available = new Map<GuestWebScope, GuestListener>();
  let closing = false;
  let shutdown: Promise<void> | undefined;

  async function activate(scope: GuestWebScope) {
    if (closing) {
      throw new Error('Studio is shutting down.');
    }

    const starting = starts.get(scope) ?? startGuestListener(options, scope);
    starts.set(scope, starting);
    try {
      const listener = await starting;
      if (!closing) {
        available.set(scope, listener);
      }
    } catch (error) {
      if (starts.get(scope) === starting) {
        starts.delete(scope);
      }
      throw error;
    }
  }

  async function closeListeners() {
    closing = true;
    const started = await Promise.allSettled(starts.values());
    starts.clear();
    available.clear();
    const listeners = started.filter((entry) => entry.status === 'fulfilled');
    await Promise.all(listeners.map(({ value }) => value.close()));
  }

  function close() {
    shutdown ??= closeListeners();

    return shutdown;
  }

  return { activate, origin: (scope: GuestWebScope) => available.get(scope)?.origin, close };
}
