import { RotateCcw, Share2, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CatalogThumbnailRequest, TrashedBoardSummary } from '../../data/catalog/index.js';
import { Checkbox } from '../../ui/base/index.js';
import type { RecycleTarget } from './recycle-bin-commands.js';
import { toRecycleTarget } from './recycle-bin-commands.js';
import type { RecycleBinPreferences } from './RecycleBinToolbar.js';

export type DeleteRecycleTargets = (
  targets: readonly RecycleTarget[],
  trigger: HTMLButtonElement,
) => void;
export type RenderRecycleThumbnail = (request: CatalogThumbnailRequest) => ReactNode;

interface RecycleSelectionProps {
  readonly visible: readonly RecycleTarget[];
  readonly selected: ReadonlyMap<string, RecycleTarget>;
  readonly busy: boolean;
  readonly onSelect: (targets: readonly RecycleTarget[], checked: boolean) => void;
  readonly onClear: () => void;
  readonly onDelete: (trigger: HTMLButtonElement) => void;
}

interface RecycleCardsProps {
  readonly boards: readonly TrashedBoardSummary[];
  readonly selected: ReadonlyMap<string, RecycleTarget>;
  readonly layout: RecycleBinPreferences['layout'];
  readonly busy: boolean;
  readonly onSelect: RecycleSelectionProps['onSelect'];
  readonly onRestore: (target: RecycleTarget) => void;
  readonly onDelete: DeleteRecycleTargets;
  readonly renderThumbnail?: RenderRecycleThumbnail;
}

interface RecycleCardProps extends Omit<RecycleCardsProps, 'boards' | 'selected'> {
  readonly item: TrashedBoardSummary;
  readonly checked: boolean;
}

const trashDate = new Intl.DateTimeFormat('zh-CN');

function trashedAtLabel(timestamp: bigint) {
  const date = new Date(Number(timestamp));

  return Number.isNaN(date.getTime()) ? '' : '移入时间 ' + trashDate.format(date);
}

export function RecycleSelection({
  visible,
  selected,
  busy,
  onSelect,
  onClear,
  onDelete,
}: RecycleSelectionProps) {
  const visibleSelected = visible.filter(({ boardId }) => selected.has(boardId)).length;
  const allVisible = visible.length > 0 && visibleSelected === visible.length;

  return (
    <div className="studio-recycle-selection" role="group" aria-label="回收站选择">
      <Checkbox
        label="全选当前页"
        checked={allVisible}
        indeterminate={visibleSelected > 0 && !allVisible}
        disabled={busy || visible.length === 0}
        onCheckedChange={(checked) => onSelect(visible, checked)}
      />
      <span>{selected.size} 项已选</span>
      <button
        type="button"
        className="studio-recycle-icon"
        aria-label="永久删除所选作品"
        title="永久删除所选作品"
        disabled={busy || selected.size === 0}
        onClick={(event) => onDelete(event.currentTarget)}
      >
        <Trash2 size={17} />
      </button>
      {selected.size > 0 && (
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label="清除选择"
          title="清除选择"
          disabled={busy}
          onClick={onClear}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function RecyclePreview({
  item,
  renderThumbnail,
}: Pick<RecycleCardProps, 'item' | 'renderThumbnail'>) {
  const { boardId, previewRevision } = item.board;

  return (
    <div className="studio-recycle-preview" aria-hidden="true">
      <div className="studio-recycle-preview-paper">
        <span />
        <span />
        <span />
      </div>
      <span>暂无预览</span>
      {previewRevision !== undefined &&
        renderThumbnail?.({ boardId, revision: previewRevision, trashed: true })}
    </div>
  );
}

function RecycleCard({
  item,
  checked,
  layout,
  busy,
  onSelect,
  onRestore,
  onDelete,
  renderThumbnail,
}: RecycleCardProps) {
  const target = toRecycleTarget(item);
  const { title } = target;
  const canManage = item.board.canManage === true;

  return (
    <article className="studio-recycle-card" data-selected={checked || undefined}>
      <label className="studio-recycle-row-select">
        <input
          type="checkbox"
          aria-label={'选择作品：' + title}
          checked={checked}
          disabled={busy || !canManage}
          onChange={(event) => onSelect([target], event.currentTarget.checked)}
        />
      </label>
      <button
        type="button"
        className="studio-recycle-card-open"
        aria-label={'打开白板：' + title}
        disabled
      >
        {layout === 'grid' && (
          <RecyclePreview item={item} renderThumbnail={canManage ? renderThumbnail : undefined} />
        )}
        <div className="studio-recycle-card-details">
          <span className="studio-recycle-card-icon" aria-hidden="true">
            <Share2 size={19} />
          </span>
          <div className="studio-recycle-card-copy">
            <h3 title={title}>{title}</h3>
            <p>{trashedAtLabel(item.trashedAtMillis)}</p>
          </div>
        </div>
      </button>
      <div className="studio-recycle-card-actions">
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label={'恢复作品：' + title}
          title="恢复"
          disabled={busy || !canManage}
          onClick={() => onRestore(target)}
        >
          <RotateCcw size={17} />
        </button>
        <button
          type="button"
          className="studio-recycle-icon"
          aria-label={'永久删除作品：' + title}
          title="永久删除"
          disabled={busy || !canManage}
          onClick={(event) => onDelete([target], event.currentTarget)}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </article>
  );
}

export function RecycleBinCards({
  boards,
  selected,
  layout,
  busy,
  onSelect,
  onRestore,
  onDelete,
  renderThumbnail,
}: RecycleCardsProps) {
  return (
    <div className="studio-recycle-cards" data-layout={layout}>
      {boards.map((item) => (
        <RecycleCard
          key={item.board.boardId}
          item={item}
          checked={selected.has(item.board.boardId)}
          layout={layout}
          busy={busy}
          onSelect={onSelect}
          onRestore={onRestore}
          onDelete={onDelete}
          renderThumbnail={renderThumbnail}
        />
      ))}
    </div>
  );
}
