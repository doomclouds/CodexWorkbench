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

function SearchIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function StickerPalette({ selectedId, onSelect, disabled, onUpload }: StickerPaletteProps) {
  const [search, setSearch] = useState('');
  const matches = matchingStickers(search);

  return (
    <section className="luming-sticker-palette" aria-label="贴纸库">
      <div className="luming-sticker-palette__search">
        <SearchIcon />
        <SearchField
          label="搜索贴纸"
          clearLabel="清除贴纸搜索"
          value={search}
          onValueChange={setSearch}
          disabled={disabled}
        />
      </div>
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
          <SearchIcon size={24} />
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
