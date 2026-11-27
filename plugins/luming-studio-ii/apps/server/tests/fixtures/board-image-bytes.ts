import { Buffer } from 'node:buffer';

export const pngImage = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0aDjAwMDAxAAGUAoAHFQBhrzYfPQAAAAASUVORK5CYII=',
    'base64',
  ),
);

export function svgImage(size: number): Uint8Array {
  const start = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 18"><desc>';
  const end = '</desc><rect width="32" height="18"/></svg>';

  return new TextEncoder().encode(start + 'x'.repeat(size - start.length - end.length) + end);
}
