import { useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { CatalogManagementService } from '../../data/catalog/index.js';
import {
  Button,
  Dialog,
  OperationNotice,
  StatePanel,
  type ButtonHandle,
} from '../../ui/base/index.js';
import { RecycleBinCards, RecycleSelection } from './RecycleBinCards.js';
import { RecycleBinToolbar, type RecycleBinPreferences } from './RecycleBinToolbar.js';
import { toRecycleTarget, type PurgeScope } from './recycle-bin-commands.js';
import { useRecycleBinActions } from './useRecycleBinActions.js';
import { useRecycleBinDirectory } from './useRecycleBinDirectory.js';
import './recycle-bin.css';

export interface RecycleBinSurfaceProps {
  readonly management?: CatalogManagementService;
  readonly createCommandId: () => string;
  readonly onBack: () => void;
  readonly preferences: RecycleBinPreferences;
}

interface LiveRecycleBinProps extends RecycleBinSurfaceProps {
  readonly management: CatalogManagementService;
}

type Directory = ReturnType<typeof useRecycleBinDirectory>;
type Actions = ReturnType<typeof useRecycleBinActions>;

interface PurgeDialogProps {
  readonly scope: PurgeScope;
  readonly purging: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function PurgeDialog({ scope, purging, onCancel, onConfirm }: PurgeDialogProps) {
  const cancel = useRef<ButtonHandle>(null);
  const quantity = scope.targets.length;
  const single = quantity === 1 ? scope.targets[0]?.title : undefined;
  const confirmLabel = scope.all ? '清空回收站' : '永久删除';

  return (
    <Dialog
      open
      title={scope.all ? '清空回收站' : '永久删除作品'}
      description={'将永久删除 ' + quantity + ' 项作品，此操作无法恢复。'}
      closeLabel="关闭"
      initialFocus={() => cancel.current?.focus()}
      dismissPolicy={{ escape: !purging, backdrop: !purging }}
      onRequestClose={onCancel}
    >
      {single && <p className="studio-recycle-purge-target">{single}</p>}
      <div className="studio-recycle-purge-actions">
        <Button ref={cancel} label="取消" disabled={purging} onActivate={onCancel} />
        <div className="studio-recycle-destructive">
          <Button
            label={purging ? '正在删除…' : confirmLabel}
            icon={<Trash2 size={15} />}
            disabled={purging}
            onActivate={onConfirm}
          />
        </div>
      </div>
    </Dialog>
  );
}

function RecycleFeedback({ actions }: { readonly actions: Actions }) {
  const { notice, failures, dismissNotice } = actions;

  return (
    <>
      {notice && (
        <OperationNotice
          id="recycle-bin-feedback"
          level={notice.kind}
          message={notice.message}
          dismissible
          onDismiss={dismissNotice}
        />
      )}
      {failures.length > 0 && (
        <div className="studio-recycle-failures" role="alert">
          <strong>{failures.length} 项作品未删除，已保留选择。</strong>
          <ul>
            {failures.map(({ target, message }) => (
              <li key={target.boardId}>
                <span>{target.title}</span>
                <span>{message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function RecycleResults({
  directory,
  actions,
  layout,
}: {
  readonly directory: Directory;
  readonly actions: Actions;
  readonly layout: RecycleBinPreferences['layout'];
}) {
  if (directory.status === 'loading' && !directory.boards.length) {
    return <StatePanel kind="initial-loading" title="正在读取作品" />;
  }
  if (directory.status === 'failed' && !directory.boards.length) {
    return (
      <StatePanel
        kind="error"
        title={directory.error ?? '无法读取回收站。'}
        action={<Button label="重试" onActivate={directory.retry} />}
      />
    );
  }
  if (!directory.boards.length) {
    return (
      <div className="studio-recycle-empty">
        <Trash2 size={32} />
        <h3>{directory.query ? '没有找到匹配的作品' : '回收站为空'}</h3>
        <p>{directory.query ? '试试其他名称。' : '移入回收站的作品可以在这里恢复。'}</p>
      </div>
    );
  }

  const disabled = Boolean(actions.activity);
  const loading = directory.status === 'loading';

  return (
    <div aria-busy={loading}>
      <RecycleBinCards
        boards={directory.boards}
        selected={actions.selected}
        layout={layout}
        busy={disabled}
        onSelect={actions.toggleSelection}
        onRestore={actions.restore}
        onDelete={actions.confirmSelected}
      />
      {directory.nextCursor && (
        <div className="studio-recycle-pagination">
          {directory.error && <p role="alert">{directory.error}</p>}
          <Button
            label={directory.error ? '重试加载更多' : '加载更多'}
            disabled={disabled || loading}
            onActivate={directory.loadMore}
          />
        </div>
      )}
    </div>
  );
}

function LiveRecycleBin({ management, createCommandId, onBack, preferences }: LiveRecycleBinProps) {
  const directory = useRecycleBinDirectory(management);
  const actions = useRecycleBinActions({ management, createCommandId, refresh: directory.refresh });
  const busy = Boolean(actions.activity);
  const visible = directory.boards.map(toRecycleTarget);

  function handleChangeQuery(query: string) {
    actions.resetQueryState();
    directory.changeQuery(query);
  }

  function handleConfirmSelected() {
    const latest = new Map(visible.map((target) => [target.boardId, target]));
    const selection = [...actions.selected.values()].map(
      (target) => latest.get(target.boardId) ?? target,
    );
    actions.confirmSelected(selection);
  }

  return (
    <>
      <RecycleBinToolbar
        query={directory.query}
        busy={busy}
        available
        preferences={preferences}
        onBack={onBack}
        onQueryChange={handleChangeQuery}
        onEmpty={actions.prepareEmpty}
      />
      <section aria-label="回收站作品">
        {(visible.length > 0 || actions.selected.size > 0) && (
          <RecycleSelection
            visible={visible}
            selected={actions.selected}
            busy={busy}
            onSelect={actions.toggleSelection}
            onClear={actions.clearSelection}
            onDelete={handleConfirmSelected}
          />
        )}
        <RecycleFeedback actions={actions} />
        <RecycleResults directory={directory} actions={actions} layout={preferences.layout} />
        {actions.confirmation && (
          <PurgeDialog
            scope={actions.confirmation}
            purging={actions.activity === 'purging'}
            onCancel={actions.cancelConfirmation}
            onConfirm={actions.deleteConfirmed}
          />
        )}
      </section>
    </>
  );
}

export function RecycleBinSurface({
  management,
  createCommandId,
  onBack,
  preferences,
}: RecycleBinSurfaceProps) {
  return (
    <main className="studio-recycle-bin" data-studio-theme={preferences.resolvedTheme}>
      <div className="studio-recycle-main">
        {management ? (
          <LiveRecycleBin
            management={management}
            createCommandId={createCommandId}
            onBack={onBack}
            preferences={preferences}
          />
        ) : (
          <>
            <RecycleBinToolbar
              query=""
              busy={false}
              available={false}
              preferences={preferences}
              onBack={onBack}
            />
            <StatePanel kind="error" title="回收站暂不可用" />
          </>
        )}
      </div>
    </main>
  );
}
