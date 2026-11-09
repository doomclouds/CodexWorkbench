import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AddMarkInput, MarkColor, MarkKind, MarkList, MarkMessage, MarkRect, ReaderMark, UpdateMarkInput } from '../contracts/reader.js';
import { LibraryError } from '../contracts/errors.js';
import { atomicJson, containedPath, exists } from './files.js';

export const markPalette: Record<MarkColor, string> = { yellow: '#fcd34d', green: '#86efac', blue: '#7dd3fc', pink: '#f9a8d4', purple: '#d8b4fe' };
const rec = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const annotationOf = (v: unknown) => rec(rec(v).annotation ?? v);
const nativeRect = (r: MarkRect) => ({ origin: { x: r.x, y: r.y }, size: { width: r.w, height: r.h } });
const rectOf = (v: unknown): MarkRect | null => {
  const r = rec(v), p = rec(r.origin), s = rec(r.size);
  const out = { x: r.x ?? p.x, y: r.y ?? p.y, w: r.w ?? s.width, h: r.h ?? s.height };
  return Object.values(out).every(Number.isFinite) && out.w > 0 && out.h > 0 ? out : null;
};
const rectsOf = (v: unknown): MarkRect[] => Array.isArray(v) ? v.map(rectOf).filter((r): r is MarkRect => !!r) : [];
const kinds: MarkKind[] = ['highlight', 'underline', 'ask', 'translate', 'visual'];
interface Store { annotations: unknown[]; files: Map<string, Record<string, any>>; revision: string; items: ReaderMark[]; malformed: string[] }

