const assetPath = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
const maximumConcurrentAssets = 4;

interface AssetResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
}

type FetchAsset = (
  ids: { readonly boardId: string; readonly assetId: string },
  signal?: AbortSignal,
) => Promise<AssetResult>;

function requireAssetMimeType(mimeType: string) {
  if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
    throw new Error('白板包含无法在面板中读取的素材类型。');
  }
}

export function createMcpAssets(getAsset: FetchAsset, lifetime: AbortSignal) {
  const fetched = new Map<string, Promise<string>>();
  const original = new Map<string, string>();
  const queue: (() => void)[] = [];
  let active = 0;

  function runNext() {
    if (active < maximumConcurrentAssets) {
      queue.shift()?.();
    }
  }

  function load(source: string, ids: { boardId: string; assetId: string }) {
    return new Promise<string>((resolve, reject) => {
      function start() {
        active += 1;
        read(ids, source)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            runNext();
          })
          .catch(reject);
      }

      queue.push(start);
      runNext();
    });
  }

  async function read(ids: { boardId: string; assetId: string }, source: string) {
    lifetime.throwIfAborted();
    const { bytes, mimeType } = await getAsset(ids, lifetime);
    lifetime.throwIfAborted();
    requireAssetMimeType(mimeType);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    original.set(url, source);
    return url;
  }

  async function resolve(source: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const [, boardId, assetId] = assetPath.exec(source) ?? [];
    if (!boardId || !assetId) {
      return source;
    }

    const current = fetched.get(source);
    const pending = current ?? load(source, { boardId, assetId });
    if (!current) {
      fetched.set(source, pending);
    }

    const result = await pending.catch((error: unknown) => {
      if (fetched.get(source) === pending) {
        fetched.delete(source);
      }
      throw error;
    });
    signal?.throwIfAborted();
    return result;
  }

  function restore(source: string) {
    return original.get(source) ?? source;
  }

  async function readImage(expectedBoardId: string, source: string, signal?: AbortSignal) {
    const [, boardId, assetId] = assetPath.exec(restore(source)) ?? [];
    if (boardId !== expectedBoardId || !assetId) {
      return undefined;
    }

    lifetime.throwIfAborted();
    const { mimeType, bytes } = await getAsset({ boardId, assetId }, signal ?? lifetime);
    lifetime.throwIfAborted();
    if (mimeType.startsWith('image/')) {
      return { mimeType, content: bytes };
    }
  }

  function close() {
    for (const url of original.keys()) {
      URL.revokeObjectURL(url);
    }

    original.clear();
    fetched.clear();
  }

  return { resolve, restore, readImage, close };
}
