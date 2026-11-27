import { Check, Ellipsis, Layers, Lock, LockOpen, MessageSquare } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActionMenu, OperationNotice, StatusText } from '../../ui/base/index.js';
import type {
  WhiteboardArrangePreset,
  WhiteboardLayerDirection,
} from '../../data/whiteboard/index.js';
import type { GeometrySelectionAction } from './geometry-commands.js';
import type { useGeometryEdits } from './geometry-session.js';
import {
  GeometryBoardMenu,
  geometryLayerRows,
  layerDirection,
  type GeometryActionContext,
} from './GeometryBoardMenu.js';
import './geometry-controls.css';

export { GeometryBoardMenu } from './GeometryBoardMenu.js';
export { GeometrySelectionObjectControls } from './GeometrySelectionObjectControls.js';

type SelectionMenu = 'layers' | 'more';

interface SelectionMenuState {
  readonly kind: SelectionMenu;
  readonly anchor: HTMLButtonElement;
}

interface SelectionActionsProps extends GeometryActionContext {
  readonly onOpenMore?: (trigger: HTMLButtonElement) => void;
  readonly onAnnotate?: () => void;
  readonly moreOpen?: boolean;
}

const alignmentKeys = new Map<string, WhiteboardArrangePreset>([
  ['a', 'left'],
  ['h', 'hcenter'],
  ['d', 'right'],
  ['w', 'top'],
  ['v', 'vcenter'],
  ['s', 'bottom'],
]);

function reorderDirection(event: KeyboardEvent): WhiteboardLayerDirection | undefined {
  const left = event.code === 'BracketLeft' || event.key === '[' || event.key === '{';
  const right = event.code === 'BracketRight' || event.key === ']' || event.key === '}';
  if (left) {
    return event.shiftKey ? 'back' : 'backward';
  }
  if (right) {
    return event.shiftKey ? 'front' : 'forward';
  }
}

function modifiedSelectionAction(
  event: KeyboardEvent,
  allLocked: boolean,
  anyLocked: boolean,
): GeometrySelectionAction | undefined {
  const key = event.key.toLowerCase();
  if (event.shiftKey && key === 'l') {
    return { kind: 'changeLock', locked: !allLocked };
  }
  if (!event.shiftKey && key === 'd') {
    return { kind: 'duplicate' };
  }
  if (anyLocked) {
    return undefined;
  }

  const direction = reorderDirection(event);
  if (direction) {
    return { kind: 'reorder', direction };
  }
  if (key === 'g') {
    return { kind: event.shiftKey ? 'ungroup' : 'group' };
  }
}

function keyboardAction(
  event: KeyboardEvent,
  canEdit: boolean,
  allLocked: boolean,
  anyLocked: boolean,
): GeometrySelectionAction | undefined {
  if (!canEdit) {
    return undefined;
  }

  const command = event.ctrlKey || event.metaKey;
  if (command && !event.altKey) {
    return modifiedSelectionAction(event, allLocked, anyLocked);
  }
  if (command || anyLocked) {
    return undefined;
  }

  if (event.altKey && !event.shiftKey) {
    const preset = alignmentKeys.get(event.key.toLowerCase());

    return preset && { kind: 'arrange', preset };
  }

  const deletion = event.key === 'Delete' || event.key === 'Backspace';
  return deletion && !event.altKey ? { kind: 'delete' } : undefined;
}

function acceptsSelectionShortcut(event: KeyboardEvent) {
  const consumed = event.defaultPrevented || event.repeat;
  if (consumed || event.isComposing) {
    return false;
  }

  const { target } = event;
  return (
    target instanceof Element &&
    !target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]',
    )
  );
}