/** Agentero interchange adapter. Unknown properties/annotation types survive edits. */
export class MarksStore {
  constructor(readonly root: string, readonly paperPath: string, readonly vaultId: string) {}
  private path(name: string, missing = false) { return containedPath(this.root, `${this.paperPath}/marks/${name}`, missing); }
  async load(): Promise<Store> {
    const directory = await containedPath(this.root, `${this.paperPath}/marks`, true);
    const names = await exists(directory) ? (await readdir(directory)).filter(n => n.endsWith('.json')).sort() : [];
    const hash = createHash('sha256'), files = new Map<string, Record<string, any>>(), malformed: string[] = [];
    let annotations: unknown[] = [], bytes = 0;
    for (const name of names) {
      const path = await this.path(name);
      const info = await stat(path);
      bytes += info.size;
      if (bytes > 16 * 1024 * 1024) throw new LibraryError('MARKS_TOO_LARGE', '标注数据超过 16 MiB，请拆分论文。');
      const raw = await readFile(path, 'utf8'); hash.update(name).update('\0').update(raw).update('\0');
      try {
        const value = JSON.parse(raw);
        if (name === 'annotations.json') { if (!Array.isArray(value)) throw Error(); annotations = value; }
        else { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); files.set(name, value); }
      } catch { malformed.push(name); }
    }
    const items: ReaderMark[] = [], seen = new Set<string>();
    for (const blob of annotations) {
      const a = annotationOf(blob), c = rec(a.custom);
      if (![9, 10].includes(a.type) || !text(a.id) || !Number.isInteger(a.pageIndex) || a.pageIndex < 0) continue;
      const rects = rectsOf(a.segmentRects); if (!rects.length) { const r = rectOf(a.rect); if (r) rects.push(r); }
      if (!rects.length || seen.has(a.id)) continue;
      seen.add(a.id);
      items.push({ id: a.id, kind: a.type === 10 ? 'underline' : 'highlight', page: a.pageIndex + 1, space: 'pt', rects, quote: text(c.quote), note: text(a.contents), comment: text(a.contents), color: Object.hasOwn(markPalette, c.paletteKey) ? c.paletteKey : Object.entries(markPalette).find(([, hex]) => hex === a.strokeColor)?.[0] as MarkColor | undefined, messages: Array.isArray(c.messages) ? c.messages : [], createdAt: text(a.created), updatedAt: text(a.modified) || text(a.created) });
    }
    for (const [name, a] of files) {
      if (!kinds.includes(a.kind) && a.kind !== 'agent-trace') continue;
      const anchor = rec(a.anchor), id = text(a.id) || name.slice(0, -5), page = a.page ?? anchor.page;
      if (seen.has(id) || !Number.isInteger(page) || page < 1) continue;
      seen.add(id);
      const messages = Array.isArray(a.messages) ? a.messages : Array.isArray(rec(a.agent).messages) ? rec(a.agent).messages : [];
      const asset = text(a.asset) || (text(rec(a.image).path) ? `marks/${text(rec(a.image).path)}` : '');
      items.push({ id, kind: a.kind === 'agent-trace' ? 'visual' : a.kind, page, space: 'norm', rects: rectsOf(a.rects ?? anchor.rects), quote: text(a.quote) || text(anchor.quote), note: text(a.comment) || text(a.result), comment: text(a.comment), result: text(a.result), question: text(messages.find((m: any) => m?.role === 'user')?.content), messages, ...(asset ? { asset: `${this.paperPath}/${asset}` } : {}), createdAt: text(a.createdAt), updatedAt: text(a.updatedAt) });
    }
    return { annotations, files, revision: `marks:${hash.digest('hex')}`, items, malformed };
  }
  async list(): Promise<MarkList> { const s = await this.load(); return { vaultId: this.vaultId, paperPath: this.paperPath, revision: s.revision, items: s.items }; }
  private async checked(revision: string) {
    const store = await this.load();
    if (!revision || revision !== store.revision) throw new LibraryError('MARK_CONFLICT', '标注已变化，请刷新后重试。', true, { currentRevision: store.revision });
    if (store.malformed.length) throw new LibraryError('MARKS_INVALID', '存在无法解析的标注文件，为避免覆盖请先修复。', false, { files: store.malformed });
    return store;
  }
  async add(input: AddMarkInput): Promise<MarkList> {
    const s = await this.checked(input.revision);
    const { width, height } = input.pageSize ?? {};
    if (!kinds.includes(input.kind) || !Number.isInteger(input.page) || input.page < 1 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Array.isArray(input.rects) || input.rects.length < 1 || input.rects.length > 1000) throw new LibraryError('INVALID_MARK', '标注页码或几何无效。');
    for (const r of input.rects) if (!rectOf(r) || r.x < 0 || r.y < 0 || r.x + r.w > width + 0.5 || r.y + r.h > height + 0.5) throw new LibraryError('INVALID_MARK', '标注矩形超出未旋转的页面范围。');
    for (const v of [input.quote, input.comment, input.question, input.result]) if (v !== undefined && (typeof v !== 'string' || v.length > 20_000)) throw new LibraryError('INVALID_MARK', '标注文本最多 20000 字符。');
    if (input.kind !== 'visual' && !input.quote?.trim()) throw new LibraryError('INVALID_MARK', '文字标注需要引用原文。');
    if (input.kind === 'translate' && !input.result?.trim()) throw new LibraryError('INVALID_MARK', '翻译标注需要已完成的译文。');
    if (input.color && !Object.hasOwn(markPalette, input.color)) throw new LibraryError('INVALID_MARK', '不支持的标注颜色。');
    const now = new Date().toISOString();
    if (input.kind === 'highlight' || input.kind === 'underline') {
      const rs = input.rects, x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
      const color = input.color ?? 'yellow';
      s.annotations.push({ annotation: { type: input.kind === 'underline' ? 10 : 9, id: randomUUID(), pageIndex: input.page - 1, rect: nativeRect({ x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }), segmentRects: rs.map(nativeRect), strokeColor: markPalette[color], opacity: input.kind === 'underline' ? 1 : 0.4, created: now, custom: { app: 'agentero', paletteKey: color, quote: input.quote }, ...(input.comment ? { contents: input.comment } : {}) } });
      await atomicJson(await this.path('annotations.json', true), s.annotations);
    } else {
      const id = randomBytes(9).toString('base64url'), rects = input.rects.map(r => ({ x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height }));
      const common = { version: input.kind === 'visual' ? 2 : 1, kind: input.kind, id, paperPath: this.paperPath, createdAt: now, updatedAt: now, geometry: 'resolved' };
      let value: Record<string, unknown>;
      if (input.kind === 'translate') value = { ...common, page: input.page, rects, quote: input.quote, result: input.result };
      else value = { ...common, status: 'open', anchor: { page: input.page, rects, quote: input.quote, trigger: input.kind === 'visual' ? 'region' : 'selection' }, ...(input.comment ? { comment: input.comment } : {}), messages: input.question ? [{ id: `${id}-q`, role: 'user', content: input.question, createdAt: now }] : [] };
      if (input.kind === 'visual') {
        const asset = input.asset;
        if (!asset || asset.mediaType !== 'image/png' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data) || asset.data.length > 6_000_000) throw new LibraryError('INVALID_ASSET', '区域截图必须是 4.5 MB 以内的 PNG。');
        const bytes = Buffer.from(asset.data, 'base64');
        if (bytes.length > 4_500_000 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new LibraryError('INVALID_ASSET', '区域截图不是有效 PNG。');
        const p = await this.path(`assets/${id}.png`, true); await mkdir(dirname(p), { recursive: true }); await writeFile(p, bytes, { flag: 'wx' });
        value.asset = `marks/assets/${id}.png`;
        // Agentero desktop v0.15.2 requires these top-level fields. Retain the
        // DSH anchor/asset aliases for consumers of its earlier host adapter.
        value.page = input.page; value.rects = rects; value.comment = input.comment ?? '';
        value.image = { path: `assets/${id}.png`, mimeType: 'image/png' };
      }
      await atomicJson(await this.path(`${id}.json`, true), value);
    }
    return this.list();
  }
  async update(input: UpdateMarkInput): Promise<MarkList> {
    const s = await this.checked(input.revision), now = new Date().toISOString();
    if (input.color && !Object.hasOwn(markPalette, input.color)) throw new LibraryError('INVALID_MARK', '不支持的标注颜色。');
    for (const v of [input.comment, input.result, input.reply?.content]) if (v !== undefined && (typeof v !== 'string' || v.length > 20_000)) throw new LibraryError('INVALID_MARK', '标注文本最多 20000 字符。');
    if (input.reply && (!['user', 'assistant'].includes(input.reply.role) || !input.reply.content.trim())) throw new LibraryError('INVALID_MARK', '回复内容或角色无效。');
    const blob = s.annotations.find(v => annotationOf(v).id === input.id);
    const message: MarkMessage | undefined = input.reply ? { id: randomUUID(), ...input.reply, createdAt: now } : undefined;
    if (blob) {
      const a = annotationOf(blob); a.custom = rec(a.custom);
      if (input.comment !== undefined) a.contents = input.comment;
      if (input.color) { a.strokeColor = markPalette[input.color]; a.custom.paletteKey = input.color; }
      if (message) a.custom.messages = [...(Array.isArray(a.custom.messages) ? a.custom.messages : []), message];
      a.modified = now; await atomicJson(await this.path('annotations.json'), s.annotations);
    } else {
      const entry = [...s.files].find(([name, v]) => (v.id || name.slice(0, -5)) === input.id);
      if (!entry) throw new LibraryError('MARK_NOT_FOUND', '标注不存在。');
      const [name, a] = entry;
      if (input.comment !== undefined) a.comment = input.comment;
      if (input.result !== undefined) a.result = input.result;
      if (input.color) a.color = input.color;
      if (message) {
        const owner = rec(a.agent).messages ? a.agent : a;
        owner.messages = [...(Array.isArray(owner.messages) ? owner.messages : []), message];
      }
      a.updatedAt = now; await atomicJson(await this.path(name), a);
    }
    return this.list();
  }
  async remove(id: string, revision: string): Promise<MarkList> {
    const s = await this.checked(revision), kept = s.annotations.filter(v => annotationOf(v).id !== id);
    if (kept.length !== s.annotations.length) await atomicJson(await this.path('annotations.json'), kept);
    else {
      const entry = [...s.files].find(([name, a]) => (a.id || name.slice(0, -5)) === id);
      if (!entry) throw new LibraryError('MARK_NOT_FOUND', '标注不存在。');
      await rm(await this.path(entry[0]));
      // Only remove a crop owned by this exact mark. Never traverse a stored path.
      if ((entry[1].asset === `marks/assets/${id}.png` || rec(entry[1].image).path === `assets/${id}.png`) && /^[\w-]+$/.test(id)) await rm(await this.path(`assets/${id}.png`, true), { force: true });
    }
    return this.list();
  }
  async asset(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new LibraryError('INVALID_PATH', '标注标识无效。');
    const s = await this.load(), item = s.items.find(m => m.id === id && m.kind === 'visual');
    if (!item || item.asset !== `${this.paperPath}/marks/assets/${id}.png`) throw new LibraryError('MARK_NOT_FOUND', '截图标注不存在。');
    const p = await this.path(`assets/${id}.png`);
    if ((await stat(p)).size > 4_500_000) throw new LibraryError('ASSET_TOO_LARGE', '截图超过大小上限。');
    return { mediaType: 'image/png' as const, base64: (await readFile(p)).toString('base64') };
  }
}
