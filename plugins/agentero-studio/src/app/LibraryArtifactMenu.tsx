import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Copy, FileCode2, MoreHorizontal, Pin, Share2, Trash2 } from 'lucide-react';
import type { Artifact } from '../contracts/studio';
import './library.css';
import { registerEscapeLayer } from './shared/escape';

interface MenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
  side: 'above' | 'below' | 'point';
}

type MenuBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

function viewportBounds(host: HTMLElement): MenuBounds {
  const rect = host.getBoundingClientRect();

  return {
    left: Math.max(0, rect.width ? rect.left : 0),
    right: Math.min(window.innerWidth, rect.width ? rect.right : window.innerWidth),
    top: Math.max(0, rect.height ? rect.top : 0),
    bottom: Math.min(window.innerHeight, rect.height ? rect.bottom : window.innerHeight),
  };
}

function isOutsidePane(anchor: HTMLElement, rect: DOMRect, bounds: MenuBounds): boolean {
  const pane = anchor.closest('.studio-library-main')?.getBoundingClientRect();
  if (!pane || pane.height <= 0) {
    return false;
  }

  const outsideVertical =
    rect.bottom <= Math.max(bounds.top, pane.top) ||
    rect.top >= Math.min(bounds.bottom, pane.bottom);
  const outsideHorizontal = rect.right <= bounds.left || rect.left >= bounds.right;

  return outsideVertical || outsideHorizontal;
}

function measureMenu(
  menu: HTMLElement,
  anchor: DOMRect,
  bounds: MenuBounds,
  atPoint: boolean,
): MenuPlacement {
  const inset = 8;
  const gap = 6;
  const maxWidth = Math.max(0, bounds.right - bounds.left - inset * 2);
  const rect = menu.getBoundingClientRect();
  const width = Math.min(rect.width, maxWidth);
  const height = menu.scrollHeight || rect.height;
  const below = Math.max(0, bounds.bottom - inset - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - bounds.top - inset);
  const fitsBelow = height <= below || below >= above;
  const left = Math.max(
    bounds.left + inset,
    Math.min(atPoint ? anchor.left : anchor.right - width, bounds.right - inset - width),
  );

  if (atPoint) {
    const maxHeight = Math.max(0, bounds.bottom - bounds.top - inset * 2);
    const top = Math.max(
      bounds.top + inset,
      Math.min(anchor.top, bounds.bottom - inset - Math.min(height, maxHeight)),
    );

    return { left, top, maxHeight, maxWidth, side: 'point' };
  }
  if (fitsBelow) {
    return { left, top: anchor.bottom + gap, maxHeight: below, maxWidth, side: 'below' };
  }

  const top = anchor.top - gap - Math.min(height, above);

  return { left, top, maxHeight: above, maxWidth, side: 'above' };
}

function focusMenuItem(
  menu: HTMLElement,
  initialFocus: NonNullable<LibraryMenuProps['initialFocus']>,
) {
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (initialFocus === 'last') {
    items.at(-1)?.focus();

    return;
  }
  if (initialFocus === 'selected') {
    const selected = menu.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (selected || items[0])?.focus();

    return;
  }

  items[0]?.focus();
}

function nextMenuItem(key: string, index: number, count: number) {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }

  return (index + (key === 'ArrowDown' ? 1 : -1) + count) % count;
}

export interface LibraryMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  initialFocus?: 'first' | 'last' | 'selected';
  id?: string;
  atPoint?: boolean;
}

export function LibraryMenu({
  anchorRef,
  label,
  onClose,
  children,
  className = '',
  initialFocus = 'selected',
  id,
  atPoint = false,
}: LibraryMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    setHost(anchorRef.current?.closest<HTMLElement>('.studio') ?? null);
  }, [anchorRef]);

  const place = useCallback(
    (closeWhenHidden = false) => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu || !host) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const bounds = viewportBounds(host);
      if (closeWhenHidden && isOutsidePane(anchor, anchorRect, bounds)) {
        closeRef.current();

        return;
      }

      const next = measureMenu(menu, anchorRect, bounds, atPoint);
      setPlacement((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof MenuPlacement] === next[key as keyof MenuPlacement],
        )
          ? previous
          : next,
      );
    },
    [anchorRef, atPoint, host],
  );

  useLayoutEffect(() => {
    place();
  });
  useEffect(() => {
    const menu = menuRef.current;
    if (!host || !menu) {
      return;
    }

    focusMenuItem(menu, initialFocus);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.contains(event.target) &&
        !anchorRef.current?.contains(event.target)
      ) {
        closeRef.current();
      }
    };

    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) {
        return;
      }

      place(true);
    };

    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const unregister = registerEscapeLayer(menu, () => {
      closeRef.current();
      anchorRef.current?.focus();
    });

    return () => {
      unregister();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [anchorRef, host, initialFocus, place]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      anchorRef.current?.focus();

      return;
    }
    if (event.key === 'Tab') {
      closeRef.current();

      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }

    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuItem(event.key, index, items.length);
    event.preventDefault();
    items[next]?.focus();
  }

  if (!host) {
    return null;
  }

  return createPortal(
    <div
      id={id}
      ref={menuRef}
      role="menu"
      aria-label={label}
      data-native-interactive="true"
      data-placement={placement?.side}
      className={`studio-menu studio-library-floating-menu ${className}`}
      onKeyDown={handleMenuKeyDown}
      style={{
        position: 'fixed',
        left: placement?.left || 0,
        top: placement?.top || 0,
        maxWidth: placement?.maxWidth,
        maxHeight: placement?.maxHeight,
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    host,
  );
}

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
