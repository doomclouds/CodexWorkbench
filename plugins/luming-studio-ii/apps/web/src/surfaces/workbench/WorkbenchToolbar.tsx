import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  ArrowDownAZ,
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
import type { CatalogDirectorySnapshot } from '../../data/catalog/index.js';
import { WorkbenchMenu } from './WorkbenchMenu.js';
import type { WorkbenchPreferences } from './preferences.js';

type CatalogOrder = CatalogDirectorySnapshot['order'];
type ToolbarMenu = 'filter' | 'create';

interface OpenMenu {
  readonly kind: ToolbarMenu;
  readonly anchor: HTMLButtonElement;
}

interface WorkbenchToolbarProps {
  readonly query: string;
  readonly order: CatalogOrder;
  readonly preferences: WorkbenchPreferences;
  readonly createBusy: boolean;
  readonly createBlocked: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onOrderChange: (order: CatalogOrder) => void;
  readonly onCreate: () => void;
  readonly onImport?: () => void;
}

const orderOptions = [
  { value: 'recent', label: '最近作品', icon: Clock3 },
  { value: 'title', label: '按名称', icon: ArrowDownAZ },
] as const;
const unsupported = '当前阶段暂不支持';

export function WorkbenchToolbar({
  query,
  order,
  preferences,
  createBusy,
  createBlocked,
  onQueryChange,
  onOrderChange,
  onCreate,
  onImport,
}: WorkbenchToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<OpenMenu>();
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchGroup = useRef<HTMLDivElement>(null);
  const searchVisible = searchOpen || !!query;
  const { layout, resolvedTheme } = preferences;
  const layoutAction = layout === 'grid' ? '切换为列表视图' : '切换为卡片视图';
  const themeAction = resolvedTheme === 'dark' ? '切换为明亮主题' : '切换为暗色主题';

  useEffect(() => {
    if (searchOpen) {
      searchInput.current?.focus();
    }
  }, [searchOpen]);

  function closeMenu() {
    setMenu(undefined);
  }

  function finishMenuAction() {
    menu?.anchor.focus();
    closeMenu();
  }

  function switchMenu(event: MouseEvent<HTMLButtonElement>, kind: ToolbarMenu) {
    const anchor = event.currentTarget;
    setMenu((current) => (current?.kind === kind ? undefined : { kind, anchor }));
  }

  function openMenuFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, kind: ToolbarMenu) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMenu({ kind, anchor: event.currentTarget });
    }
  }

  function handleOpenSearch() {
    closeMenu();
    if (searchVisible) {
      searchInput.current?.focus();
      return;
    }

    setSearchOpen(true);
  }

  function handleSearchBlur(event: FocusEvent<HTMLInputElement>) {
    if (!query && !searchGroup.current?.contains(event.relatedTarget)) {
      setSearchOpen(false);
    }
  }

  function handleClearSearch() {
    onQueryChange('');
    setSearchOpen(false);
    searchButton.current?.focus();
  }

  function handleSearchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleClearSearch();
    }
  }

  function handleSwitchLayout() {
    closeMenu();
    preferences.onLayoutChange(layout === 'grid' ? 'list' : 'grid');
  }

  function handleSwitchTheme() {
    closeMenu();
    preferences.onThemeChange(resolvedTheme === 'dark' ? 'light' : 'dark');
  }

  function chooseOrder(value: CatalogOrder) {
    onOrderChange(value);
    finishMenuAction();
  }

  function handleCreateBoard() {
    finishMenuAction();
    onCreate();
  }

  function handleImport() {
    onImport?.();
    finishMenuAction();
  }

  return (
    <div className="studio-workbench-controls" role="toolbar" aria-label="作品工具栏">
      <div ref={searchGroup} className="studio-workbench-search-group" data-open={searchVisible}>
        <button
          ref={searchButton}
          type="button"
          className="studio-workbench-icon-button"
          aria-label="搜索作品"
          title="搜索作品"
          aria-expanded={searchVisible}
          onClick={handleOpenSearch}
        >
          <Search size={18} />
        </button>
        {searchVisible && (
          <div className="studio-workbench-search">
            <input
              ref={searchInput}
              aria-label="搜索作品名称"
              placeholder="搜索作品"
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              onBlur={handleSearchBlur}
              onKeyDown={handleSearchKeys}
            />
            <button
              type="button"
              className="studio-workbench-icon-button"
              aria-label={query ? '清除搜索' : '收起搜索'}
              onClick={handleClearSearch}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="studio-workbench-icon-button"
        aria-label="筛选作品"
        title="筛选作品"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'filter'}
        data-active={order !== 'recent' || undefined}
        onClick={(event) => switchMenu(event, 'filter')}
        onKeyDown={(event) => openMenuFromKeyboard(event, 'filter')}
      >
        <SlidersHorizontal size={18} />
        {order !== 'recent' && <span className="studio-workbench-filter-dot" />}
      </button>
      <button
        type="button"
        className="studio-workbench-icon-button"
        aria-label={layoutAction}
        title={layoutAction}
        onClick={handleSwitchLayout}
      >
        {layout === 'grid' ? <List size={19} /> : <LayoutGrid size={18} />}
      </button>
      <button
        type="button"
        className="studio-workbench-icon-button"
        aria-label={themeAction}
        title={themeAction}
        onClick={handleSwitchTheme}
      >
        {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button
        type="button"
        className="studio-workbench-icon-button studio-workbench-new"
        aria-label="新建作品"
        title="新建作品"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'create'}
        disabled={createBlocked}
        onClick={(event) => switchMenu(event, 'create')}
        onKeyDown={(event) => openMenuFromKeyboard(event, 'create')}
      >
        {createBusy ? <Loader2 className="studio-workbench-spin" size={19} /> : <Plus size={21} />}
      </button>
      {menu?.kind === 'filter' && (
        <WorkbenchMenu anchor={menu.anchor} label="作品范围" toolbar onClose={closeMenu}>
          {orderOptions.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              key={value}
              role="menuitemradio"
              aria-checked={order === value}
              onClick={() => chooseOrder(value)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {order === value && <Check size={14} />}
            </button>
          ))}
          <button type="button" role="menuitem" title={unsupported} disabled>
            <Pin size={16} />
            <span>已固定</span>
          </button>
          <button type="button" role="menuitem" title={unsupported} disabled>
            <Trash2 size={16} />
            <span>回收站</span>
          </button>
        </WorkbenchMenu>
      )}
      {menu?.kind === 'create' && (
        <WorkbenchMenu anchor={menu.anchor} label="新建作品" onClose={closeMenu}>
          <button
            type="button"
            role="menuitem"
            disabled={createBlocked}
            onClick={handleCreateBoard}
          >
            <Share2 size={16} />
            <span>白板</span>
          </button>
          <div className="studio-workbench-menu-rule" role="separator" />
          <button
            type="button"
            role="menuitem"
            title={onImport ? undefined : unsupported}
            disabled={!onImport || createBlocked}
            onClick={handleImport}
          >
            <Import size={16} />
            <span>导入作品</span>
          </button>
        </WorkbenchMenu>
      )}
    </div>
  );
}
