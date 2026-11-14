import { randomUUID } from 'node:crypto';
import { DEFAULT_STYLE, type Anchor, type Board, type BoardElement, type Operation } from '../../contracts/studio.js';
import { copy, finite, object, safeId, same, StudioError } from '../shared/common.js';
import type { ArtifactState, ContentChange, ProductAdapter, Snapshot } from '../shared/model.js';
import type { ProductDefinition } from '../shared/products.js';

export type WhiteboardContent = Omit<Board, 'artifact'>;
export interface SourceSnapshot { html: string; regionId: string; sourceRevision: number; version: number; artifactId: string; feedbackId?: string }
export type WhiteboardState = ArtifactState<WhiteboardContent, Anchor, SourceSnapshot>;
export function boardView(snapshot: Snapshot<WhiteboardContent>): Board { return { artifact: snapshot.artifact, ...snapshot.content }; }
export function validateWhiteboardAsset(mimeType: string): void {
  if (!/^(image\/(png|jpeg|gif|webp|svg\+xml)|video\/(mp4|webm|quicktime))$/.test(mimeType)) throw new StudioError('INVALID_ARGUMENT', '白板仅接收图片和视频资源。');
}
const TYPES = new Set(['shape', 'container', 'text', 'stroke', 'arrow', 'image', 'html', 'table', 'link', 'note', 'sticker', 'diagram', 'chart']);
export function normalizeElement(input: Partial<BoardElement>, id?: string): BoardElement {
  if (!object(input) || !TYPES.has(input.type ?? '')) throw new StudioError('INVALID_ARGUMENT', '白板元素类型无效。');
  const result: BoardElement = { ...copy(input), id: safeId(id ?? input.id ?? randomUUID(), '元素 ID'), type: input.type!, x: finite(input.x, 0), y: finite(input.y, 0), w: finite(input.w, 220), h: finite(input.h, 120), version: 1 };
  if (result.w < 0 || result.h < 0) throw new StudioError('INVALID_ARGUMENT', '元素尺寸不能为负数。');
  if (result.html !== undefined && (typeof result.html !== 'string' || result.html.length > 2 * 1024 * 1024)) throw new StudioError('INVALID_ARGUMENT', 'HTML 内容无效或超过 2 MB。');
  if (result.type === 'html') result.sourceRevision = typeof input.sourceRevision === 'number' ? input.sourceRevision : 1;
  if (result.points !== undefined && (!Array.isArray(result.points) || result.points.length > 40_000 || result.points.some(n => typeof n !== 'number' || !Number.isFinite(n)))) throw new StudioError('INVALID_ARGUMENT', '笔迹坐标无效。');
  if (result.type === 'shape' && result.kind !== undefined && !['rect', 'rounded', 'ellipse', 'diamond', 'pill', 'hexagon', 'parallelogram', 'database', 'queue', 'document', 'cloud', 'person'].includes(result.kind)) throw new StudioError('INVALID_ARGUMENT', '不支持此原生形状类型。');
  for (const key of ['hollow', 'dash'] as const) if (result[key] !== undefined && typeof result[key] !== 'boolean') throw new StudioError('INVALID_ARGUMENT', `${key} 必须是布尔值。`);
  for (const key of ['strokeWidth', 'width'] as const) if (result[key] !== undefined && (typeof result[key] !== 'number' || !Number.isFinite(result[key]) || result[key] <= 0 || result[key] > 100)) throw new StudioError('INVALID_ARGUMENT', '线条宽度须大于 0 且不超过 100。');
  if (result.type === 'arrow') {
    if (result.head !== undefined && !['end', 'both', 'none'].includes(result.head)) throw new StudioError('INVALID_ARGUMENT', '连接线箭头须为 end、both 或 none。');
    if (result.heads !== undefined && (!Array.isArray(result.heads) || result.heads.length !== 2 || result.heads.some(head => !['none', 'arrow', 'circle'].includes(head)))) throw new StudioError('INVALID_ARGUMENT', '连接线两端须为 none、arrow 或 circle。');
    for (const side of [result.fromSide, result.toSide]) if (side !== undefined && !['top', 'right', 'bottom', 'left'].includes(side)) throw new StudioError('INVALID_ARGUMENT', '连接线吸附方向无效。');
    if (result.bends !== undefined) {
      const bends = result.bends;
      const native = Array.isArray(bends) && ['h', 'v'].includes(String(bends[0])) && bends.length <= 13 && bends.slice(1).every(value => typeof value === 'number' && Number.isFinite(value));
      const points = Array.isArray(bends) && bends.length % 2 === 0 && bends.length <= 24 && bends.every(value => typeof value === 'number' && Number.isFinite(value));
      if (!native && !points) throw new StudioError('INVALID_ARGUMENT', '连接线路径须为 h/v 加最多 12 个相对偏移，或有效坐标点对。');
    }
  }
  if (result.crop !== undefined) {
    const crop = result.crop;
    if (!object(crop) || typeof crop.zoom !== 'number' || !Number.isFinite(crop.zoom) || crop.zoom < 1 || (['x', 'y'] as const).some(key => typeof crop[key] !== 'number' || !Number.isFinite(crop[key]) || crop[key] < 0 || crop[key] > 1)) throw new StudioError('INVALID_ARGUMENT', '图片裁剪缩放须至少为 1，位置 x/y 须在 0 到 1 之间。');
  }
  return result;
}
export function initialWhiteboard(elements: unknown, base?: WhiteboardContent): WhiteboardContent {
  return { elements: (base?.elements ?? (Array.isArray(elements) ? elements : [])).map(item => normalizeElement(item as BoardElement)), style: copy(base?.style ?? DEFAULT_STYLE), ...(base?.motion ? { motion: copy(base.motion) } : {}) };
}
export function htmlSource(snapshots: readonly Snapshot<WhiteboardContent>[], regionId: string, requested?: unknown) {
  for (const snapshot of requested === undefined ? snapshots.slice(0, 1) : snapshots) {
    const region = snapshot.content.elements.find(item => item.id === regionId && typeof item.html === 'string');
    if (region && (requested === undefined || (region.sourceRevision ?? 1) === requested)) return { region, snapshot };
  }
  throw new StudioError('NOT_FOUND', 'HTML 区域或对应的源码版本不存在。');
}
function elementChanges(before: WhiteboardContent, after: WhiteboardContent): ContentChange[] {
  const a = new Map(before.elements.map(item => [item.id, item])), b = new Map(after.elements.map(item => [item.id, item]));
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(id => same(a.get(id), b.get(id)) ? [] : [{ id, before: a.get(id) ?? null, after: b.get(id) ?? null }]);
}
export function compareBoards(before: Board, after: Board) { return elementChanges(before, after); }
function restoredElement(saved: BoardElement, current?: BoardElement): BoardElement {
  const restored = { ...copy(saved), version: Math.max(current?.version ?? 0, saved.version) + 1 };
  if (restored.type === 'html') restored.sourceRevision = current?.html === restored.html ? current?.sourceRevision ?? 1 : Number(current?.sourceRevision ?? saved.sourceRevision ?? 0) + 1;
  return restored;
}
function deletedIds(content: WhiteboardContent, operation: Operation): string[] {
  const ids = operation.ids ?? [safeId(operation.id, '元素 ID')];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new StudioError('INVALID_ARGUMENT', '元素 ID 列表无效。');
  return content.elements.filter(element => ids.includes(element.id) || element.type === 'arrow' && (typeof element.from === 'string' && ids.includes(element.from) || typeof element.to === 'string' && ids.includes(element.to))).map(element => element.id);
}
export const whiteboardAdapter: ProductAdapter<WhiteboardContent, Operation, Anchor, SourceSnapshot> = {
  type: 'whiteboard',
  validate(content) {
    if (!object(content) || !Array.isArray(content.elements) || !object(content.style)) throw new StudioError('INVALID_ARGUMENT', '白板内容无效。');
    if (content.elements.length > 2000 || Buffer.byteLength(JSON.stringify(content)) > 8 * 1024 * 1024) throw new StudioError('TOO_LARGE', '白板内容超过当前容量，请分成多个作品。');
  },
  versionOf: (content, id) => content.elements.find(item => item.id === id)?.version ?? 0,
  targets(content, operation) {
    if (['style', 'motion', 'restore'].includes(operation.op)) return;
    if (operation.op === 'layout') return operation.ids ?? content.elements.map(element => element.id);
    // Deleting a node also deletes attached arrows; CAS covers those indirect edits.
    if (operation.op === 'delete') return [...new Set([...(operation.ids ?? [safeId(operation.id, '元素 ID')]), ...deletedIds(content, operation)])];
    if (operation.op === 'update') return [safeId(operation.id, '元素 ID')];
    return [];
  },
  apply(content, operation) {
    if (operation.op === 'add') {
      const element = normalizeElement(operation.element ?? {}, operation.id ?? operation.element?.id);
      if (element.type === 'html') element.sourceRevision = 1;
      if (content.elements.some(item => item.id === element.id)) throw new StudioError('CONFLICT', '元素 ID 已存在。', { elementId: element.id });
      content.elements.push(element); return [element.id];
    }
    if (operation.op === 'update') {
      const id = safeId(operation.id, '元素 ID'), index = content.elements.findIndex(item => item.id === id), current = content.elements[index];
      if (!current) throw new StudioError('NOT_FOUND', '要修改的元素不存在。');
      if (!object(operation.changes)) throw new StudioError('INVALID_ARGUMENT', '修改字段必须是对象。');
      if (current.locked && !(Object.keys(operation.changes).length === 1 && operation.changes.locked === false)) throw new StudioError('LOCKED', '对象已锁定，请先明确解锁后修改。', { elementId: id });
      const { id: _id, version: _version, ...changes } = operation.changes;
      const next = normalizeElement({ ...current, ...copy(changes) }, id); next.version = current.version + 1;
      if (next.type === 'html') next.sourceRevision = current.html === next.html ? current.sourceRevision ?? 1 : Number(current.sourceRevision ?? 0) + 1;
      content.elements[index] = next; return [id];
    }
    if (operation.op === 'delete') { const ids = deletedIds(content, operation); const locked = content.elements.find(element => ids.includes(element.id) && element.locked); if (locked) throw new StudioError('LOCKED', '对象或关联线已锁定，请先解锁。', { elementId: locked.id }); content.elements = content.elements.filter(element => !ids.includes(element.id)); return ids; }
    if (operation.op === 'style') {
      const patch = operation.style ?? {};
      if (!object(patch) || Object.values(patch).some(value => typeof value !== 'string' || value.length > 500)) throw new StudioError('INVALID_ARGUMENT', '样式字段必须是文字。');
      content.style = { ...content.style, ...copy(patch) as Record<string, string> }; return ['$style'];
    }
    if (operation.op === 'motion') { content.motion = copy(operation.data ?? {}); return ['$motion']; }
    if (operation.op === 'layout') {
      const elements = content.elements.filter(item => !operation.ids || operation.ids.includes(item.id));
      const locked = elements.find(item => item.locked); if (locked) throw new StudioError('LOCKED', '整理范围包含锁定对象，请先解锁或缩小范围。', { elementId: locked.id });
      const columns = operation.preset === 'column' ? 1 : operation.preset === 'row' ? Math.max(1, elements.length) : Math.max(1, Math.ceil(Math.sqrt(elements.length)));
      const width = Math.max(220, ...elements.map(item => item.w)), height = Math.max(120, ...elements.map(item => item.h));
      elements.forEach((item, index) => { item.x = finite(operation.data?.x, 80) + index % columns * (width + 64); item.y = finite(operation.data?.y, 80) + Math.floor(index / columns) * (height + 64); item.version++; });
      return elements.map(item => item.id);
    }
    throw new StudioError('INVALID_ARGUMENT', '不支持的白板修改操作。');
  },
  diff(before, after) {
    return [...elementChanges(before, after), ...(['style', 'motion'] as const).flatMap(key => same(before[key], after[key]) ? [] : [{ id: `$${key}`, before: before[key], after: after[key] }])];
  },
  readUnit(content, id) { return id === '$style' ? content.style : id === '$motion' ? content.motion : content.elements.find(item => item.id === id) ?? null; },
  restoreUnit(content, change) {
    if (change.id === '$style') { content.style = copy(change.before) as WhiteboardContent['style']; return; }
    if (change.id === '$motion') { content.motion = copy(change.before) as WhiteboardContent['motion']; return; }
    const index = content.elements.findIndex(item => item.id === change.id);
    if (change.before) { const restored = restoredElement(change.before as BoardElement, change.after as BoardElement | undefined); if (index >= 0) content.elements[index] = restored; else content.elements.push(restored); }
    else if (index >= 0) content.elements.splice(index, 1);
  },
  restore(current, saved) {
    return { elements: saved.elements.map(item => restoredElement(item, current.elements.find(element => element.id === item.id))), style: copy(saved.style), motion: copy(saved.motion) };
  },
  snapshotFeedback(artifactId, feedbackId, snapshots, value) {
    const anchor: Anchor = object(value) ? copy(value) : {};
    if (anchor.elementIds !== undefined && (!Array.isArray(anchor.elementIds) || anchor.elementIds.some(id => typeof id !== 'string'))) throw new StudioError('INVALID_ARGUMENT', '备注元素定位无效。');
    const ids = [...new Set([...(anchor.regionId ? [safeId(anchor.regionId, '区域 ID')] : []), ...(anchor.elementIds ?? [])])];
    const source = anchor.regionId ? htmlSource(snapshots, anchor.regionId, anchor.sourceRevision).snapshot : snapshots[0]!;
    const regions = source.content.elements.filter(element => ids.includes(element.id) && typeof element.html === 'string');
    return { anchor, versions: Object.fromEntries(source.content.elements.filter(element => ids.includes(element.id)).map(element => [element.id, element.version])), sources: regions.map(region => ({ artifactId, feedbackId, html: region.html!, regionId: region.id, sourceRevision: Number(region.sourceRevision ?? 1), version: Number(region.sourceRevision ?? 1) })) };
  },
};

