import { useState, type KeyboardEvent } from 'react';
import { Copy, FileCode2, MoreHorizontal, Pin, Plus, Share2, Trash2 } from 'lucide-react';
import type { CatalogBoardSummary } from '../../data/catalog/index.js';
import { WorkbenchMenu } from './WorkbenchMenu.js';
import type { WorkbenchLayout } from './preferences.js';

interface BoardCardProps {
  readonly board: CatalogBoardSummary;
  readonly layout: WorkbenchLayout;
  readonly onOpen: (boardId: string) => void;
}

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

function BoardCardMenu({ title, pinned }: { readonly title: string; readonly pinned: boolean }) {
  const [anchor, setAnchor] = useState<CardMenuAnchor>();
  const label = '管理作品：' + title;
  const options = [
    { label: pinned ? '取消固定' : '固定', icon: Pin },
    { label: '重命名', icon: FileCode2 },
    { label: '复制链接', icon: Share2 },
    { label: '复制作品', icon: Copy },
  ];

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setAnchor({ button: event.currentTarget, focus: event.key === 'ArrowUp' ? 'last' : 'first' });
    }
  }

  return (
    <div className="studio-workbench-card-actions">
      {pinned && <Pin size={15} className="studio-workbench-pin-mark" aria-label="已固定" />}
      <button
        type="button"
        className="studio-workbench-icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        onClick={(event) => {
          const button = event.currentTarget;
          setAnchor((current) => (current ? undefined : { button, focus: 'first' }));
        }}
        onKeyDown={handleKey}
      >
        <MoreHorizontal size={20} />
      </button>
      {anchor && (
        <WorkbenchMenu
          anchor={anchor.button}
          label={label}
          initialFocus={anchor.focus}
          onClose={() => setAnchor(undefined)}
        >
          {options.map(({ label: option, icon: Icon }) => (
            <button type="button" key={option} role="menuitem" title={unsupported} disabled>
              <Icon size={16} />
              {option}
            </button>
          ))}
          <div className="studio-workbench-menu-rule" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="studio-workbench-danger-text"
            title={unsupported}
            disabled
          >
            <Trash2 size={16} />
            移入回收站
          </button>
        </WorkbenchMenu>
      )}
    </div>
  );
}

export function BoardCard({ board, layout, onOpen }: BoardCardProps) {
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
      <BoardCardMenu title={board.title} pinned={board.pinned} />
    </article>
  );
}
