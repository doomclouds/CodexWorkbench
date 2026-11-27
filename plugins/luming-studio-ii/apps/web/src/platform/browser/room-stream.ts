import { createGrpcWebTransport } from '@connectrpc/connect-web';

export function createRoomStreamTransport(mode: 'owner' | 'guest', request: typeof fetch = fetch) {
  return createGrpcWebTransport({
    baseUrl: window.location.origin,
    useBinaryFormat: true,
    fetch(input, init) {
      const headers = new Headers(init?.headers);
      if (mode === 'guest') {
        headers.set('x-luming-guest', '1');
      }

      return request(input, {
        ...init,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
    },
  });
}
