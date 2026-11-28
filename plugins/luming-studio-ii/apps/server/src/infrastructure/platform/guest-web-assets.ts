import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, join } from 'node:path';

interface WebAsset {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export type GuestWebAssets = (pathname: string) => Promise<WebAsset | undefined>;

const assetTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const assetPath = /^\/assets\/([\w.-]+)$/u;

async function readRegularFile(path: string) {
  try {
    if ((await lstat(path)).isFile()) {
      return await readFile(path);
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

export async function loadGuestWebAssets(directory: string): Promise<GuestWebAssets> {
  const root = await realpath(directory);
  const index = join(root, 'index.html');
  if (!(await lstat(index)).isFile()) {
    throw new Error('The Studio Web entry must be a regular file.');
  }

  const bundled = join(root, 'assets');
  if (!(await lstat(bundled)).isDirectory()) {
    throw new Error('The Studio Web asset directory must be a regular directory.');
  }

  return async (pathname) => {
    if (pathname === '/') {
      const bytes = await readRegularFile(index);
      return (
        bytes && {
          contentType: 'text/html; charset=utf-8',
          bytes: Buffer.from(
            bytes
              .toString('utf8')
              .replace(/<html(?=[\s>])/iu, '<html data-studio-guest-entry="true"'),
          ),
        }
      );
    }

    const filename = assetPath.exec(pathname)?.[1];
    const contentType = filename && assetTypes.get(extname(filename));
    if (!filename || !contentType) {
      return undefined;
    }

    const bytes = await readRegularFile(join(bundled, filename));
    return bytes && { contentType, bytes };
  };
}
