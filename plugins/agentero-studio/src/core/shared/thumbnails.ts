import type { ExportBytes } from './files.js';
import { StudioError } from './common.js';

export interface Thumbnail { mimeType: string; data: Uint8Array }
/** Derived previews are bounded cache entries, never the product's saved content. */
export class ThumbnailCache {
  private entries = new Map<string, { revision: number; promise: Promise<Thumbnail> }>();
  get(id: string, revision: number, render: () => Promise<ExportBytes>): Promise<Thumbnail> {
    const existing = this.entries.get(id);
    if (existing?.revision === revision) return existing.promise;
    const promise = render().then(result => {
      if (!/^image\/(?:png|jpeg|webp|svg\+xml)$/.test(result.mimeType)) throw new StudioError('NO_PREVIEW', '此产品没有图像预览。');
      const data = Buffer.from(result.data, result.encoding === 'base64' ? 'base64' : 'utf8');
      if (data.byteLength > 2 * 1024 * 1024) throw new StudioError('NO_PREVIEW', '预览超过缓存预算，请打开作品查看。');
      return { mimeType: result.mimeType, data };
    }).catch(error => { if (this.entries.get(id)?.promise === promise) this.entries.delete(id); throw error; });
    this.entries.set(id, { revision, promise });
    while (this.entries.size > 24) this.entries.delete(this.entries.keys().next().value!);
    return promise;
  }
  clear() { this.entries.clear(); }
}
