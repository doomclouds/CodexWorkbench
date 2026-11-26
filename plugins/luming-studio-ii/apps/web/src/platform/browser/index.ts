const boardParameter = 'board';
const protobufContentType = 'application/protobuf';
const layoutKey = 'luming-studio-ii:library-layout';
const themeKey = 'luming-studio-ii:theme';

type LibraryLayout = 'grid' | 'list';
type StudioTheme = 'light' | 'dark';

export function readBoardId(): string | undefined {
  const query = new URLSearchParams(window.location.search);

  return query.get(boardParameter)?.trim() || undefined;
}

export function createCommandId(): string {
  return crypto.randomUUID();
}

export function writeBoardLocation(boardId?: string) {
  const url = new URL(window.location.href);
  if (boardId) {
    url.searchParams.set(boardParameter, boardId);
  } else {
    url.searchParams.delete(boardParameter);
  }

  if (url.href !== window.location.href) {
    window.history.pushState(null, '', url);
  }
}

export function subscribeBoardLocation(listener: () => void) {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

export function readPreferences(): { layout: LibraryLayout; resolvedTheme: StudioTheme } {
  const layout = window.localStorage.getItem(layoutKey);
  const theme = window.localStorage.getItem(themeKey);
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  return {
    layout: layout === 'list' ? 'list' : 'grid',
    resolvedTheme: theme === 'light' || theme === 'dark' ? theme : systemTheme,
  };
}

export function rememberLayout(layout: LibraryLayout) {
  window.localStorage.setItem(layoutKey, layout);
}

export function rememberTheme(theme: StudioTheme) {
  window.localStorage.setItem(themeKey, theme);
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
