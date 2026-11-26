const boardParameter = 'board';
const protobufContentType = 'application/protobuf';

export function readBoardId(): string | undefined {
  const query = new URLSearchParams(window.location.search);

  return query.get(boardParameter)?.trim() || undefined;
}

export function createCommandId(): string {
  return crypto.randomUUID();
}

export async function postProtobuf(
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('白板服务请求必须使用同源路径。');
  }

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': protobufContentType, accept: protobufContentType },
    body: new Uint8Array(body),
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal,
  });

  if (!response.ok) {
    throw new Error(`白板服务请求失败（HTTP ${response.status}）。`);
  }

  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== protobufContentType) {
    throw new Error('白板服务返回了无法读取的响应格式。');
  }

  return new Uint8Array(await response.arrayBuffer());
}
