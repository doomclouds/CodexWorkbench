import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, FileCode2, MoreHorizontal, Pin, Share2, Trash2 } from 'lucide-react';
import type { Artifact } from '../../../contracts/studio';
import { LibraryMenu } from '../../shared/LibraryMenu';

export interface LibraryArtifactMenuProps {
  artifact: Artifact;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPin: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}

export function LibraryArtifactMenu({
  artifact,
  open,
  busy,
  onOpenChange,
  onPin,
  onRename,
  onCopyLink,
  onDuplicate,
  onTrash,
}: LibraryArtifactMenuProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
  function select(action: () => void) {
    onOpenChange(false);
    anchorRef.current?.focus();
    action();
  }

  function handleMenuToggle() {
    setInitialFocus('first');
    onOpenChange(!open);
  }

  function handleToggleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setInitialFocus(event.key === 'ArrowUp' ? 'last' : 'first');
      onOpenChange(true);
    }
  }

  return (
    <div className="studio-menu-anchor">
      <button
        ref={anchorRef}
        type="button"
        className="studio-icon-button"
        aria-label={`管理作品：${artifact.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={handleMenuToggle}
        onKeyDown={handleToggleKeyDown}
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <LibraryMenu
          id={menuId}
          anchorRef={anchorRef}
          label={`管理作品：${artifact.title}`}
          initialFocus={initialFocus}
          onClose={() => onOpenChange(false)}
        >
          {artifact.storageStatus !== 'unsupported' && (
            <>
              <button type="button" role="menuitem" disabled={busy} onClick={() => select(onPin)}>
                <Pin size={16} />
                {artifact.pinned ? '取消固定' : '固定'}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => select(onRename)}
              >
                <FileCode2 size={16} />
                重命名
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => select(onCopyLink)}
              >
                <Share2 size={16} />
                复制链接
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => select(onDuplicate)}
              >
                <Copy size={16} />
                复制作品
              </button>
              <div className="studio-menu-rule" role="separator" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="studio-danger-text"
            disabled={busy}
            onClick={() => select(onTrash)}
          >
            <Trash2 size={16} />
            移入回收站
          </button>
        </LibraryMenu>
      )}
    </div>
  );
}
