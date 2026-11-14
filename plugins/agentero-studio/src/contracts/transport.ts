export const APP_CHUNK_BYTES = 128 * 1024;
export const APP_MAX_BYTES = 128 * 1024 * 1024;
export const APP_TOOL_NAME = 'studio_app_request';

export interface AppRequest {
  action: 'request';
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  uploadId?: string;
}
export interface AppUpload { action: 'upload'; transferId?: string; offset: number; size: number; data: string }
export interface AppDownload { action: 'download'; transferId: string; offset: number }
export interface AppRelease { action: 'release'; transferId: string }
export type AppTransportInput = AppRequest | AppUpload | AppDownload | AppRelease;
export interface AppResponse { status: number; headers: Record<string, string>; body?: string; downloadId?: string; size: number }
export interface AppUploadResult { transferId: string; nextOffset: number }
export interface AppDownloadResult { data: string; nextOffset: number; done: boolean }
export interface AppReleaseResult { released: boolean }
export type AppTransportResult = AppResponse | AppUploadResult | AppDownloadResult | AppReleaseResult;

/** Internal HTTP request after validating the app-only envelope. */
export interface UiHttpRequest { path: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: Uint8Array }
export type UiRequester = (request: UiHttpRequest, signal?: AbortSignal) => Promise<Response>;
