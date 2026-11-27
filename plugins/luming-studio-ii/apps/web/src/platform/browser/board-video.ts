const maximumVideoBytes = 20 * 1024 * 1024;
const formats = [
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
] as const;

function videoType(file: File) {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  return (
    formats.find(([suffix]) => extension === suffix)?.[1] ??
    formats.find(([, mimeType]) => file.type === mimeType)?.[1]
  );
}

export async function prepareBoardVideo(file: File, signal?: AbortSignal) {
  const mediaType = videoType(file);
  if (!mediaType) {
    throw new Error('支持 MP4、WebM 或 MOV 视频。');
  }
  if (file.size === 0 || file.size > maximumVideoBytes) {
    throw new Error('请选择不超过 20 MiB 的视频。');
  }

  signal?.throwIfAborted();
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  const previewUrl = URL.createObjectURL(file.slice(0, file.size, mediaType));

  return {
    displayName: file.name,
    width: 480,
    height: 270,
    content: new Uint8Array(buffer),
    mediaType,
    previewUrl,
    dispose() {
      URL.revokeObjectURL(previewUrl);
    },
  };
}
