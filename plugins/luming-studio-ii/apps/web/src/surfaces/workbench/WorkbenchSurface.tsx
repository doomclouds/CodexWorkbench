import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import { AlertCircle, ArrowLeft, LayoutGrid, Loader2, Plus } from 'lucide-react';
import {
  createCatalogDirectory,
  type BoardCatalogService,
  type CatalogBoardSummary,
  type CatalogDirectory,
  type CatalogDirectorySnapshot,
  type CatalogManagementService,
} from '../../data/catalog/index.js';
import { Button, OperationNotice } from '../../ui/base/index.js';
import {
  BoardCard,
  NewBoardCard,
  type RenderWorkbenchThumbnail,
  type WorkbenchBoardAction,
} from './WorkbenchCards.js';
import { ManagementStatus, RenameBoardDialog } from './WorkbenchManagement.js';
import { WorkbenchToolbar, type WorkbenchSearchExpansion } from './WorkbenchToolbar.js';
import type { WorkbenchPreferences } from './preferences.js';
import { useBoardCreation } from './useBoardCreation.js';
import { useBoardManagement } from './useBoardManagement.js';
import { useCopyBoardLink, type BoardLinkNotice, type CopyBoardLink } from './useCopyBoardLink.js';
import './workbench.css';

interface WorkbenchArchiveImport {
  readonly busy: boolean;
  readonly catalogRefresh: number;
  readonly onFile: (file: File) => void;
}

export interface WorkbenchSurfaceProps {
  readonly catalog: BoardCatalogService;
  readonly directory?: CatalogDirectory;
  readonly createCommandId: () => string;
  readonly onOpenBoard: (boardId: string) => void;
  readonly preferences: WorkbenchPreferences;
  readonly searchExpansion?: WorkbenchSearchExpansion;
  readonly archiveImport?: WorkbenchArchiveImport;
  readonly management?: CatalogManagementService;
  readonly onOpenTrash?: () => void;
  readonly copyBoardLink?: CopyBoardLink;
  readonly onOpenSharing?: (boardId: string) => void;
  readonly renderThumbnail?: RenderWorkbenchThumbnail;
  readonly readRouteGeneration?: () => number;
}

type BoardCreation = ReturnType<typeof useBoardCreation>;

interface CatalogResultsProps {
  readonly snapshot: CatalogDirectorySnapshot;
  readonly directory: CatalogDirectory;
  readonly layout: WorkbenchPreferences['layout'];
  readonly onOpenBoard: (boardId: string) => void;
  readonly createBlocked: boolean;
  readonly onCreate: () => void;
  readonly onManage?: (
    board: CatalogBoardSummary,
    action: WorkbenchBoardAction,
    trigger: HTMLButtonElement,
  ) => void;
  readonly onDuplicate?: (board: CatalogBoardSummary, trigger: HTMLButtonElement) => void;
  readonly onCopyLink?: (boardId: string) => void;
  readonly renderThumbnail?: RenderWorkbenchThumbnail;
}

interface RenameTarget {
  readonly boardId: string;
  readonly title: string;
  readonly trigger: HTMLButtonElement;
}

function CreationStatus({ creation }: { readonly creation: BoardCreation }) {
  const { state } = creation;
  const queryButton = useRef<HTMLButtonElement>(null);
  const copying = state.kind !== 'idle' && state.action === 'duplicate';
  const unknownCopy = state.kind === 'unknown' && copying ? state : undefined;
  useEffect(() => {
    if (unknownCopy) {
      queryButton.current?.focus();
    }
  }, [unknownCopy]);

  if (state.kind === 'creating' || state.kind === 'checking') {
    const message = copying ? copyProgressMessages[state.kind] : createProgressMessages[state.kind];

    return (
      <div
        className={copying ? 'studio-workbench-copy-progress' : 'studio-workbench-sr-only'}
        role="status"
      >
        {copying && <Loader2 size={16} className="studio-workbench-spin" />}
        <span>{message}</span>
      </div>
    );
  }
  if (state.kind === 'rejected') {
    return (
      <div className="studio-workbench-error" role="alert">
        <AlertCircle size={16} />
        <span>
          {copying ? '作品未复制。' : '白板未创建。'}
          {state.detail}
        </span>
      </div>
    );
  }
  if (state.kind === 'unknown') {
    return (
      <div className="studio-workbench-error" role="alert">
        <AlertCircle size={16} />
        <span>
          {copying ? '复制结果未知。' : '创建结果未知。'}
          {state.detail}
        </span>
        <button type="button" ref={queryButton} onClick={creation.query}>
          查询回执
        </button>
        <button type="button" onClick={creation.retry}>
          {copying ? '重试原复制' : '重试原创建'}
        </button>
      </div>
    );
  }

  return null;
}

const createProgressMessages = { creating: '正在创建白板', checking: '正在查询创建回执' };
const copyProgressMessages = { creating: '正在复制作品', checking: '正在查询复制回执' };

