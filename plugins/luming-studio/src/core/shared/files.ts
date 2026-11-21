import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute } from 'node:path';
import type { Actor } from '../../contracts/studio.js';
import type {
  AssetFileRead,
  AssetFileStore,
  RecycledAssetFile,
} from '../ports/asset-file-store.js';
import type { StudioRepository } from '../ports/studio-repository.js';
import type { ExportResources } from './products.js';
import { assertAlive, requireRole, safeId, StudioError, text } from './common.js';
import type { ArtifactState, AssetRecord } from './model.js';

type AssetRepository<C, A, S> = Pick<StudioRepository<C, A, S>, 'transaction' | 'readProjection'>;

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const assetReference = (artifactId: string, asset: AssetRecord) => ({
  ...asset,
  url: `/assets/${artifactId}/${asset.id}`,
  src: `/assets/${artifactId}/${asset.id}`,
});

function readAssetData(result: AssetFileRead): Uint8Array {
  if (result.kind === 'data') {
    return result.data;
  }
  if (result.kind === 'empty') {
    throw new StudioError('INVALID_ARGUMENT', '资源文件不能为空。');
  }

  throw new StudioError('TOO_LARGE', '资源应小于 20 MB。');
}

const EXTENSION_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
};
const MEDIA_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex');

function rasterImageMime(data: Buffer): string | undefined {
  if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'))) {
    return 'image/gif';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
}

function detectMediaMime(data: Buffer): string | undefined {
  const image = rasterImageMime(data);
  if (image) {
    return image;
  }

  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') {
    const brand = data.toString('ascii', 8, 12);
    if (brand === 'qt  ') {
      return 'video/quicktime';
    }

    return /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV|3gp[4-9])$/.test(brand)
      ? 'video/mp4'
      : undefined;
  }
  if (
    data.length >= 8 &&
    ['moov', 'mdat', 'wide'].includes(data.toString('ascii', 4, 8)) &&
    data.readUInt32BE(0) >= 8
  ) {
    return 'video/quicktime';
  }
  if (
    data.length >= 4 &&
    data.readUInt32BE(0) === 0x1a45dfa3 &&
    data.subarray(0, 4096).includes(Buffer.from('webm'))
  ) {
    return 'video/webm';
  }
  if (
    /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
      data.subarray(0, 64 * 1024).toString('utf8'),
    )
  ) {
    return 'image/svg+xml';
  }
}

function assetMimeType(data: Uint8Array, filename: string): string {
  const detected = detectMediaMime(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  const fallback = EXTENSION_MIMES[extname(filename).toLowerCase()] ?? 'application/octet-stream';
  if (!detected && MEDIA_MIMES.has(fallback)) {
    throw new StudioError('INVALID_ARGUMENT', '文件内容与图片或视频格式不符，请提供实际媒体文件。');
  }

  return detected ?? fallback;
}

export async function importAsset<C, A, S>(
  store: AssetRepository<C, A, S>,
  files: AssetFileStore,
  artifactId: string,
  assetPath: unknown,
  actor: Actor,
  validateMimeType: (mimeType: string) => void,
  authorize?: (state: ArtifactState<C, A, S>) => Actor,
) {
  requireRole(actor, ['owner']);
  const path = text(assetPath, '', 4096);
  if (!path || !isAbsolute(path)) {
    throw new StudioError('INVALID_ARGUMENT', '请提供明确的资源文件绝对路径。');
  }

  const { filename, content } = await files.readImport(path, MAX_ASSET_BYTES);
  const data = readAssetData(content);
  const mimeType = assetMimeType(data, filename);

  return putAsset(
    store,
    files,
    artifactId,
    data,
    { filename, mimeType },
    actor,
    validateMimeType,
    authorize,
  );
}

export function listAssets<C, A, S>(
  state: ArtifactState<C, A, S>,
  args: Record<string, unknown>,
  actor: Actor,
) {
  requireRole(actor, ['owner']);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 50;
  const validOffset = Number.isSafeInteger(offset) && (offset as number) >= 0;
  const validLimit =
    Number.isSafeInteger(limit) && (limit as number) >= 1 && (limit as number) <= 100;

  if (!validOffset || !validLimit) {
    throw new StudioError('INVALID_ARGUMENT', '资源分页须使用非负 offset 与 1 到 100 的 limit。');
  }

  const assets = Object.values(state.assets);
  const end = (offset as number) + (limit as number);

  return {
    assets: assets
      .slice(offset as number, end)
      .map((asset) => assetReference(state.artifact.id, asset)),
    offset,
    limit,
    total: assets.length,
    ...(end < assets.length ? { nextOffset: end } : {}),
  };
}

function referencesAsset(value: unknown, id: string): boolean {
  if (typeof value === 'string') {
    return value.includes(id);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => referencesAsset(item, id));
  }

  return false;
}

