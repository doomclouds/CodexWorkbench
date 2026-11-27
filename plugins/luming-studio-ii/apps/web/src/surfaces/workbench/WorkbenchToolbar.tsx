import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from 'react';
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
import { WorkbenchMenu } from './WorkbenchMenu.js';
import type { WorkbenchPreferences } from './preferences.js';

type ToolbarMenu = 'filter' | 'create';

interface OpenMenu {
  readonly kind: ToolbarMenu;
  readonly anchor: HTMLButtonElement;
  readonly keepTriggerFocus?: boolean;
}

export interface WorkbenchSearchExpansion {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}

interface WorkbenchToolbarProps {
  readonly query: string;
  readonly searchExpansion?: WorkbenchSearchExpansion;
  readonly pinnedOnly: boolean;
  readonly preferences: WorkbenchPreferences;
  readonly createBusy: boolean;
  readonly createBlocked: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onPinnedOnlyChange: (pinnedOnly: boolean) => void;
  readonly onCreate: () => void;
  readonly onImport?: () => void;
  readonly onOpenTrash?: () => void;
  readonly filterButton?: Ref<HTMLButtonElement>;
}

const scopeOptions = [
  { pinned: false, label: '最近作品', icon: Clock3 },
  { pinned: true, label: '已固定', icon: Pin },
] as const;
const unsupported = '当前阶段暂不支持';

function useWorkbenchSearch(query: string, expansion: WorkbenchSearchExpansion | undefined) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = expansion?.expanded ?? localOpen;
  const setOpen = expansion?.onExpandedChange ?? setLocalOpen;
  const input = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef(false);

  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      input.current?.focus();
    }
  }, [open]);

  function expand() {
    focusOnOpen.current = true;
    setOpen(true);
  }

  return { searchVisible: open || !!query, searchInput: input, setSearchOpen: setOpen, expand };
}

export function WorkbenchToolbar({
  query,
  searchExpansion,
  pinnedOnly,
  preferences,
  createBusy,
  createBlocked,
  onQueryChange,
  onPinnedOnlyChange,
  onCreate,
  onImport,
  onOpenTrash,
  filterButton,
}: WorkbenchToolbarProps) {
  const { searchVisible, searchInput, setSearchOpen, expand } = useWorkbenchSearch(
    query,
    searchExpansion,
  );
  const [menu, setMenu] = useState<OpenMenu>();
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchGroup = useRef<HTMLDivElement>(null);
  const { layout, resolvedTheme } = preferences;
  const layoutAction = layout === 'grid' ? '切换为列表视图' : '切换为卡片视图';
  const themeAction = resolvedTheme === 'dark' ? '切换为明亮主题' : '切换为暗色主题';

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
      setMenu({ kind, anchor: event.currentTarget, keepTriggerFocus: kind === 'filter' });
    }
  }

  function handleOpenSearch() {
    closeMenu();
    if (searchVisible) {
      searchInput.current?.focus();
      return;
    }

    expand();
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

  function chooseScope(pinned: boolean) {
    onPinnedOnlyChange(pinned);
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

  function handleOpenTrash() {
    finishMenuAction();
    onOpenTrash?.();
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
        ref={filterButton}
        type="button"
        className="studio-workbench-icon-button"
        aria-label="筛选作品"
        title="筛选作品"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'filter'}
        data-active={pinnedOnly || undefined}
        onClick={(event) => switchMenu(event, 'filter')}
        onKeyDown={(event) => openMenuFromKeyboard(event, 'filter')}
      >
        <SlidersHorizontal size={18} />
        {pinnedOnly && <span className="studio-workbench-filter-dot" />}
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
        <WorkbenchMenu
          anchor={menu.anchor}
          label="作品范围"
          initialFocus={menu.keepTriggerFocus ? 'trigger' : undefined}
          toolbar
          onClose={closeMenu}
        >
          {scopeOptions.map(({ pinned, label, icon: Icon }) => (
            <button
              type="button"
              key={label}
              role="menuitemradio"
              aria-checked={pinnedOnly === pinned}
              onClick={() => chooseScope(pinned)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {pinnedOnly === pinned && <Check size={14} />}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={false}
            title={onOpenTrash ? undefined : unsupported}
            disabled={!onOpenTrash}
            onClick={handleOpenTrash}
          >
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
