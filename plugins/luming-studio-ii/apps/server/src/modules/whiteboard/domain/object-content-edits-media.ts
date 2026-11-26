import type { JsonObject, JsonValue } from './model.js';
import {
  contentRecord,
  type ContentOperation,
  type ContentPayloadPlan,
} from './object-content-edits.js';

type CropOperation = Extract<ContentOperation, { kind: 'crop' }>;
type StickerSelection = Extract<ContentOperation, { kind: 'sticker' }>['selection'];

interface CropAssets {
  readonly boardId: string;
  readonly hasAsset: (assetId: string) => boolean;
}

const assetPath = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
const maxNaturalSize = 0xffff_ffff;
const maxCropZoom = 10;
const maxStickerFallbackLength = 64 * 1024;
const maxStickerLabelLength = 160;
const stickers = new Map([
  ['smile', '笑脸'],
  ['plus', '加号'],
  ['thumbs-up', '赞同'],
  ['thumbs-down', '不赞同'],
  ['heart', '爱心'],
  ['wave', '挥手'],
  ['clap', '鼓掌'],
  ['handshake', '握手'],
  ['heart-hand', '用心支持'],
  ['bulb', '想法'],
  ['question', '问题'],
  ['alert', '提醒'],
  ['check', '完成'],
  ['cross', '取消'],
  ['flag', '旗帜'],
  ['bolt', '闪电'],
  ['pin', '地点'],
  ['search', '发现'],
  ['key', '钥匙'],
  ['party', '庆祝'],
  ['trophy', '奖杯'],
  ['crown', '皇冠'],
  ['gift', '礼物'],
  ['clock', '时钟'],
  ['calendar', '日历'],
  ['hourglass', '沙漏'],
  ['messages', '讨论'],
  ['megaphone', '公告'],
  ['pencil', '铅笔'],
  ['chart', '增长图表'],
  ['trending-up', '向上趋势'],
  ['send', '纸飞机'],
  ['sun', '太阳'],
  ['sprout', '萌芽'],
  ['flower', '花朵'],
  ['coffee', '咖啡'],
  ['piggy-bank', '储蓄罐'],
  ['arrow-right', '向右'],
  ['arrow-up', '向上'],
  ['repeat', '循环'],
  ['target', '目标'],
  ['rocket', '火箭'],
]);

export function editStickerContent(
  current: JsonObject,
  selection: StickerSelection,
): ContentPayloadPlan {
  if (selection.kind === 'legacy') {
    const { fallback } = selection;
    const currentId = current.stickerId;
    const isGraphic = typeof currentId === 'string' && stickers.has(currentId);
    if (isGraphic || fallback.length > maxStickerFallbackLength) {
      return { kind: 'rejected', reason: 'invalidEdit' };
    }

    const data: JsonObject = { ...current, fallback };
    delete data.stickerId;

    return { kind: 'updated', label: fallback.trim().slice(0, maxStickerLabelLength), data };
  }

  const label = stickers.get(selection.id);
  if (!label) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  return { kind: 'updated', label, data: { ...current, stickerId: selection.id } };
}

function hasLocalSource(src: JsonValue | undefined, assets: CropAssets): boolean {
  if (typeof src !== 'string') {
    return false;
  }

  const [, boardId, assetId] = assetPath.exec(src) ?? [];

  return boardId === assets.boardId && assetId !== undefined && assets.hasAsset(assetId);
}

function fittedCoordinate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function naturalDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= maxNaturalSize;
}

function priorZoom(current: JsonObject): number {
  const zoom = contentRecord(current.crop)?.zoom;

  return typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : 0;
}

export function editImageCrop(
  current: JsonObject,
  label: string,
  { crop, naturalSize }: CropOperation,
  assets: CropAssets,
): ContentPayloadPlan {
  const zoomInRange =
    Number.isFinite(crop.zoom) &&
    crop.zoom >= 1 &&
    crop.zoom <= Math.max(maxCropZoom, priorZoom(current));
  const offsetsInRange = fittedCoordinate(crop.x) && fittedCoordinate(crop.y);
  const validSize = [naturalSize.width, naturalSize.height].every(naturalDimension);
  if (!zoomInRange || !offsetsInRange || !validSize) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }
  if (!hasLocalSource(current.src, assets)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  const data = { ...current, crop: { ...crop }, naturalSize: { ...naturalSize } };

  return { kind: 'updated', label, data };
}
