import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Copy, FileCode2, MoreHorizontal, Pin, Plus, Share2, Trash2 } from 'lucide-react';
import type { CatalogBoardSummary, CatalogThumbnailRequest } from '../../data/catalog/index.js';
import { WorkbenchMenu } from './WorkbenchMenu.js';
import type { WorkbenchLayout } from './preferences.js';

export type RenderWorkbenchThumbnail = (request: CatalogThumbnailRequest) => ReactNode;

interface BoardCardProps {
  readonly board: CatalogBoardSummary;
  readonly layout: WorkbenchLayout;
  readonly onOpen: (boardId: string) => void;
  readonly managementBlocked: boolean;
  readonly onAction?: (
    board: CatalogBoardSummary,
    action: WorkbenchBoardAction,
    trigger: HTMLButtonElement,
  ) => void;
  readonly onDuplicate?: (board: CatalogBoardSummary, trigger: HTMLButtonElement) => void;
  readonly onCopyLink?: (boardId: string) => void;
  readonly renderThumbnail?: RenderWorkbenchThumbnail;
}

export type WorkbenchBoardAction = 'rename' | 'pin' | 'trash';
type CardMenuAction = WorkbenchBoardAction | 'duplicate' | 'copyLink';

interface CardMenuAnchor {
  readonly button: HTMLButtonElement;
  readonly focus: 'first' | 'last';
}

const unsupported = '当前阶段暂不支持';
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });
const minute = 60_000;
const hourMinutes = 60;
const dayMinutes = hourMinutes * 24;
const recentDays = 7;

function relativeTime(updatedAt?: bigint): string {
  const stamp = Number(updatedAt);
  if (!Number.isSafeInteger(stamp)) {
    return '';
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - stamp) / minute));
  if (elapsed < 1) {
    return '刚刚修改';
  }
  if (elapsed < hourMinutes) {
    return elapsed + ' 分钟前修改';
  }
  if (elapsed < dayMinutes) {
    return Math.floor(elapsed / hourMinutes) + ' 小时前修改';
  }
  if (elapsed < dayMinutes * recentDays) {
    return Math.floor(elapsed / dayMinutes) + ' 天前修改';
  }

  const date = new Date(stamp);

  return Number.isNaN(date.getTime()) ? '' : shortDate.format(date);
}

export function NewBoardCard({
  disabled,
  onCreate,
}: {
  readonly disabled: boolean;
  readonly onCreate: () => void;
}) {
  return (
    <section className="studio-workbench-create" aria-label="新建作品">
      <h2>新建</h2>
      <button
        type="button"
        className="studio-workbench-create-card"
        aria-label="新建白板"
        disabled={disabled}
        onClick={onCreate}
      >
        <div className="studio-workbench-create-art">
          <Share2 size={36} strokeWidth={1.3} />
          <span className="studio-workbench-create-dot studio-workbench-create-dot-one" />
          <span className="studio-workbench-create-dot studio-workbench-create-dot-two" />
        </div>
        <span className="studio-workbench-create-label">
          白板 <Plus size={16} />
        </span>
      </button>
    </section>
  );
}

function BoardPreview({
  board,
  renderThumbnail,
}: Pick<BoardCardProps, 'board' | 'renderThumbnail'>) {
  const { boardId, previewRevision } = board;

  return (
    <div className="studio-workbench-preview studio-workbench-blank-preview" aria-hidden="true">
      <div className="studio-workbench-preview-paper">
        <span />
        <span />
        <span />
      </div>
      <span className="studio-workbench-preview-placeholder">暂无预览</span>
      {previewRevision !== undefined &&
        renderThumbnail?.({ boardId, revision: previewRevision, trashed: false })}
    </div>
  );
}

type BoardCardMenuProps = Pick<
  BoardCardProps,
  'board' | 'managementBlocked' | 'onAction' | 'onDuplicate' | 'onCopyLink'
>;

