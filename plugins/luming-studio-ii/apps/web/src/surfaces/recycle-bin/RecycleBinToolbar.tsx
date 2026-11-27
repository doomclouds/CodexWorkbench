import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type Ref } from 'react';
import { ArrowLeft, LayoutGrid, List, Moon, Search, Sun, Trash2, X } from 'lucide-react';

export interface RecycleBinPreferences {
  readonly layout: 'grid' | 'list';
  readonly resolvedTheme: 'light' | 'dark';
  readonly onLayoutChange: (layout: RecycleBinPreferences['layout']) => void;
  readonly onThemeChange: (theme: RecycleBinPreferences['resolvedTheme']) => void;
}

export interface RecycleSearchExpansion {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}

interface RecycleBinToolbarProps {
  readonly query: string;
  readonly searchExpansion?: RecycleSearchExpansion;
  readonly busy: boolean;
  readonly available: boolean;
  readonly preferences: RecycleBinPreferences;
  readonly onBack: () => void;
  readonly onQueryChange?: (query: string) => void;
  readonly emptyButton?: Ref<HTMLButtonElement>;
  readonly onEmpty?: (trigger: HTMLButtonElement) => void;
}

export function RecycleBinToolbar({
  query,
  searchExpansion,
  busy,
  available,
  preferences,
  onBack,
  onQueryChange,
  emptyButton,
  onEmpty,
}: RecycleBinToolbarProps) {
  const { layout, resolvedTheme, onLayoutChange, onThemeChange } = preferences;
  const [localSearchOpen, setLocalSearchOpen] = useState(false);
  const searchOpen = searchExpansion?.expanded ?? localSearchOpen;
  const setSearchOpen = searchExpansion?.onExpandedChange ?? setLocalSearchOpen;
  const focusSearchOnOpen = useRef(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchGroup = useRef<HTMLDivElement>(null);
  const searchVisible = searchOpen || query !== '';
  const grid = layout === 'grid';
  const dark = resolvedTheme === 'dark';
  const layoutLabel = grid ? '切换为列表视图' : '切换为卡片视图';
  const themeLabel = dark ? '切换为明亮主题' : '切换为暗色主题';

  useEffect(() => {
    if (searchOpen && focusSearchOnOpen.current) {
      focusSearchOnOpen.current = false;
      searchInput.current?.focus();
    }
  }, [searchOpen]);

  function handleOpenSearch() {
    if (searchVisible) {
      searchInput.current?.focus();
      return;
    }

    focusSearchOnOpen.current = true;
    setSearchOpen(true);
  }

  function handleCloseSearch() {
    onQueryChange?.('');
    setSearchOpen(false);
    searchButton.current?.focus();
  }

  function handleSearchBlur(event: FocusEvent<HTMLInputElement>) {
    if (!query && !searchGroup.current?.contains(event.relatedTarget)) {
      setSearchOpen(false);
    }
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleCloseSearch();
    }
  }

  return (
    <header className="studio-recycle-header">
      <div className="studio-recycle-title">
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label="返回 Luming Studio"
          title="返回 Luming Studio"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={21} />
        </button>
        <h1>回收站</h1>
      </div>
      <div className="studio-recycle-controls" role="toolbar" aria-label="作品工具栏">
        <div className="studio-recycle-search-group" ref={searchGroup} data-open={searchVisible}>
          <button
            ref={searchButton}
            type="button"
            className="studio-recycle-icon"
            aria-label="搜索回收站"
            title="搜索回收站"
            aria-expanded={searchVisible}
            disabled={busy || !available}
            onClick={handleOpenSearch}
          >
            <Search size={18} />
          </button>
          {searchVisible && (
            <div className="studio-recycle-search">
              <input
                ref={searchInput}
                aria-label="搜索回收站名称"
                placeholder="搜索回收站"
                value={query}
                disabled={busy}
                onChange={(event) => onQueryChange?.(event.currentTarget.value)}
                onBlur={handleSearchBlur}
                onKeyDown={handleSearchKey}
              />
              <button
                type="button"
                className="studio-recycle-icon"
                aria-label={query ? '清除搜索' : '收起搜索'}
                disabled={busy}
                onClick={handleCloseSearch}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label={layoutLabel}
          title={layoutLabel}
          onClick={() => onLayoutChange(grid ? 'list' : 'grid')}
        >
          {grid ? <List size={19} /> : <LayoutGrid size={18} />}
        </button>
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label={themeLabel}
          title={themeLabel}
          onClick={() => onThemeChange(dark ? 'light' : 'dark')}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label="清空回收站"
          title="清空回收站"
          disabled={busy || !available}
          ref={emptyButton}
          onClick={(event) => onEmpty?.(event.currentTarget)}
        >
          <Trash2 size={18} />
        </button>
      </div>
    </header>
  );
}