export function GeometrySelectionActions({
  selection,
  canEdit,
  onAction,
  onFit,
  onSelectAll,
  onRenameSection,
  clipboard,
  onOpenMore,
  onAnnotate,
  moreOpen = false,
}: SelectionActionsProps) {
  const [menu, setMenu] = useState<SelectionMenuState>();
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  if (moreOpen && menu) {
    setMenu(undefined);
  }

  const ids = selection.map(({ id }) => id);
  const allLocked = selection.every(({ locked }) => locked);
  const anyLocked = selection.some(({ locked }) => locked);
  const canChangeLayer = canEdit && !anyLocked;
  const lockLabel = allLocked ? '解锁元素' : '锁定元素';
  const LockIcon = allLocked ? LockOpen : Lock;

  const selectionShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (ids.length === 0 || !acceptsSelectionShortcut(event)) {
      return;
    }

    const command = event.ctrlKey || event.metaKey;
    const selectAll = command && !event.altKey && event.key.toLowerCase() === 'a' && onSelectAll;
    if (selectAll) {
      event.preventDefault();
      selectAll();
      return;
    }

    const action = keyboardAction(event, canEdit, allLocked, anyLocked);
    const needsMultiple = action?.kind === 'group' || action?.kind === 'arrange';
    if (action && (!needsMultiple || ids.length > 1)) {
      event.preventDefault();
      onAction(action, ids);
    } else if (event.key === 'F2' && canEdit && onRenameSection) {
      event.preventDefault();
      onRenameSection();
    }
  });
  useEffect(() => {
    const canvas = controls?.closest('[data-canvas-root]');
    if (!canvas) {
      return;
    }

    function handleShortcut(event: Event) {
      if (event instanceof KeyboardEvent) {
        selectionShortcut(event);
      }
    }

    function closeSelectionMenu() {
      setMenu(undefined);
    }

    canvas.addEventListener('keydown', handleShortcut);
    canvas.addEventListener('contextmenu', closeSelectionMenu);
    return () => {
      canvas.removeEventListener('keydown', handleShortcut);
      canvas.removeEventListener('contextmenu', closeSelectionMenu);
    };
  }, [controls]);

  function handleLayerMenu(anchor: HTMLButtonElement) {
    setMenu(menu?.kind === 'layers' ? undefined : { kind: 'layers', anchor });
  }

  function handleMoreMenu(anchor: HTMLButtonElement) {
    if (onOpenMore) {
      setMenu(undefined);
      onOpenMore(anchor);
      return;
    }

    setMenu(menu?.kind === 'more' ? undefined : { kind: 'more', anchor });
  }

  function handleLayerAction(id: string) {
    setMenu(undefined);
    const direction = layerDirection(id);
    if (direction) {
      onAction({ kind: 'reorder', direction }, ids);
    }
  }

  if (selection.length === 0) {
    return null;
  }

  return (
    <div className="whiteboard-editor__geometry-actions" ref={setControls}>
      <span className="whiteboard-editor__tool-divider" aria-hidden="true" />
      {onAnnotate && (
        <button
          type="button"
          className="whiteboard-editor__selection-icon"
          aria-label="备注所选元素"
          title="备注"
          onClick={onAnnotate}
        >
          <MessageSquare size={18} />
        </button>
      )}
      <button
        type="button"
        className="whiteboard-editor__selection-icon whiteboard-editor__lock"
        aria-label={lockLabel}
        title={allLocked ? '解锁位置与尺寸' : '锁定位置与尺寸（仍可编辑内容）'}
        aria-pressed={allLocked}
        disabled={!canEdit}
        onClick={() => onAction({ kind: 'changeLock', locked: !allLocked }, ids)}
      >
        <LockIcon size={18} />
      </button>
      <button
        type="button"
        className="whiteboard-editor__selection-icon"
        aria-label="图层顺序"
        title="图层顺序"
        aria-haspopup="menu"
        aria-expanded={canChangeLayer && menu?.kind === 'layers'}
        disabled={!canChangeLayer}
        onClick={(event) => handleLayerMenu(event.currentTarget)}
      >
        <Layers size={18} />
      </button>
      <button
        type="button"
        className="whiteboard-editor__selection-icon"
        aria-label="更多操作"
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={moreOpen || menu?.kind === 'more'}
        onClick={(event) => handleMoreMenu(event.currentTarget)}
      >
        <Ellipsis size={19} />
      </button>
      {menu?.kind === 'layers' && (
        <ActionMenu
          open={canChangeLayer && !moreOpen}
          anchor={menu.anchor}
          label="图层顺序"
          items={geometryLayerRows}
          onRequestClose={() => setMenu(undefined)}
          onAction={handleLayerAction}
        />
      )}
      {menu?.kind === 'more' && (
        <GeometryBoardMenu
          anchor={menu.anchor}
          selection={selection}
          canEdit={canEdit}
          onAction={onAction}
          onFit={onFit}
          onSelectAll={onSelectAll}
          onRenameSection={onRenameSection}
          clipboard={clipboard}
          onRequestClose={() => setMenu(undefined)}
        />
      )}
    </div>
  );
}

interface GeometryFeedbackProps {
  readonly controls: ReturnType<typeof useGeometryEdits>;
}

export function GeometryStatus({ controls }: GeometryFeedbackProps) {
  switch (controls.state.kind) {
    case 'saving':
      return <StatusText message="保存中" busy announcement="polite" />;
    case 'checking':
      return <StatusText message="正在查询回执" busy announcement="polite" />;
    case 'saved':
      return (
        <span className="whiteboard-editor__saved" role="status">
          <Check size={13} />
          已保存
        </span>
      );
    case 'idle':
    case 'unknown':
    case 'conflict':
    case 'rejected':
      return null;
  }
}

export function GeometryNotice({ controls }: GeometryFeedbackProps) {
  const { state, checkReceipt, retryEdit, canRetry } = controls;
  switch (state.kind) {
    case 'unknown':
      return (
        <OperationNotice
          id="whiteboard-geometry-unknown"
          level="warning"
          message={'保存结果未知。' + state.detail}
          actions={[
            { id: 'check-geometry', label: '查询回执', onActivate: checkReceipt },
            {
              id: 'retry-geometry',
              label: '重试原编辑',
              disabled: !canRetry,
              onActivate: retryEdit,
            },
          ]}
        />
      );
    case 'conflict':
      return (
        <OperationNotice id="whiteboard-geometry-conflict" level="warning" message={state.detail} />
      );
    case 'rejected':
      return (
        <OperationNotice
          id="whiteboard-geometry-rejected"
          level="error"
          message={'编辑未保存。' + state.detail}
        />
      );
    case 'idle':
    case 'saved':
    case 'saving':
    case 'checking':
      return null;
  }
}
