import type { App } from '@modelcontextprotocol/ext-apps';
import { encodeChunk } from './protocol.js';

interface DownloadRequest {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
}

const maximumBytes = 128 * 1024 * 1024;

function invalidFilename(filename: string) {
  const invalidLength = !filename || filename.length > 255;
  const dotSegment = filename === '.' || filename === '..';
  const invalidCharacter = Array.from(filename).some((character) => {
    const code = character.charCodeAt(0);
    const control = code < 32 || code === 127;
    return control || '/\\'.includes(character);
  });

  return invalidLength || dotSegment || invalidCharacter;
}

export function createMcpDownload(app: App, lifetime: AbortSignal) {
  return async ({ filename, mimeType, content }: DownloadRequest, requestSignal?: AbortSignal) => {
    const signal = requestSignal ? AbortSignal.any([lifetime, requestSignal]) : lifetime;
    signal.throwIfAborted();
    if (!app.getHostCapabilities()?.downloadFile) {
      return {
        kind: 'unavailable' as const,
        message: '当前宿主不提供文件下载。请在浏览器中打开白板后导出。',
      };
    }
    if (content.byteLength > maximumBytes) {
      throw new Error('文件超过宿主下载大小上限。请缩小导出范围。');
    }
    if (invalidFilename(filename)) {
      throw new Error('导出文件名无效。');
    }

    const result = await app.downloadFile(
      {
        contents: [
          {
            type: 'resource',
            resource: {
              uri: 'file:///' + encodeURIComponent(filename),
              mimeType,
              blob: encodeChunk(content),
            },
          },
        ],
      },
      { signal },
    );
    signal.throwIfAborted();
    if (result.isError) {
      throw new Error('宿主未完成下载。请确认下载提示后重试。');
    }

    return {
      kind: 'requested' as const,
      message: `宿主已接受下载「${filename}」。请留意宿主的下载提示。`,
    };
  };
}
