const boardParameter = 'board';
const viewParameter = 'view';
const trashView = 'trash';
const protobufContentType = 'application/protobuf';
const zipContentType = 'application/zip';
const archiveCommandHeader = 'x-studio-command-id';
const archiveTooLargeStatus = 413;
const archiveAssetPath = /^\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/u;
const layoutKey = 'luming-studio-ii:library-layout';
const themeKey = 'luming-studio-ii:theme';

export { prepareBoardImage } from './board-image.js';

type LibraryLayout = 'grid' | 'list';
type StudioTheme = 'light' | 'dark';

export type StudioLocation =
  | { readonly kind: 'workbench' }
  | { readonly kind: 'whiteboard'; readonly boardId: string }
  | { readonly kind: 'recycle-bin' };

export function readStudioLocation(): StudioLocation {
  const query = new URLSearchParams(window.location.search);
  if (query.get(viewParameter) === trashView) {
    return { kind: 'recycle-bin' };
  }

  const boardId = query.get(boardParameter)?.trim();

  return boardId ? { kind: 'whiteboard', boardId } : { kind: 'workbench' };
}

export function createCommandId(): string {
  return crypto.randomUUID();
}

export function resolveArchiveAssetUrl(source: string): string {
  return archiveAssetPath.test(source) ? new URL(source, window.location.origin).href : source;
}

export function writeStudioLocation(location: StudioLocation) {
  const url = new URL(window.location.href);
  url.searchParams.delete(boardParameter);
  url.searchParams.delete(viewParameter);
  if (location.kind === 'whiteboard') {
    url.searchParams.set(boardParameter, location.boardId);
  }
  if (location.kind === 'recycle-bin') {
    url.searchParams.set(viewParameter, trashView);
  }

  if (url.href !== window.location.href) {
    window.history.pushState(null, '', url);
  }
}

export function subscribeStudioLocation(listener: () => void) {
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

async function postBinary(
  path: string,
  body: BodyInit,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('白板服务请求必须使用同源路径。');
  }

  return fetch(path, {
    method: 'POST',
    headers: { ...headers, accept: protobufContentType },
    body,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal,
  });
}

async function readProtobufResponse(response: Response): Promise<Uint8Array> {
  if (!response.ok) {
    throw new Error(`白板服务请求失败（HTTP ${response.status}）。`);
  }

  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== protobufContentType) {
    throw new Error('白板服务返回了无法读取的响应格式。');
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function postProtobuf(
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await postBinary(
    path,
    new Uint8Array(body),
    { 'content-type': protobufContentType },
    signal,
  );

  return readProtobufResponse(response);
}

export async function postArchive(
  path: string,
  file: File,
  commandId: string,
  signal?: AbortSignal,
): Promise<Uint8Array | 'tooLarge'> {
  const response = await postBinary(
    path,
    file,
    { 'content-type': zipContentType, [archiveCommandHeader]: commandId },
    signal,
  );

  if (response.status === archiveTooLargeStatus) {
    return 'tooLarge';
  }

  return readProtobufResponse(response);
}

export function readHtmlSource(file: File): Promise<string> {
  return file.text();
}

interface BoardDownload {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export function downloadBoardFile({ filename, mimeType, content }: BoardDownload): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(content)], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;

  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
