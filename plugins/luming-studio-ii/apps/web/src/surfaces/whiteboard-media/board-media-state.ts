import type {
  AttachBoardImageCommand,
  BoardEditReceipt,
  WhiteboardGeometry,
  WhiteboardPoint,
} from '../../data/whiteboard/index.js';
import type { CanvasViewport } from '../../ui/domain/canvas/index.js';
import type { PreparedBoardImage } from './contracts.js';

const maximumBoardWidth = 480;
const maximumBoardHeight = 360;

type BoardMediaRejection = Extract<BoardEditReceipt, { kind: 'rejected' }>['reason'];

const rejectionMessages: Partial<Record<BoardMediaRejection, string>> = {
  forbidden: '当前没有编辑白板的权限。',
  invalidImage: '白板服务无法读取这张图片。请重新选取文件。',
  tooLarge: '图片大小或像素尺寸超出白板上限。',
  commandIdReuse: '图片保存记录冲突，请重新放置后再保存。',
};

type Pending = { readonly image: PreparedBoardImage; readonly command: AttachBoardImageCommand };
type MediaSaveFailure = { readonly kind: 'uncertain' | 'rejected'; readonly message: string };

export type BoardMediaState =
  | { readonly kind: 'idle' | 'reading' }
  | { readonly kind: 'readFailed'; readonly message: string }
  | { readonly kind: 'placing'; readonly image: PreparedBoardImage }
  | ({ readonly kind: 'saving' } & Pending)
  | (MediaSaveFailure & Pending);

export function imageBoardSize(image: PreparedBoardImage) {
  const scale = Math.min(1, maximumBoardWidth / image.width, maximumBoardHeight / image.height);

  return { width: image.width * scale, height: image.height * scale };
}

export function worldGeometry(
  image: PreparedBoardImage,
  screen: WhiteboardPoint,
  viewport: CanvasViewport,
): WhiteboardGeometry {
  const { width, height } = imageBoardSize(image);
  const x = (screen.x - viewport.x) / viewport.zoom - width / 2;
  const y = (screen.y - viewport.y) / viewport.zoom - height / 2;

  return { x, y, width, height, rotation: 0 };
}

export function previewAtGeometry(geometry: WhiteboardGeometry, viewport: CanvasViewport) {
  return {
    x: (geometry.x + geometry.width / 2) * viewport.zoom + viewport.x,
    y: (geometry.y + geometry.height / 2) * viewport.zoom + viewport.y,
  };
}

export function rejectedImageMessage(receipt: Exclude<BoardEditReceipt, { kind: 'applied' }>) {
  return receipt.kind === 'rejected'
    ? (rejectionMessages[receipt.reason] ?? '这张图片未加入白板。请重新放置后再保存。')
    : '白板已发生变更。请重新放置图片。';
}

export function matchesImageReceipt(command: AttachBoardImageCommand, receipt: BoardEditReceipt) {
  if (receipt.boardId !== command.boardId || receipt.commandId !== command.commandId) {
    return false;
  }

  return (
    receipt.kind !== 'applied' ||
    receipt.objects.some((object) => object.id === command.objectId && object.kind === 'image')
  );
}

export function mediaError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
