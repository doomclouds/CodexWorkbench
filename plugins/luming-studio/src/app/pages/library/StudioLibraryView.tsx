import { STUDIO_HOME_TITLE } from '../../../contracts/branding.js';
import './library.css';
import { useRef, type SubmitEvent, type ChangeEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  FileCode2,
  LayoutGrid,
  Loader2,
  Pin,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import type { Artifact, StudioClient } from '../../../contracts/studio';
import { getProduct, products } from '../../products';
import type { LibraryPreview } from '../../library-preview';
import type {
  LibraryActions,
  LibraryData,
  LibraryFilter,
  PurgeConfirmation,
} from '../../features/library';
import { StudioDialog } from '../../shared/StudioDialog';
import { LibraryToolbar } from './LibraryToolbar';
import { LibraryArtifactMenu } from './LibraryArtifactMenu';

type LibraryLayout = 'grid' | 'list';

interface LibraryViewData extends LibraryData {
  layout: LibraryLayout;
  resolvedTheme: 'light' | 'dark';
}

interface LibraryViewActions extends LibraryActions {
  changeLayout: (layout: LibraryLayout) => void;
  changeTheme: (theme: 'light' | 'dark') => void;
  importArchive: (file: File) => void;
  openArtifact: (id: string) => void;
}

export interface StudioLibraryViewProps {
  data: LibraryViewData;
  actions: LibraryViewActions;
}

function relativeTime(value: string): string {
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) {
    return '';
  }

  const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
  if (minutes < 1) {
    return '刚刚修改';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前修改`;
  }
  if (minutes < 1440) {
    return `${Math.floor(minutes / 60)} 小时前修改`;
  }
  if (minutes < 10080) {
    return `${Math.floor(minutes / 1440)} 天前修改`;
  }

  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(stamp);
}

function ArtifactPreview({
  artifact,
  cached,
  client,
}: {
  artifact: Artifact;
  cached?: LibraryPreview;
  client: StudioClient;
}) {
  if (artifact.storageStatus === 'unsupported') {
    return (
      <div className="studio-artifact-preview studio-blank-preview">
        <AlertCircle size={28} />
        <span>不受支持</span>
      </div>
    );
  }

  const Preview = getProduct(artifact.type)?.Preview;

  return Preview ? (
    <Preview artifact={artifact} cached={cached} client={client} />
  ) : (
    <div className="studio-artifact-preview studio-blank-preview">暂无预览</div>
  );
}

function ProductGlyph({ type, size = 22 }: { type: string; size?: number }) {
  const Icon = getProduct(type)?.Icon || FileCode2;

  return <Icon size={size} />;
}

export function StudioLibraryView({ data, actions }: StudioLibraryViewProps) {
  const { busy, canManage, filter } = data;
  const archiveInput = useRef<HTMLInputElement>(null);
  function handleImport() {
    archiveInput.current?.click();
  }

  function handleArchiveInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      actions.importArchive(file);
    }

    event.target.value = '';
  }

  return (
    <main className="studio-library-main">
      <StudioLibraryHeader data={data} actions={actions} onImport={handleImport} />
      {canManage ? (
        <>
          {filter !== 'trash' && (
            <section className="studio-create-section" aria-label="新建作品">
              <h2>新建</h2>
              <div className="studio-product-cards">
                {products.map((product) => (
                  <button
                    key={product.id}
                    className="studio-create-card"
                    aria-label={`新建${product.label}`}
                    onClick={() => actions.createBoard(product.id)}
                    disabled={!!busy}
                  >
                    <div className="studio-create-art">
                      <product.Icon size={36} strokeWidth={1.3} />
                      <span className="studio-create-dot studio-create-dot-one" />
                      <span className="studio-create-dot studio-create-dot-two" />
                    </div>
                    <span className="studio-create-label">
                      {product.label} <Plus size={16} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <input
            ref={archiveInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            aria-label="导入作品"
            onChange={handleArchiveInput}
          />
          <StudioLibraryWorks data={data} actions={actions} />
        </>
      ) : (
        <div className="studio-empty">
          <Share2 size={30} />
          <h3>从分享链接打开白板</h3>
          <p>此页面仅显示你获准访问的作品。</p>
        </div>
      )}
    </main>
  );
}

function StudioLibraryHeader({
  data,
  actions,
  onImport,
}: StudioLibraryViewProps & { onImport: () => void }) {
  const { busy, canManage, filter, layout, query, resolvedTheme } = data;

  return (
    <header className="studio-library-header">
      <div className="studio-library-title">
        {filter !== 'recent' && (
          <button
            type="button"
            className="studio-icon-button"
            aria-label={`返回 ${STUDIO_HOME_TITLE}`}
            title={`返回 ${STUDIO_HOME_TITLE}`}
            disabled={!!busy}
            onClick={actions.showRecent}
          >
            <ArrowLeft size={21} />
          </button>
        )}
        <h1>{libraryTitles[filter]}</h1>
      </div>
      {canManage && (
        <LibraryToolbar
          query={query}
          filter={filter}
          layout={layout}
          resolvedTheme={resolvedTheme}
          busy={!!busy}
          creating={busy === 'create'}
          onQueryChange={actions.changeQuery}
          onFilterChange={actions.changeFilter}
          onLayoutChange={actions.changeLayout}
          onThemeChange={actions.changeTheme}
          onCreate={actions.createBoard}
          onImport={onImport}
          onEmptyTrash={actions.prepareEmptyTrash}
        />
      )}
    </header>
  );
}

function StudioLibraryWorks({ data, actions }: StudioLibraryViewProps) {
  const {
    filter,
    libraryLoading,
    hasNextPage,
    purgeError,
    purgeFailures,
    trashSelection,
    visibleArtifacts,
  } = data;

  return (
    <section
      className="studio-works-section"
      aria-label={filter === 'trash' ? '回收站作品' : '作品管理'}
    >
      {filter === 'trash' && (visibleArtifacts.length > 0 || trashSelection.length > 0) && (
        <StudioTrashSelection data={data} actions={actions} />
      )}
      {(purgeError || purgeFailures.length > 0) && (
        <div className="studio-trash-errors" role="alert">
          {purgeError && <p>{purgeError}</p>}
          {purgeFailures.length > 0 && (
            <>
              <strong>{purgeFailures.length} 项作品未删除，已保留选择。</strong>
              <ul>
                {purgeFailures.map((item) => (
                  <li key={item.artifactId}>
                    <span>{item.title}</span>
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <StudioLibraryResults data={data} actions={actions} />
      {hasNextPage && (
        <div className="studio-load-more">
          <button
            className="studio-button"
            disabled={libraryLoading}
            onClick={actions.loadNextPage}
          >
            {libraryLoading && <Loader2 className="studio-spin" size={16} />}加载更多
          </button>
        </div>
      )}
    </section>
  );
}

function StudioTrashSelection({ data, actions }: StudioLibraryViewProps) {
  const { busy, trashSelection, visibleArtifacts } = data;
  const selected = new Set(trashSelection);
  const selectedVisible = visibleArtifacts.filter((item) => selected.has(item.id)).length;

  return (
    <div className="studio-trash-selection" role="group" aria-label="回收站选择">
      <label>
        <input
          type="checkbox"
          aria-label="全选当前页"
          disabled={!!busy || !visibleArtifacts.length}
          checked={visibleArtifacts.length > 0 && selectedVisible === visibleArtifacts.length}
          ref={(node) => {
            if (node) {
              node.indeterminate = selectedVisible > 0 && selectedVisible < visibleArtifacts.length;
            }
          }}
          onChange={(event) => actions.selectTrashPage(event.currentTarget.checked)}
        />
        全选当前页
      </label>
      <span>{trashSelection.length} 项已选</span>
      <button
        type="button"
        className="studio-icon-button"
        aria-label="永久删除所选作品"
        title="永久删除所选作品"
        disabled={!!busy || !trashSelection.length}
        onClick={() => actions.confirmPurge(trashSelection)}
      >
        <Trash2 size={17} />
      </button>
      {trashSelection.length > 0 && (
        <button
          type="button"
          className="studio-icon-button"
          aria-label="清除选择"
          title="清除选择"
          disabled={!!busy}
          onClick={actions.clearTrashSelection}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function StudioLibraryResults({ data, actions }: StudioLibraryViewProps) {
  const { layout, libraryLoaded, libraryLoading, visibleArtifacts } = data;
  const selected = new Set(data.trashSelection);
  if (libraryLoading && !libraryLoaded) {
    return (
      <div className="studio-empty">
        <Loader2 size={26} className="studio-spin" />
        <p>正在读取作品</p>
      </div>
    );
  }
  if (libraryLoaded && visibleArtifacts.length === 0) {
    return <StudioLibraryEmpty data={data} actions={actions} />;
  }

  return (
    <div className={`studio-artifacts studio-artifacts-${layout}`} aria-busy={libraryLoading}>
      {visibleArtifacts.map((artifact) => (
        <StudioArtifactCard
          key={artifact.id}
          data={data}
          actions={actions}
          artifact={artifact}
          selected={selected.has(artifact.id)}
        />
      ))}
    </div>
  );
}

const libraryTitles: Record<LibraryFilter, string> = {
  recent: STUDIO_HOME_TITLE,
  pinned: '已固定',
  trash: '回收站',
};

const libraryEmptyCopy: Record<LibraryFilter, { heading: string; detail: string }> = {
  recent: { heading: '从第一块白板开始', detail: '先创建一块空白白板，再与 Codex 一起整理思路。' },
  pinned: { heading: '还没有固定作品', detail: '把常用作品固定在这里，方便再次打开。' },
  trash: { heading: '回收站为空', detail: '移入回收站的作品可以在这里恢复。' },
};

function StudioLibraryEmpty({ data, actions }: StudioLibraryViewProps) {
  const { busy, filter, query } = data;

  return (
    <div className="studio-empty">
      {filter === 'trash' ? <Trash2 size={32} /> : <LayoutGrid size={32} />}
      <h3>{query ? '没有找到匹配的作品' : libraryEmptyCopy[filter].heading}</h3>
      <p>{query ? '试试其他名称。' : libraryEmptyCopy[filter].detail}</p>
      {!query && filter === 'recent' && (
        <button className="studio-button" onClick={() => actions.createBoard()} disabled={!!busy}>
          <Plus size={16} />
          新建白板
        </button>
      )}
    </div>
  );
}

function artifactSubtitle(artifact: Artifact, filter: LibraryFilter) {
  if (artifact.storageStatus === 'unsupported') {
    return '旧版作品 · 不受支持';
  }

  if (filter === 'trash') {
    const trashedAt = new Date(artifact.trashedAt || artifact.updatedAt).toLocaleDateString(
      'zh-CN',
    );

    return `移入时间 ${trashedAt}`;
  }

  return relativeTime(artifact.updatedAt);
}

function StudioArtifactCard({
  data,
  actions,
  artifact,
  selected,
}: StudioLibraryViewProps & { artifact: Artifact; selected: boolean }) {
  const { busy, previews, client, filter, layout, menuId } = data;

  return (
    <article
      className={`studio-artifact ${artifact.trashedAt ? 'studio-artifact-trashed' : ''}${selected ? ' is-selected' : ''}`}
      key={artifact.id}
    >
      {artifact.trashedAt && (
        <label className="studio-trash-select">
          <input
            type="checkbox"
            aria-label={`选择作品：${artifact.title}`}
            checked={selected}
            disabled={!!busy}
            onChange={(event) => actions.selectTrashItem(artifact.id, event.currentTarget.checked)}
          />
        </label>
      )}
      <button
        className="studio-artifact-open"
        aria-label={`打开${getProduct(artifact.type)?.label || '作品'}：${artifact.title}`}
        disabled={!!artifact.trashedAt || artifact.storageStatus === 'unsupported'}
        onClick={() => actions.openArtifact(artifact.id)}
      >
        {layout === 'grid' && (
          <ArtifactPreview artifact={artifact} cached={previews.get(artifact.id)} client={client} />
        )}
        <div className="studio-artifact-details">
          <span className="studio-artifact-icon">
            <ProductGlyph type={artifact.type} />
          </span>
          <div className="studio-artifact-copy">
            <h3 title={artifact.title}>{artifact.title}</h3>
            <p>{artifactSubtitle(artifact, filter)}</p>
          </div>
        </div>
      </button>
      <div className="studio-artifact-actions">
        {artifact.trashedAt ? (
          <>
            {artifact.storageStatus !== 'unsupported' && (
              <button
                type="button"
                className="studio-icon-button"
                aria-label={`恢复作品：${artifact.title}`}
                title="恢复"
                onClick={() => actions.runArtifactAction('restore', artifact)}
                disabled={!!busy}
              >
                <RotateCcw size={17} />
              </button>
            )}
            <button
              type="button"
              className="studio-icon-button"
              aria-label={`永久删除作品：${artifact.title}`}
              title="永久删除"
              disabled={!!busy}
              onClick={() => actions.confirmPurge([artifact.id])}
            >
              <Trash2 size={17} />
            </button>
          </>
        ) : (
          <>
            {artifact.pinned && artifact.storageStatus !== 'unsupported' && (
              <Pin size={15} className="studio-pin-mark" aria-label="已固定" />
            )}
            <LibraryArtifactMenu
              artifact={artifact}
              open={menuId === artifact.id}
              busy={!!busy}
              onOpenChange={(open) => actions.changeArtifactMenu(artifact.id, open)}
              onPin={() => actions.runArtifactAction('pin', artifact)}
              onRename={() => actions.startRename(artifact)}
              onCopyLink={() => actions.runArtifactAction('copyLink', artifact)}
              onDuplicate={() => actions.runArtifactAction('duplicate', artifact)}
              onTrash={() => actions.runArtifactAction('trash', artifact)}
            />
          </>
        )}
      </div>
    </article>
  );
}

export function StudioUnsupportedArtifact({ onBack }: { onBack?: () => void }) {
  return (
    <main className="studio-empty" aria-label="不受支持的作品">
      <AlertCircle size={32} />
      <h1>旧版作品不受支持</h1>
      <p>可返回 {STUDIO_HOME_TITLE}，将此作品移入回收站。</p>
      {onBack && (
        <button type="button" className="studio-button" onClick={onBack}>
          <ArrowLeft size={17} />
          返回 {STUDIO_HOME_TITLE}
        </button>
      )}
    </main>
  );
}

export interface StudioPurgeDialogProps {
  busy: boolean;
  deleting: boolean;
  confirmation: PurgeConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}

export function StudioPurgeDialog({
  busy,
  deleting,
  confirmation,
  onCancel,
  onConfirm,
}: StudioPurgeDialogProps) {
  const confirmLabel = confirmation.all ? '清空回收站' : '永久删除';

  return (
    <StudioDialog title={confirmation.all ? '清空回收站' : '永久删除作品'} onClose={onCancel}>
      <p>将永久删除 {confirmation.targets.length} 项作品，此操作无法恢复。</p>
      {confirmation.targets.length === 1 && (
        <p className="studio-purge-target">{confirmation.targets[0]!.title}</p>
      )}
      <div className="studio-modal-footer">
        <button type="button" className="studio-button" disabled={!!busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="studio-button studio-purge-confirm"
          disabled={!!busy}
          onClick={onConfirm}
        >
          {deleting ? <Loader2 className="studio-spin" size={15} /> : <Trash2 size={15} />}
          {deleting ? '正在删除…' : confirmLabel}
        </button>
      </div>
    </StudioDialog>
  );
}

export interface StudioRenameDialogProps {
  busy: boolean;
  title: string;
  onChange: (title: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function StudioRenameDialog({
  busy,
  title,
  onChange,
  onSubmit,
  onClose,
}: StudioRenameDialogProps) {
  function handleRenameSubmit(event: SubmitEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <StudioDialog title="重命名作品" onClose={onClose}>
      <form onSubmit={handleRenameSubmit}>
        <label className="studio-field-label" htmlFor="studio-rename-title">
          作品名称
        </label>
        <input
          className="studio-text-field"
          id="studio-rename-title"
          maxLength={200}
          value={title}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <div className="studio-modal-footer">
          <button type="button" className="studio-button" onClick={onClose}>
            取消
          </button>
          <button
            className="studio-button studio-primary"
            type="submit"
            disabled={!title.trim() || !!busy}
          >
            保存
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
