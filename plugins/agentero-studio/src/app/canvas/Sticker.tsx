import { boardStickerMarkup, getBoardSticker } from '../../core/products/whiteboard-stickers.js';

export default function Sticker({ id }: { id: unknown }) {
  const sticker = getBoardSticker(id);
  if (!sticker) return null;
  return <svg className="studio-vector-sticker" viewBox="0 0 24 24" role="img" aria-label={sticker.label} data-sticker-icon-id={sticker.id} dangerouslySetInnerHTML={{ __html: boardStickerMarkup(sticker.id)! }} />;
}
