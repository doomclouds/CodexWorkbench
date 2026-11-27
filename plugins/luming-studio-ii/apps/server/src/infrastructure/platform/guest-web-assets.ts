import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
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

  const files = new Map([['/', { path: index, contentType: 'text/html; charset=utf-8' }]]);
  for (const file of await readdir(bundled, { withFileTypes: true })) {
    const contentType = assetTypes.get(extname(file.name));
    if (file.isFile() && contentType) {
      files.set('/assets/' + file.name, { path: join(bundled, file.name), contentType });
    }
  }

  return async (pathname) => {
    const file = files.get(pathname);
    if (!file || !(await lstat(file.path)).isFile()) {
      return undefined;
    }

    const bytes = await readFile(file.path);
    const body =
      pathname === '/'
        ? Buffer.from(
            bytes
              .toString('utf8')
              .replace(/<html(?=[\s>])/iu, '<html data-studio-guest-entry="true"'),
          )
        : bytes;

    return { contentType: file.contentType, bytes: body };
  };
}
