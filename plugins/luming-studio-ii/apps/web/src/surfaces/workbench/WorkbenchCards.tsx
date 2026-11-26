import { useState, type KeyboardEvent } from 'react';
import { Copy, FileCode2, MoreHorizontal, Pin, Plus, Share2, Trash2 } from 'lucide-react';
import type { CatalogBoardSummary } from '../../data/catalog/index.js';
import { WorkbenchMenu } from './WorkbenchMenu.js';
import type { WorkbenchLayout } from './preferences.js';

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
}

export type WorkbenchBoardAction = 'rename' | 'pin' | 'trash';
type CardMenuAction = WorkbenchBoardAction | 'duplicate';

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

function BoardPreview() {
  return (
    <div className="studio-workbench-preview studio-workbench-blank-preview" aria-hidden="true">
      <div className="studio-workbench-preview-paper">
        <span />
        <span />
        <span />
      </div>
      <span>暂无预览</span>
    </div>
  );
}

type BoardCardMenuProps = Pick<
  BoardCardProps,
  'board' | 'managementBlocked' | 'onAction' | 'onDuplicate'
>;

function BoardCardMenu({ board, managementBlocked, onAction, onDuplicate }: BoardCardMenuProps) {
  const [anchor, setAnchor] = useState<CardMenuAnchor>();
  const { title, pinned, canManage } = board;
  const label = '管理作品：' + title;
  const actionsAvailable = canManage === true && onAction !== undefined;
  const options = [
    { label: pinned ? '取消固定' : '固定', icon: Pin, action: 'pin' },
    { label: '重命名', icon: FileCode2, action: 'rename' },
    { label: '复制链接', icon: Share2 },
    { label: '复制作品', icon: Copy, action: 'duplicate' },
  ] as const;

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setAnchor({ button: event.currentTarget, focus: event.key === 'ArrowUp' ? 'last' : 'first' });
    }
  }

  function actionAvailable(action: CardMenuAction | undefined) {
    if (action === 'duplicate') {
      return canManage === true && onDuplicate !== undefined;
    }

    return action !== undefined && actionsAvailable;
  }

  function runAction(action: CardMenuAction | undefined) {
    const blocked = !actionAvailable(action) || managementBlocked;
    if (!anchor || blocked || !action) {
      return;
    }

    const trigger = anchor.button;
    setAnchor(undefined);
    trigger.focus();
    if (action === 'duplicate') {
      onDuplicate?.(board, trigger);
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
          label={label}
          initialFocus={anchor.focus}
          onClose={() => setAnchor(undefined)}
        >
          {options.map((option) => {
            const action = 'action' in option ? option.action : undefined;
            const enabled = actionAvailable(action);
            const { label: text, icon: Icon } = option;

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
            className="studio-workbench-danger-text"
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
}: BoardCardProps) {
  return (
    <article className="studio-workbench-card">
      <button
        type="button"
        className="studio-workbench-card-open"
        aria-label={'打开白板：' + board.title}
        onClick={() => onOpen(board.boardId)}
      >
        {layout === 'grid' && <BoardPreview />}
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
      />
    </article>
  );
}
