import { expect, it } from 'vitest';

import { prepareBoardImage } from '../../src/platform/browser/index.js';

function pngHeader(width: number, height: number, chunk: number): File {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(37, chunk);

  return new File([bytes], 'image.png', { type: 'image/png' });
}

it('rejects an oversized selected file before reading its image data', async () => {
  const content = new Uint8Array(8 * 1024 * 1024 + 1);
  const file = new File([content], 'large.png', { type: 'image/png' });

  await expect(prepareBoardImage(file)).rejects.toThrow('8 MiB');
});

it('recognizes image bytes independently of the supplied filename and MIME', async () => {
  const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'forged.png', {
    type: 'image/png',
  });

  await expect(prepareBoardImage(file)).rejects.toThrow('静态 PNG、JPEG 或 WebP');
});

it('rejects excessive encoded dimensions before decoding the file', async () => {
  const imageData = 0x49444154;
  await expect(prepareBoardImage(pngHeader(10_000, 5_000, imageData))).rejects.toThrow(
    '图片尺寸过大',
  );
});

it('rejects animated PNG before creating a preview', async () => {
  const animationControl = 0x6163544c;
  await expect(prepareBoardImage(pngHeader(80, 40, animationControl))).rejects.toThrow('静态 PNG');
});

it('honors an already canceled file request', async () => {
  const controller = new AbortController();
  controller.abort();
  const image = new File(['content'], 'image.png', { type: 'image/png' });

  await expect(prepareBoardImage(image, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