function LinkCopyStatus({
  notice,
  dismiss,
}: {
  readonly notice?: BoardLinkNotice;
  readonly dismiss: () => void;
}) {
  const close = useEffectEvent(dismiss);

  useEffect(() => {
    if (!notice || notice.error) {
      return;
    }

    const timer = setTimeout(close, 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) {
    return null;
  }
  if (notice.error) {
    return (
      <div className="studio-workbench-error" role="alert">
        {notice.message}
      </div>
    );
  }

  return (
    <div className="studio-workbench-management-notice">
      <OperationNotice
        id="workbench-copied-link"
        level="success"
        message={notice.message}
        presentation="toast"
        dismissible
        onDismiss={dismiss}
      />
    </div>
  );
}

function EmptyBoards({
  hasQuery,
  pinnedOnly,
  createBlocked,
  onCreate,
}: {
  readonly hasQuery: boolean;
  readonly pinnedOnly: boolean;
  readonly createBlocked: boolean;
  readonly onCreate: () => void;
}) {
  const title = pinnedOnly ? '还没有固定作品' : '从第一块白板开始';
  const detail = pinnedOnly
    ? '把常用作品固定在这里，方便再次打开。'
    : '先创建一块空白白板，再与 Codex 一起整理思路。';
  const canCreate = !hasQuery && !pinnedOnly;

  return (
    <div className="studio-workbench-empty">
      <LayoutGrid size={32} />
      <h3>{hasQuery ? '没有找到匹配的作品' : title}</h3>
      <p>{hasQuery ? '试试其他名称。' : detail}</p>
      {canCreate && (
        <Button
          label="新建白板"
          icon={<Plus size={16} />}
          disabled={createBlocked}
          onActivate={onCreate}
        />
      )}
    </div>
  );
}

function CatalogResults({
  snapshot,
  directory,
  layout,
  onOpenBoard,
  createBlocked,
  onCreate,
  onManage,
  onDuplicate,
  onCopyLink,
  renderThumbnail,
}: CatalogResultsProps) {
  const { kind, boards, error, query, nextCursor, loadingMore, pinnedOnly } = snapshot;
  const waiting = kind === 'loading' && boards.length === 0;
  const empty = kind === 'ready' && boards.length === 0 && !error;
  const retry = nextCursor ? directory.loadMore : directory.reload;
  const cardThumbnail = kind === 'failed' ? undefined : renderThumbnail;

  return (
    <section className="studio-workbench-works" aria-label="作品管理">
      {error && (
        <div className="studio-workbench-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={retry}>
            重试
          </button>
        </div>
      )}
      {waiting && (
        <div className="studio-workbench-empty" role="status">
          <Loader2 size={26} className="studio-workbench-spin" />
          <p>正在读取作品</p>
        </div>
      )}
      {empty && (
        <EmptyBoards
          hasQuery={!!query.trim()}
          pinnedOnly={pinnedOnly}
          createBlocked={createBlocked}
          onCreate={onCreate}
        />
      )}
      {boards.length > 0 && (
        <div
          className={'studio-workbench-cards studio-workbench-cards-' + layout}
          aria-busy={kind === 'loading' || loadingMore}
        >
          {boards.map((board) => (
            <BoardCard
              key={board.boardId}
              board={board}
              layout={layout}
              onOpen={onOpenBoard}
              managementBlocked={createBlocked}
              onAction={onManage}
              onDuplicate={onDuplicate}
              onCopyLink={onCopyLink}
              renderThumbnail={cardThumbnail}
            />
          ))}
        </div>
      )}
      {nextCursor && (
        <div className="studio-workbench-load-more">
          <Button
            label="加载更多"
            icon={loadingMore ? <Loader2 size={16} className="studio-workbench-spin" /> : undefined}
            disabled={loadingMore}
            onActivate={directory.loadMore}
          />
        </div>
      )}
    </section>
  );
}

function WorkbenchTitle({
  pinnedOnly,
  busy,
  onBack,
}: {
  readonly pinnedOnly: boolean;
  readonly busy: boolean;
  readonly onBack: () => void;
}) {
  return (
    <div className="studio-workbench-title">
      {pinnedOnly && (
        <button
          type="button"
          className="studio-workbench-icon-button"
          aria-label="返回 Luming Studio"
          title="返回 Luming Studio"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={21} />
        </button>
      )}
      <h1>{pinnedOnly ? '已固定' : 'Luming Studio'}</h1>
    </div>
  );
}

export function WorkbenchSurface({
  catalog,
  directory: providedDirectory,
  createCommandId,
  onOpenBoard,
  preferences,
  searchExpansion,
  archiveImport,
  management,
  onOpenTrash,
  copyBoardLink,
  onOpenSharing,
  renderThumbnail,
  readRouteGeneration,
}: WorkbenchSurfaceProps) {
  const directory = useMemo(
    () => providedDirectory ?? createCatalogDirectory(catalog),
    [catalog, providedDirectory],
  );
  const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot);
  const creation = useBoardCreation({
    service: catalog,
    createCommandId,
    onOpenBoard,
    readRouteGeneration,
    onDuplicateConfirmed: directory.reload,
  });
  const archiveInput = useRef<HTMLInputElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const duplicateTrigger = useRef<HTMLButtonElement | undefined>(undefined);
  const [rename, setRename] = useState<RenameTarget>();
  const controls = useBoardManagement(management, createCommandId, handleManaged, directory.reload);
  const linkCopy = useCopyBoardLink(copyBoardLink, onOpenSharing);
  const createBlocked = creation.blocked || archiveImport?.busy === true || controls.blocked;
  const catalogRefresh = archiveImport?.catalogRefresh ?? 0;
  const observedRefresh = useRef(catalogRefresh);
  const duplicateRejected =
    creation.state.kind === 'rejected' && creation.state.action === 'duplicate'
      ? creation.state
      : undefined;

  useEffect(() => directory.open(), [directory]);

  useEffect(() => {
    if (!duplicateRejected) {
      return;
    }

    const trigger = duplicateTrigger.current;
    duplicateTrigger.current = undefined;
    if (trigger?.isConnected && !trigger.disabled) {
      trigger.focus();
    } else {
      filterButton.current?.focus();
    }
  }, [duplicateRejected]);

  useEffect(() => {
    if (observedRefresh.current !== catalogRefresh) {
      observedRefresh.current = catalogRefresh;
      directory.reload();
    }
  }, [catalogRefresh, directory]);

  function openArchivePicker() {
    archiveInput.current?.click();
  }

  function handleBackFromPinned() {
    directory.setPinnedOnly(false, true);
    filterButton.current?.focus();
  }

  function handleArchiveInput(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file && !createBlocked) {
      archiveImport?.onFile(file);
    }
  }

  function handleManaged() {
    filterButton.current?.focus();
    directory.reload();
    setRename(undefined);
  }

  function handleManage(
    board: CatalogBoardSummary,
    action: WorkbenchBoardAction,
    trigger: HTMLButtonElement,
  ) {
    if (createBlocked || board.canManage !== true) {
      return;
    }

    if (action === 'rename') {
      controls.dismiss();
      setRename({ boardId: board.boardId, title: board.title, trigger });
      return;
    }

    controls.manage(
      board,
      action === 'pin' ? { kind: 'pin', pinned: !board.pinned } : { kind: 'trash' },
    );
  }

  function handleDuplicate(board: CatalogBoardSummary, trigger: HTMLButtonElement) {
    if (!createBlocked && board.canManage === true) {
      duplicateTrigger.current = trigger;
      creation.duplicate(board.boardId);
    }
  }

  const renamingBoard = snapshot.boards.find(({ boardId }) => boardId === rename?.boardId);

  function handleSaveRename(title: string) {
    if (!createBlocked && renamingBoard?.canManage === true) {
      controls.manage(renamingBoard, { kind: 'rename', title });
    }
  }

  function restoreRenameFocus(trigger: HTMLButtonElement) {
    if (trigger.isConnected) {
      trigger.focus();
      return;
    }

    filterButton.current?.focus();
  }

  return (
    <div className="studio-workbench" data-studio-theme={preferences.resolvedTheme}>
      <CreationStatus creation={creation} />
      {!rename && <ManagementStatus management={controls} />}
      <LinkCopyStatus notice={linkCopy.notice} dismiss={linkCopy.dismiss} />
      <main className="studio-workbench-main" aria-label="Luming Studio">
        <header className="studio-workbench-header">
          <WorkbenchTitle
            pinnedOnly={snapshot.pinnedOnly}
            busy={createBlocked}
            onBack={handleBackFromPinned}
          />
          <WorkbenchToolbar
            query={snapshot.query}
            searchExpansion={searchExpansion}
            pinnedOnly={snapshot.pinnedOnly}
            preferences={preferences}
            createBusy={creation.createBusy}
            createBlocked={createBlocked}
            onQueryChange={directory.setQuery}
            onPinnedOnlyChange={directory.setPinnedOnly}
            onCreate={creation.create}
            onImport={archiveImport ? openArchivePicker : undefined}
            onOpenTrash={onOpenTrash}
            filterButton={filterButton}
          />
        </header>
        <NewBoardCard disabled={createBlocked} onCreate={creation.create} />
        {archiveImport && (
          <input
            ref={archiveInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            aria-label="导入作品"
            onChange={handleArchiveInput}
          />
        )}
        <CatalogResults
          snapshot={snapshot}
          directory={directory}
          layout={preferences.layout}
          onOpenBoard={onOpenBoard}
          createBlocked={createBlocked}
          onCreate={creation.create}
          onManage={management ? handleManage : undefined}
          onDuplicate={catalog.duplicateBoard ? handleDuplicate : undefined}
          onCopyLink={linkCopy.copy}
          renderThumbnail={renderThumbnail}
        />
      </main>
      {rename && (
        <RenameBoardDialog
          initialTitle={rename.title}
          blocked={createBlocked || renamingBoard?.canManage !== true}
          management={controls}
          onClose={() => setRename(undefined)}
          onSave={handleSaveRename}
          restoreFocus={() => restoreRenameFocus(rename.trigger)}
        />
      )}
    </div>
  );
}
