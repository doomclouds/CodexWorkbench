import { Buffer } from 'node:buffer';

export const pngImage = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0aDjAwMDAxAAGUAoAHFQBhrzYfPQAAAAASUVORK5CYII=',
    'base64',
  ),
);