/** Decode the initial unreleased whiteboard format into the same canonical store. */
export function decodeWhiteboardState(value: unknown): WhiteboardState | undefined {
  if (object(value) && value.schemaVersion === 1 && object(value.board)) {
    const legacy = value as unknown as { board: Board; history: { entry: WhiteboardState['history'][number]['entry']; board: Board }[] } & Omit<WhiteboardState, 'artifact' | 'content' | 'history' | 'schemaVersion'>;
    const { board, history, ...rest } = legacy, { artifact, ...content } = board;
    return { ...rest, schemaVersion: 2, artifact, content, history: history.map(saved => { const { artifact: metadata, ...data } = saved.board; return { entry: saved.entry, artifact: metadata, content: data }; }) };
  }
  return;
}

export const whiteboardProduct: ProductDefinition<WhiteboardContent, Operation, Anchor, SourceSnapshot> = {
  adapter: whiteboardAdapter,
  title: '白板',
  defaultTitle: '未命名白板',
  create: (args, base) => initialWhiteboard(args.elements, base),
  initialIds: content => content.elements.map(element => element.id),
  project: snapshot => copy(boardView(snapshot)),
  result: snapshot => ({ board: copy(boardView(snapshot)) }),
  read(state, mode, args) {
    if (mode === 'summary') {
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0)), limit = Math.min(200, Math.max(1, Math.floor(Number(args.limit) || 100)));
      const items = state.content.elements.slice(offset, offset + limit).map(item => ({ id: item.id, type: item.type, label: item.text?.slice(0, 200), version: item.version, sourceRevision: item.sourceRevision, x: item.x, y: item.y, w: item.w, h: item.h }));
      return { artifact: state.artifact, counts: state.content.elements.reduce<Record<string, number>>((out, item) => { out[item.type] = (out[item.type] ?? 0) + 1; return out; }, {}), items, totalCount: state.content.elements.length, offset, ...(offset + limit < state.content.elements.length ? { nextOffset: offset + limit } : {}), feedback: state.feedback.filter(item => item.status !== 'resolved').length };
    }
    if (mode === 'objects') { const ids = Array.isArray(args.ids) ? args.ids : Array.isArray(args.elementIds) ? args.elementIds : undefined; return { artifact: state.artifact, elements: state.content.elements.filter(item => !ids || ids.includes(item.id)) }; }
    if (mode === 'source') {
      if (args.feedbackId) {
        const snapshots = state.sources[safeId(args.feedbackId, '反馈 ID')], snapshot = snapshots?.find(item => args.regionId === undefined || item.regionId === args.regionId);
        if (!snapshot) throw new StudioError('NOT_FOUND', '反馈没有对应的冻结源码。');
        return { ...copy(snapshot), sources: copy(snapshots) };
      }
      const regionId = safeId(args.regionId ?? args.elementId, '区域 ID'), { region } = htmlSource([state, ...state.history.slice().reverse()], regionId, args.sourceRevision);
      return { html: region.html, regionId, sourceRevision: region.sourceRevision ?? 1, version: region.sourceRevision ?? 1, artifactId: state.artifact.id };
    }
    throw new StudioError('INVALID_ARGUMENT', '不支持的白板读取方式。');
  },
  diff(before, after) {
    return { changes: elementChanges(before.content, after.content), style: same(before.content.style, after.content.style) ? undefined : { before: before.content.style, after: after.content.style } };
  },
  rewriteAssetReferences(content, from, to) {
    for (const element of content.elements) for (const key of ['src', 'video'] as const) if (typeof element[key] === 'string') element[key] = element[key]!.replace(`/assets/${from}/`, `/assets/${to}/`);
  },
  validateAsset: validateWhiteboardAsset,
  async thumbnail(snapshot, resources) {
    try { return await whiteboardProduct.export(snapshot, 'svg', { padding: 16, svgRegions: true }, resources); }
    catch (error) { if ((error as { code?: string }).code !== 'EXPORT_BROWSER_REQUIRED') throw error; return whiteboardProduct.export(snapshot, 'svg', { padding: 16 }, resources); }
  },
  async export(snapshot, format, options, resources) {
    const { exportArtifact } = await import('../export.js'); const board = copy(boardView(snapshot));
    if (resources && format !== 'json') {
      const cache = new Map<string, string>();
      const inline = async (reference: string) => { if (!cache.has(reference)) cache.set(reference, await resources.assetDataUri(reference)); return cache.get(reference)!; };
      for (const element of board.elements) {
        for (const key of ['src', 'video'] as const) if (typeof element[key] === 'string' && element[key]!.startsWith('/assets/')) element[key] = await inline(element[key]!);
        if (typeof element.html === 'string') {
          const attributes = /((?:src|href|poster)\s*=\s*["'])(\/assets\/[^"'<>]+)(["'])/gi;
          const urls = /url\(\s*["']?(\/assets\/[^)"']+)["']?\s*\)/gi;
          for (const match of element.html.matchAll(attributes)) await inline(match[2]);
          for (const match of element.html.matchAll(urls)) await inline(match[1]);
          element.html = element.html.replace(attributes, (_, prefix, reference, suffix) => `${prefix}${cache.get(reference)}${suffix}`).replace(urls, (_, reference) => `url("${cache.get(reference)}")`);
        }
      }
    }
    return exportArtifact(board, format, options);
  },
  decodeLegacy: decodeWhiteboardState,
};
