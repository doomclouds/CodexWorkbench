import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import {
  Check,
  Clock3,
  Import,
  LayoutGrid,
  List,
  Loader2,
  Moon,
  Pin,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { LibraryMenu } from '../../shared/LibraryMenu';

interface LibraryToolbarProps {
  query: string;
  filter: 'recent' | 'pinned' | 'trash';
  layout: 'grid' | 'list';
  resolvedTheme: 'light' | 'dark';
  busy: boolean;
  creating: boolean;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: LibraryToolbarProps['filter']) => void;
  onLayoutChange: (layout: LibraryToolbarProps['layout']) => void;
  onThemeChange: (theme: LibraryToolbarProps['resolvedTheme']) => void;
  onCreate: () => void;
  onImport: () => void;
  onEmptyTrash?: () => void;
}

export function LibraryToolbar({
  query,
  filter,
  layout,
  resolvedTheme,
  busy,
  creating,
  onQueryChange,
  onFilterChange,
  onLayoutChange,
  onThemeChange,
  onCreate,
  onImport,
  onEmptyTrash,
}: LibraryToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<'filter' | 'create' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const searchVisible = searchOpen || !!query;
  const themeAction = resolvedTheme === 'dark' ? '切换为明亮主题' : '切换为暗色主题';
  const layoutAction = layout === 'grid' ? '切换为列表视图' : '切换为卡片视图';
  const trash = filter === 'trash';
  const searchLabel = trash ? '搜索回收站' : '搜索作品';

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  function closeMenu() {
    (menu === 'filter' ? filterButtonRef : createButtonRef).current?.focus();
    setMenu(null);
  }

  function toggleMenu(target: 'filter' | 'create') {
    setMenu((current) => (current === target ? null : target));
  }

  function handleOpenSearch() {
    setMenu(null);
    if (searchVisible) {
      searchRef.current?.focus();
    } else {
      setSearchOpen(true);
    }
  }

  function handleSearchBlur(event: FocusEvent<HTMLInputElement>) {
    const container = event.currentTarget.closest('.studio-library-search');
    if (!query && !container?.contains(event.relatedTarget)) {
      setSearchOpen(false);
    }
  }

  function handleClearSearch() {
    onQueryChange('');
    setSearchOpen(false);
    searchButtonRef.current?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleClearSearch();
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLButtonElement>, target: 'filter' | 'create') {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMenu(target);
    }
  }

  function handleSelectFilter(value: LibraryToolbarProps['filter']) {
    onFilterChange(value);
    closeMenu();
  }

  function handleSwitchLayout() {
    setMenu(null);
    onLayoutChange(layout === 'grid' ? 'list' : 'grid');
  }

  function handleSwitchTheme() {
    setMenu(null);
    onThemeChange(resolvedTheme === 'dark' ? 'light' : 'dark');
  }

  function handleCreate() {
    onCreate();
    closeMenu();
  }

  function handleImport() {
    onImport();
    closeMenu();
  }

  return (
    <div className="studio-library-controls" role="toolbar" aria-label="作品工具栏">
      <div className={`studio-library-search${searchVisible ? ' is-open' : ''}`}>
        <button
          ref={searchButtonRef}
          type="button"
          className="studio-icon-button"
          aria-label={searchLabel}
          title={searchLabel}
          aria-expanded={searchVisible}
          onClick={handleOpenSearch}
        >
          <Search size={18} />
        </button>
        {searchVisible && (
          <div className="studio-search">
            <input
              ref={searchRef}
              aria-label={trash ? '搜索回收站名称' : '搜索作品名称'}
              placeholder={searchLabel}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onBlur={handleSearchBlur}
              onKeyDown={handleSearchKeyDown}
            />
            <button
              type="button"
              aria-label={query ? '清除搜索' : '收起搜索'}
              className="studio-icon-button"
              onClick={handleClearSearch}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      {!trash && (
        <div className="studio-menu-anchor">
          <button
            ref={filterButtonRef}
            type="button"
            className={`studio-icon-button${filter !== 'recent' ? ' is-active' : ''}`}
            aria-label="筛选作品"
            title="筛选作品"
            aria-haspopup="menu"
            aria-expanded={menu === 'filter'}
            onClick={() => toggleMenu('filter')}
            onKeyDown={(event) => handleMenuKeyDown(event, 'filter')}
          >
            <SlidersHorizontal size={18} />
            {filter !== 'recent' && <span className="studio-filter-dot" />}
          </button>
          {menu === 'filter' && (
            <LibraryMenu
              anchorRef={filterButtonRef}
              label="作品范围"
              className="studio-library-menu"
              onClose={() => setMenu(null)}
            >
              {(
                [
                  ['recent', '最近作品', Clock3],
                  ['pinned', '已固定', Pin],
                  ['trash', '回收站', Trash2],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === value}
                  key={value}
                  onClick={() => handleSelectFilter(value)}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  {filter === value && <Check size={14} />}
                </button>
              ))}
            </LibraryMenu>
          )}
        </div>
      )}
      <button
        type="button"
        className="studio-icon-button studio-view-switch"
        aria-label={layoutAction}
        title={layoutAction}
        onClick={handleSwitchLayout}
      >
        {layout === 'grid' ? <List size={19} /> : <LayoutGrid size={18} />}
      </button>
      <button
        type="button"
        className="studio-icon-button"
        aria-label={themeAction}
        title={themeAction}
        onClick={handleSwitchTheme}
      >
        {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      {trash ? (
        <button
          type="button"
          className="studio-icon-button"
          aria-label="清空回收站"
          title="清空回收站"
          disabled={busy}
          onClick={onEmptyTrash}
        >
          <Trash2 size={18} />
        </button>
      ) : (
        <div className="studio-menu-anchor">
          <button
            ref={createButtonRef}
            type="button"
            className="studio-icon-button studio-library-new"
            aria-label="新建作品"
            title="新建作品"
            aria-haspopup="menu"
            aria-expanded={menu === 'create'}
            disabled={busy}
            onClick={() => toggleMenu('create')}
            onKeyDown={(event) => handleMenuKeyDown(event, 'create')}
          >
            {creating ? <Loader2 className="studio-spin" size={19} /> : <Plus size={21} />}
          </button>
          {menu === 'create' && (
            <LibraryMenu
              anchorRef={createButtonRef}
              label="新建作品"
              className="studio-library-menu"
              onClose={() => setMenu(null)}
            >
              <button type="button" role="menuitem" disabled={busy} onClick={handleCreate}>
                <Share2 size={16} />
                白板
              </button>
              <div className="studio-menu-rule" role="separator" />
              <button type="button" role="menuitem" disabled={busy} onClick={handleImport}>
                <Import size={16} />
                导入作品
              </button>
            </LibraryMenu>
          )}
        </div>
      )}
    </div>
  );
}