function BoardCardMenu({
  board,
  managementBlocked,
  onAction,
  onDuplicate,
  onCopyLink,
}: BoardCardMenuProps) {
  const [anchor, setAnchor] = useState<CardMenuAnchor>();
  const menuId = useId();
  const { title, pinned, canManage } = board;
  const label = '管理作品：' + title;
  const actionsAvailable = canManage === true && onAction !== undefined;
  const options = [
    { label: pinned ? '取消固定' : '固定', icon: Pin, action: 'pin' },
    { label: '重命名', icon: FileCode2, action: 'rename' },
    { label: '复制链接', icon: Share2, action: 'copyLink' },
    { label: '复制作品', icon: Copy, action: 'duplicate' },
  ] as const;

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setAnchor({ button: event.currentTarget, focus: event.key === 'ArrowUp' ? 'last' : 'first' });
    }
  }

  function actionAvailable(action: CardMenuAction) {
    if (action === 'duplicate') {
      return canManage === true && onDuplicate !== undefined;
    }
    if (action === 'copyLink') {
      return canManage === true && onCopyLink !== undefined;
    }

    return actionsAvailable;
  }

  function runAction(action: CardMenuAction) {
    const blocked = !actionAvailable(action) || managementBlocked;
    if (!anchor || blocked) {
      return;
    }

    const trigger = anchor.button;
    setAnchor(undefined);
    trigger.focus();
    if (action === 'duplicate') {
      onDuplicate?.(board, trigger);
      return;
    }
    if (action === 'copyLink') {
      onCopyLink?.(board.boardId);
      return;
    }

    onAction?.(board, action, trigger);
  }

  return (
    <div className="studio-workbench-card-actions">
      {pinned && <Pin size={15} className="studio-workbench-pin-mark" aria-label="已固定" />}
      {canManage !== false && (
        <button
          type="button"
          className="studio-workbench-icon-button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={anchor !== undefined}
          aria-controls={anchor ? menuId : undefined}
          disabled={managementBlocked}
          onClick={(event) => {
            const button = event.currentTarget;
            setAnchor((current) => (current ? undefined : { button, focus: 'first' }));
          }}
          onKeyDown={handleKey}
        >
          <MoreHorizontal size={20} />
        </button>
      )}
      {anchor && canManage !== false && (
        <WorkbenchMenu
          anchor={anchor.button}
          id={menuId}
          label={label}
          initialFocus={anchor.focus}
          onClose={() => setAnchor(undefined)}
        >
          {options.map(({ action, label: text, icon: Icon }) => {
            const enabled = actionAvailable(action);

            return (
              <button
                type="button"
                key={text}
                role="menuitem"
                title={enabled ? undefined : unsupported}
                disabled={!enabled || managementBlocked}
                onClick={() => runAction(action)}
              >
                <Icon size={16} />
                {text}
              </button>
            );
          })}
          <div className="studio-workbench-menu-rule" role="separator" />
          <button
            type="button"
            role="menuitem"
            data-tone="danger"
            title={actionsAvailable ? undefined : unsupported}
            disabled={!actionsAvailable || managementBlocked}
            onClick={() => runAction('trash')}
          >
            <Trash2 size={16} />
            移入回收站
          </button>
        </WorkbenchMenu>
      )}
    </div>
  );
}

export function BoardCard({
  board,
  layout,
  onOpen,
  managementBlocked,
  onAction,
  onDuplicate,
  onCopyLink,
  renderThumbnail,
}: BoardCardProps) {
  return (
    <article className="studio-workbench-card">
      <button
        type="button"
        className="studio-workbench-card-open"
        aria-label={'打开白板：' + board.title}
        onClick={() => onOpen(board.boardId)}
      >
        {layout === 'grid' && <BoardPreview board={board} renderThumbnail={renderThumbnail} />}
        <div className="studio-workbench-card-details">
          <span className="studio-workbench-card-icon">
            <Share2 size={19} />
          </span>
          <div className="studio-workbench-card-copy">
            <h3 title={board.title}>{board.title}</h3>
            <p>{relativeTime(board.updatedAtMillis)}</p>
          </div>
        </div>
      </button>
      <BoardCardMenu
        board={board}
        managementBlocked={managementBlocked}
        onAction={onAction}
        onDuplicate={onDuplicate}
        onCopyLink={onCopyLink}
      />
    </article>
  );
}
