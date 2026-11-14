import { useState } from 'react';
import { ImagePlus, Search, X } from 'lucide-react';
import { BOARD_STICKERS, type BoardSticker } from '../../core/products/whiteboard-stickers.js';
import Sticker from './Sticker.js';

export default function StickerPalette({ selectedId, onSelect, onUpload }: { selectedId: string; onSelect: (sticker: BoardSticker) => void; onUpload: () => void }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const matches = BOARD_STICKERS.filter(sticker => `${sticker.id} ${sticker.label} ${sticker.keywords}`.toLocaleLowerCase().includes(query));
  return <div className="studio-shape-options studio-sticker-menu" data-native-interactive="true" aria-label="贴纸库">
    <div className="studio-sticker-search"><Search size={16} /><input type="search" aria-label="搜索贴纸" placeholder="搜索贴纸" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="清除贴纸搜索" onClick={() => setSearch('')}><X size={15} /></button>}</div>
    <div className="studio-sticker-grid" role="group" aria-label="彩色图形贴纸">{matches.map(sticker => <button type="button" key={sticker.id} aria-label={`贴纸 ${sticker.label}`} aria-pressed={selectedId === sticker.id} title={sticker.label} onClick={() => onSelect(sticker)}><Sticker id={sticker.id} /></button>)}</div>
    {!matches.length && <div className="studio-sticker-empty" role="status"><Search size={24} /><p>没有找到贴纸</p><button type="button" onClick={() => setSearch('')}>清除搜索</button></div>}
    <button type="button" className="studio-media-upload" onClick={onUpload}><ImagePlus size={17} />上传图片或视频</button>
  </div>;
}
