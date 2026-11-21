import type { BoardElement, StudioClient } from '../../../../../contracts/studio.js';
import { studioRequest } from '../../../../transport/client.js';
import { assetDisplayUrl } from '../scene/canvas-model.js';

const allowedMedia = /^(image\/(png|jpeg|webp|gif|svg\+xml)|video\/(mp4|webm|quicktime))$/;
const uploadByteLimit = 20 * 1024 * 1024;
const inlineImageByteLimit = 1024 * 1024;

function readInlineImage(file: File) {
  if (file.type.startsWith('video/') || file.size > inlineImageByteLimit) {
    throw new Error('大图片和视频需要连接本地 Studio 服务后添加。');
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.readAsDataURL(file);
  });
}

export async function readMediaSource(
  file: File,
  client: StudioClient,
  artifactId: string,
  author: string,
  signal: AbortSignal,
): Promise<string> {
  if (!allowedMedia.test(file.type)) {
    throw new Error('支持 PNG、JPEG、WebP、GIF、SVG 图片，以及 MP4、WebM、MOV 视频。');
  }
  if (file.size > uploadByteLimit) {
    throw new Error(`${file.name} 超过 20 MB，请压缩后添加。`);
  }
  if (!client.baseUrl) {
    return readInlineImage(file);
  }

  const response = await studioRequest(
    client,
    new URL(`/api/assets?artifactId=${encodeURIComponent(artifactId)}`, client.baseUrl),
    {
      method: 'POST',
      headers: {
        ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}),
        'Content-Type': file.type,
        'X-Filename': encodeURIComponent(file.name),
        'X-Studio-Name': encodeURIComponent(author),
      },
      body: file,
      signal,
    },
  );
  const result = (await response.json()) as { src?: string; error?: { message?: string } };
  if (!response.ok || !result.src) {
    throw new Error(result.error?.message ?? `资源上传失败（${response.status}）。`);
  }

  return result.src;
}

type MediaGeometry = Pick<BoardElement, 'w' | 'h' | 'data' | 'video' | 'src'>;

export async function measureMedia(
  file: File,
  src: string,
  client: StudioClient,
  reportError: (failure: unknown) => void,
): Promise<MediaGeometry> {
  if (file.type.startsWith('video/')) {
    return { w: 480, h: 270, data: undefined, video: src };
  }

  try {
    const image = new Image();
    image.src = assetDisplayUrl(src, client)!;
    await image.decode();
    const ratio = Math.min(1, 480 / image.naturalWidth, 360 / image.naturalHeight);

    return {
      w: image.naturalWidth * ratio,
      h: image.naturalHeight * ratio,
      data: { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
      src,
    };
  } catch (failure) {
    reportError(failure);

    return { w: 360, h: 240, data: undefined, src };
  }
}
