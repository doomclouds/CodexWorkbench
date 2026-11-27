import { maximumImageBytes } from './board-image.js';

const boardParameter = 'board';
const invitationParameter = 'invite';
const viewParameter = 'view';
const trashView = 'trash';
const protobufContentType = 'application/protobuf';
const zipContentType = 'application/zip';
const archiveCommandHeader = 'x-studio-command-id';
const archiveTooLargeStatus = 413;
const archiveAssetPath = /^\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/u;
const layoutKey = 'luming-studio-ii:library-layout';
const themeKey = 'luming-studio-ii:theme';
const darkColorScheme = '(prefers-color-scheme: dark)';
const guestAccessInterval = 3_000;
const guestRequestHeaders = { 'x-luming-guest': '1', 'content-type': protobufContentType };

export { createBoardDraftStorage } from './board-drafts.js';
export { prepareBoardImage } from './board-image.js';
export { prepareBoardVideo } from './board-video.js';
export { renderBrowserVectorExport } from './board-vector.js';
export { boardRoomClock, subscribeGuestRoomEvents, subscribeRoomEvents } from './room-events.js';
export { createRoomStreamTransport } from './room-stream.js';

type LibraryLayout = 'grid' | 'list';
type StudioTheme = 'light' | 'dark';

export type StudioLocation =
  | { readonly kind: 'workbench' }
  | { readonly kind: 'whiteboard'; readonly boardId: string }
  | { readonly kind: 'recycle-bin' };

export function readStudioGuestEntry() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const boardId = url.searchParams.get(boardParameter)?.trim();
  const invitationToken = fragment.get(invitationParameter);
  if (invitationToken !== null) {
    return boardId && invitationToken
      ? { kind: 'invitation' as const, boardId, invitationToken }
      : { kind: 'invalid' as const };
  }

  const guestHost = document.documentElement.dataset.studioGuestEntry === 'true';
  const guestNavigation = window.history.state?.studioGuest === true;
  if (guestHost || guestNavigation) {
    return boardId ? { kind: 'board' as const, boardId } : { kind: 'restricted' as const };
  }
}

export function replaceStudioGuestLocation(boardId?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(boardParameter);
  url.searchParams.delete(viewParameter);
  url.hash = '';
  if (boardId) {
    url.searchParams.set(boardParameter, boardId);
  }
  window.history.replaceState({ studioGuest: true }, '', url);
}

export function subscribeGuestAccessRefresh(listener: () => void): () => void {
  const timer = window.setInterval(listener, guestAccessInterval);
  window.addEventListener('focus', listener);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', listener);
  };
}

export function readStudioLocation(): StudioLocation {
  const query = new URLSearchParams(window.location.search);
  if (query.get(viewParameter) === trashView) {
    return { kind: 'recycle-bin' };
  }

  const boardId = query.get(boardParameter)?.trim();

  return boardId ? { kind: 'whiteboard', boardId } : { kind: 'workbench' };
}

export function createCommandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function resolveArchiveAssetUrl(source: string): string {
  return archiveAssetPath.test(source) ? new URL(source, window.location.origin).href : source;
}

export async function readDocumentImageFile(file: File): Promise<Uint8Array> {
  if (file.size <= 0 || file.size > maximumImageBytes) {
    throw new Error('文档图片的大小必须在 20 MiB 以内。');
  }

  return new Uint8Array(await file.arrayBuffer());
}

export async function readArchivedDocumentAsset(
  boardId: string,
  source: string,
  signal?: AbortSignal,
) {
  const { origin } = window.location;
  if (!URL.canParse(source, origin)) {
    return undefined;
  }

  const url = new URL(source, origin);
  const path = url.pathname;
  const boardPrefix = '/studio-archive-assets/' + boardId + '/';
  const sameAssetOrigin = url.origin === origin && !url.search && !url.hash;
  const boardAsset = path.startsWith(boardPrefix) && archiveAssetPath.test(path);
  if (!sameAssetOrigin || !boardAsset) {
    return undefined;
  }

  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal });
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0];
  if (!response.ok || !mimeType?.startsWith('image/')) {
    return undefined;
  }

  return { mimeType, content: new Uint8Array(await response.arrayBuffer()) };
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
  window.addEventListener('hashchange', listener);

  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
}

function preferredTheme(systemPrefersDark: boolean): StudioTheme {
  const theme = window.localStorage.getItem(themeKey);
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }

  return systemPrefersDark ? 'dark' : 'light';
}

export function readPreferences(): { layout: LibraryLayout; resolvedTheme: StudioTheme } {
  const layout = window.localStorage.getItem(layoutKey);
  return {
    layout: layout === 'list' ? 'list' : 'grid',
    resolvedTheme: preferredTheme(window.matchMedia(darkColorScheme).matches),
  };
}

export function rememberLayout(layout: LibraryLayout) {
  window.localStorage.setItem(layoutKey, layout);
}

export function rememberTheme(theme: StudioTheme) {
  window.localStorage.setItem(themeKey, theme);
}

export function subscribeTheme(listener: (theme: StudioTheme) => void): () => void {
  const media = window.matchMedia(darkColorScheme);

  function updateTheme() {
    listener(preferredTheme(media.matches));
  }

  media.addEventListener('change', updateTheme);
  updateTheme();
  return () => media.removeEventListener('change', updateTheme);
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
    throw new StudioHttpError(response.status);
  }

  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== protobufContentType) {
    throw new Error('白板服务返回了无法读取的响应格式。');
  }

  return new Uint8Array(await response.arrayBuffer());
}

export class StudioHttpError extends Error {
  constructor(readonly status: number) {
    super(`白板服务请求失败（HTTP ${status}）。`);
  }
}

export function isGuestAccessDenied(error: unknown): boolean {
  return error instanceof StudioHttpError && (error.status === 401 || error.status === 403);
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

export async function postGuestProtobuf(
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await postBinary(path, new Uint8Array(body), guestRequestHeaders, signal);

  return readProtobufResponse(response);
}

export async function copyShareLink(url: string): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error('当前浏览器无法访问剪贴板，请手动复制链接。');
  }

  await navigator.clipboard.writeText(url);
}

export async function readCanvasClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) {
    throw new Error('当前浏览器无法直接读取剪贴板，请按 Ctrl/⌘ V 粘贴。');
  }

  return navigator.clipboard.readText();
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
  const type = mimeType === 'text/html' ? 'application/octet-stream' : mimeType;
  const url = URL.createObjectURL(new Blob([new Uint8Array(content)], { type }));
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