export async function deleteAsset<C, A, S>(
  store: AssetRepository<C, A, S>,
  files: AssetFileStore,
  artifactId: string,
  assetId: unknown,
  actor: Actor,
  authorize?: (state: ArtifactState<C, A, S>) => Actor,
) {
  requireRole(actor, ['owner']);
  const id = safeId(assetId, '资源 ID');
  let moved: RecycledAssetFile | undefined;
  try {
    await store.transaction(artifactId, async (state) => {
      requireRole(authorize ? authorize(state) : actor, ['owner']);
      assertAlive(state.artifact);
      if (!Object.hasOwn(state.assets, id)) {
        throw new StudioError('NOT_FOUND', '资源不存在。');
      }
      if (referencesAsset([state.content, state.history, state.sources, state.feedback], id)) {
        throw new StudioError(
          'REFERENCE_IN_USE',
          '当前内容、保留历史或反馈仍引用此资源，请保留资源以便恢复。',
        );
      }

      moved = await files.recycle(artifactId, id);
      delete state.assets[id];
    });
  } catch (error) {
    if (moved) {
      try {
        await moved.restore();
      } catch (rollbackError) {
        process.emitWarning(`Asset rollback failed: ${String(rollbackError)}`, {
          code: 'STUDIO_ASSET_ROLLBACK_FAILED',
        });
      }
    }

    throw error;
  }

  return { assetId: id, removed: true as const };
}

export async function putAsset<C, A, S>(
  store: AssetRepository<C, A, S>,
  files: AssetFileStore,
  artifactId: string,
  data: Uint8Array,
  input: { filename?: string; mimeType?: string },
  actor: Actor,
  validateMimeType: (mimeType: string) => void,
  authorize?: (state: ArtifactState<C, A, S>) => Actor,
) {
  requireRole(actor, ['owner', 'editor']);
  if (!data.byteLength || data.byteLength > MAX_ASSET_BYTES) {
    throw new StudioError('TOO_LARGE', '资源应小于 20 MB。');
  }

  const mimeType = text(input.mimeType, 'application/octet-stream', 100).split(';')[0]!;
  validateMimeType(mimeType);
  const id = randomUUID();
  const filename = basename(text(input.filename, 'resource', 250)).replace(/[\x00-\x1f]/g, '');
  await store.transaction(artifactId, async (state) => {
    requireRole(authorize ? authorize(state) : actor, ['owner', 'editor']);
    assertAlive(state.artifact);
    await files.write(artifactId, id, data);
    state.assets[id] = { id, filename, mimeType, size: data.byteLength };
  });

  return {
    id,
    url: `/assets/${artifactId}/${id}`,
    src: `/assets/${artifactId}/${id}`,
    filename,
    mimeType,
    size: data.byteLength,
  };
}

export async function getAsset<C, A, S>(
  store: AssetRepository<C, A, S>,
  files: AssetFileStore,
  artifactId: string,
  assetId: string,
): Promise<AssetRecord & { data: Uint8Array }> {
  safeId(assetId, '资源 ID');
  const asset = await store.readProjection(artifactId, (state) =>
    Object.hasOwn(state.assets, assetId) ? state.assets[assetId] : undefined,
  );

  if (!asset) {
    throw new StudioError('NOT_FOUND', '资源不存在。');
  }

  const data = readAssetData(await files.read(artifactId, assetId, MAX_ASSET_BYTES));

  return { ...asset, data };
}

export function exportResources<C, A, S>(
  store: AssetRepository<C, A, S>,
  files: AssetFileStore,
  artifactId: string,
): Pick<ExportResources, 'assetDataUri'> {
  return {
    assetDataUri: async (reference) => {
      const match = /^\/assets\/([^/]+)\/([^/?#]+)/.exec(reference);
      if (!match) {
        return reference;
      }
      if (match[1] !== artifactId) {
        throw new StudioError('RESOURCE_SCOPE', '不能读取其他作品的资源。');
      }

      const asset = await getAsset(store, files, artifactId, match[2]);

      return `data:${asset.mimeType};base64,${Buffer.from(asset.data).toString('base64')}`;
    },
  };
}
