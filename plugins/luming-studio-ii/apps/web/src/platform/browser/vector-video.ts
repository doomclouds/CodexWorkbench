const embeddedVideo = /^data:video\/[a-z\d.+-]+;base64,[a-z\d+/]+={0,2}$/iu;

function loadFirstFrame(video: HTMLVideoElement, signal: AbortSignal) {
  signal.throwIfAborted();

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    }

    function loaded() {
      cleanup();
      resolve();
    }

    function failed() {
      cleanup();
      reject(new Error('当前浏览器无法解码视频首帧。'));
    }

    function aborted() {
      cleanup();
      reject(signal.reason);
    }

    video.addEventListener('loadeddata', loaded);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    video.preload = 'auto';
    video.load();
  });
}

export async function freezeVideoFrame(
  video: HTMLVideoElement,
  { width, height }: { readonly width: number; readonly height: number },
  signal: AbortSignal,
) {
  if (!embeddedVideo.test(video.getAttribute('src') ?? '')) {
    throw new Error('视频导出只支持已保存的本地媒体。');
  }

  await loadFirstFrame(video, signal);
  signal.throwIfAborted();

  const { videoWidth, videoHeight, ownerDocument } = video;
  if (!videoWidth || !videoHeight) {
    throw new Error('无法读取视频首帧。');
  }

  const scale = Math.min(1, width / videoWidth, height / videoHeight);
  const canvas = ownerDocument.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(videoWidth * scale));
  canvas.height = Math.max(1, Math.ceil(videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法创建视频首帧画布。');
  }

  const image = ownerDocument.createElement('img');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  image.src = canvas.toDataURL('image/png');
  video.replaceWith(image);
}
