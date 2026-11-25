import { useState } from 'react';
import { Button, SearchField, StatusText } from '../../../base/index.js';
import { stickerCatalog } from './sticker-catalog.js';
import type { StickerPreset } from './sticker-catalog.js';
import { StickerObject } from './StickerObject.js';

export interface StickerPaletteProps {
  readonly selectedId?: string;
  readonly onSelect: (sticker: StickerPreset) => void;
  readonly disabled?: boolean;
  readonly onUpload?: () => void;
}

function matchingStickers(search: string): readonly StickerPreset[] {
  const query = search.trim().toLocaleLowerCase();

  return stickerCatalog.filter(({ id, label, keywords }) =>
    (id + ' ' + label + ' ' + keywords).toLocaleLowerCase().includes(query),
  );
}

export function StickerPalette({ selectedId, onSelect, disabled, onUpload }: StickerPaletteProps) {
  const [search, setSearch] = useState('');
  const matches = matchingStickers(search);

  return (
    <section className="luming-sticker-palette" aria-label="贴纸库">
      <SearchField
        label="搜索贴纸"
        clearLabel="清除贴纸搜索"
        value={search}
        onValueChange={setSearch}
        disabled={disabled}
      />
      <div className="luming-sticker-palette__grid" role="group" aria-label="彩色图形贴纸">
        {matches.map((sticker) => (
          <button
            type="button"
            key={sticker.id}
            className="luming-sticker-palette__preview"
            aria-label={'贴纸 ' + sticker.label}
            aria-pressed={selectedId === sticker.id}
            title={sticker.label}
            disabled={disabled}
            onClick={() => onSelect(sticker)}
          >
            <StickerObject id={sticker.id} />
          </button>
        ))}
      </div>
      {matches.length === 0 && (
        <div className="luming-sticker-palette__empty">
          <StatusText message="没有找到贴纸" announcement="polite" />
          <Button
            label="清除搜索"
            variant="ghost"
            disabled={disabled}
            onActivate={() => setSearch('')}
          />
        </div>
      )}
      {onUpload && <Button label="上传图片或视频" disabled={disabled} onActivate={onUpload} />}
    </section>
  );
}
