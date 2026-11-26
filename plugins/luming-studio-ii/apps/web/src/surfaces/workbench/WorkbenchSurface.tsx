import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AlertCircle, LayoutGrid, Loader2, Plus } from 'lucide-react';
import {
  createCatalogDirectory,
  type BoardCatalogService,
  type CatalogDirectorySnapshot,
} from '../../data/catalog/index.js';
import { Button } from '../../ui/base/index.js';
import { BoardCard, NewBoardCard } from './WorkbenchCards.js';
import { WorkbenchToolbar } from './WorkbenchToolbar.js';
import type { WorkbenchPreferences } from './preferences.js';
import { useBoardCreation } from './useBoardCreation.js';
import './workbench.css';

export interface WorkbenchSurfaceProps {
  readonly catalog: BoardCatalogService;
  readonly createCommandId: () => string;
  readonly onOpenBoard: (boardId: string) => void;
  readonly preferences: WorkbenchPreferences;
}

type CatalogDirectory = ReturnType<typeof createCatalogDirectory>;
type BoardCreation = ReturnType<typeof useBoardCreation>;

interface CatalogResultsProps {
  readonly snapshot: CatalogDirectorySnapshot;
  readonly directory: CatalogDirectory;
  readonly layout: WorkbenchPreferences['layout'];
  readonly onOpenBoard: (boardId: string) => void;
  readonly creation: BoardCreation;
}

function CreationStatus({ creation }: { readonly creation: BoardCreation }) {
  const { state } = creation;
  if (state.kind === 'creating') {
    return (
      <span className="studio-workbench-sr-only" role="status">
        正在创建白板
      </span>
    );
  }
  if (state.kind === 'checking') {
    return (
      <span className="studio-workbench-sr-only" role="status">
        正在查询创建回执
      </span>
    );
  }
  if (state.kind === 'rejected') {
    return (
      <div className="studio-workbench-error" role="alert">
        <AlertCircle size={16} />
        <span>白板未创建。{state.detail}</span>
      </div>
    );
  }
  if (state.kind === 'unknown') {
    return (
      <div className="studio-workbench-error" role="alert">
        <AlertCircle size={16} />
        <span>创建结果未知。{state.detail}</span>
        <button type="button" onClick={creation.query}>
          查询回执
        </button>
        <button type="button" onClick={creation.retry}>
          重试原创建
        </button>
      </div>
    );
  }

  return null;
}

function EmptyBoards({
  hasQuery,
  creation,
}: {
  readonly hasQuery: boolean;
  readonly creation: BoardCreation;
}) {
  return (
    <div className="studio-workbench-empty">
      <LayoutGrid size={32} />
      <h3>{hasQuery ? '没有找到匹配的作品' : '从第一块白板开始'}</h3>
      <p>{hasQuery ? '试试其他名称。' : '先创建一块空白白板，再与 Codex 一起整理思路。'}</p>
      {!hasQuery && (
        <Button
          label="新建白板"
          icon={<Plus size={16} />}
          disabled={creation.blocked}
          onActivate={creation.create}
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
  creation,
}: CatalogResultsProps) {
  const { kind, boards, error, query, nextCursor, loadingMore } = snapshot;
  const waiting = kind === 'loading' && boards.length === 0;
  const empty = kind === 'ready' && boards.length === 0 && !error;

  return (
    <section className="studio-workbench-works" aria-label="作品管理">
      {error && (
        <div className="studio-workbench-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={directory.reload}>
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
      {empty && <EmptyBoards hasQuery={!!query.trim()} creation={creation} />}
      {boards.length > 0 && (
        <div
          className={'studio-workbench-cards studio-workbench-cards-' + layout}
          aria-busy={kind === 'loading' || loadingMore}
        >
          {boards.map((board) => (
            <BoardCard key={board.boardId} board={board} layout={layout} onOpen={onOpenBoard} />
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

export function WorkbenchSurface({
  catalog,
  createCommandId,
  onOpenBoard,
  preferences,
}: WorkbenchSurfaceProps) {
  const directory = useMemo(() => createCatalogDirectory(catalog), [catalog]);
  const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot);
  const creation = useBoardCreation(catalog, createCommandId, onOpenBoard);

  useEffect(() => directory.open(), [directory]);

  return (
    <div className="studio-workbench" data-studio-theme={preferences.resolvedTheme}>
      <CreationStatus creation={creation} />
      <main className="studio-workbench-main" aria-label="Luming Studio">
        <header className="studio-workbench-header">
          <h1>Luming Studio</h1>
          <WorkbenchToolbar
            query={snapshot.query}
            order={snapshot.order}
            preferences={preferences}
            createBusy={creation.busy}
            createBlocked={creation.blocked}
            onQueryChange={directory.setQuery}
            onOrderChange={directory.setOrder}
            onCreate={creation.create}
          />
        </header>
        <NewBoardCard disabled={creation.blocked} onCreate={creation.create} />
        <CatalogResults
          snapshot={snapshot}
          directory={directory}
          layout={preferences.layout}
          onOpenBoard={onOpenBoard}
          creation={creation}
        />
      </main>
    </div>
  );
}
