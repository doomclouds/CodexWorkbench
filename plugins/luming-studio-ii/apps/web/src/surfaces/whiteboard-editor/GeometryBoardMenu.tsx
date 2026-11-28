import {
  ActionMenu,
  type ActionMenuAnchor,
  type ActionMenuCloseReason,
  type ActionMenuItem,
} from '../../ui/base/index.js';
import type { CanvasObject } from '../../ui/domain/canvas/index.js';
import type { GeometrySelectionAction } from './geometry-commands.js';
import type { SelectionLocks } from './organization-selection.js';

export interface GeometryActionContext {
  readonly selection: readonly CanvasObject[];
  readonly locks: SelectionLocks;
  readonly canEdit: boolean;
  readonly onAction: (action: GeometrySelectionAction, ids: readonly string[]) => void;
  readonly onFit?: (scope: 'board' | 'selection') => void;
  readonly onSelectAll?: () => void;
  readonly onRenameSection?: () => void;
  readonly clipboard?: {
    readonly copy?: () => void;
    readonly cut?: () => void;
    readonly paste?: () => void;
  };
}

interface BoardMenuProps extends GeometryActionContext {
  readonly anchor: ActionMenuAnchor | null;
  readonly onRequestClose: () => void;
  readonly returnFocus?: () => void;
}

const directionRows = {
  forward: { id: 'forward', label: '上移一层' },
  backward: { id: 'backward', label: '下移一层' },
  front: { id: 'front', label: '置于顶层' },
  back: { id: 'back', label: '置于底层' },
} as const;

export const geometryLayerRows = [
  directionRows.forward,
  directionRows.backward,
  { ...directionRows.front, separatorBefore: true },
  directionRows.back,
] as const satisfies readonly ActionMenuItem[];

export function layerDirection(id: string) {
  return geometryLayerRows.find((row) => row.id === id)?.id;
}

function lockMenuLabel(locks: SelectionLocks): string {
  if (!locks.change) {
    return '由分区锁定';
  }

  return locks.change.locked ? '锁定位置与尺寸' : '解锁位置与尺寸';
}

function boardMenuItems({
  selection,
  locks,
  canEdit,
  onFit,
  onSelectAll,
  onRenameSection,
  clipboard,
}: GeometryActionContext): readonly ActionMenuItem[] {
  const general = [
    { id: 'select-all', label: '全选', disabled: !onSelectAll },
    { id: 'fit', label: '适应白板', shortcut: 'Shift 1', disabled: !onFit },
  ];
  const paste = {
    id: 'paste',
    label: '粘贴',
    shortcut: 'Ctrl/⌘ V',
    disabled: !clipboard?.paste,
  } as const;

  if (selection.length === 0) {
    return [paste, ...general];
  }

  const locked = locks.ids.size > 0;
  const blockGeometry = !canEdit || locked;
  const multiple = selection.length >= 2;
  const onlySection = !multiple && selection[0]?.kind === 'section';
  const renameSection = onRenameSection && canEdit && onlySection;
  const layers = [
    directionRows.front,
    directionRows.back,
    directionRows.forward,
    directionRows.backward,
  ];

  return [
    ...(renameSection ? [{ id: 'rename-section', label: '重命名分区', shortcut: 'F2' }] : []),
    ...(canEdit && multiple
      ? [{ id: 'createSection', label: '从选区创建分区', disabled: locked }]
      : []),
    { id: 'cut', label: '剪切', shortcut: 'Ctrl/⌘ X', disabled: blockGeometry || !clipboard?.cut },
    { id: 'copy', label: '复制', shortcut: 'Ctrl/⌘ C', disabled: !clipboard?.copy },
    paste,
    { id: 'duplicate', label: '重复', shortcut: 'Ctrl/⌘ D', disabled: !canEdit },
    ...layers.map((row) => ({ ...row, disabled: blockGeometry })),
    { id: 'group', label: '组合', disabled: blockGeometry || !multiple },
    {
      id: 'ungroup',
      label: '取消组合',
      disabled: blockGeometry || selection.every(({ groupId }) => !groupId),
    },
    { id: 'tidy', label: '整理', disabled: blockGeometry || !multiple },
    {
      id: 'lock',
      label: lockMenuLabel(locks),
      shortcut: 'Ctrl/⌘ Shift L',
      disabled: !canEdit || !locks.change,
    },
    { id: 'delete', label: '删除', shortcut: 'Delete', disabled: blockGeometry, tone: 'danger' },
    ...general,
    { id: 'fit-selection', label: '适应选区', shortcut: 'Shift 2', disabled: !onFit },
  ];
}

function selectionAction(id: string): GeometrySelectionAction | undefined {
  switch (id) {
    case 'delete':
    case 'duplicate':
    case 'group':
    case 'ungroup':
    case 'createSection':
      return { kind: id };
    case 'tidy':
      return { kind: 'arrange', preset: id };
  }

  const direction = layerDirection(id);
  return direction && { kind: 'reorder', direction };
}

export function GeometryBoardMenu(props: BoardMenuProps) {
  const {
    anchor,
    selection,
    locks,
    onAction,
    onFit,
    onSelectAll,
    onRenameSection,
    clipboard,
    onRequestClose,
    returnFocus,
  } = props;
  function handleAction(id: string) {
    onRequestClose();
    if (id === 'copy' || id === 'cut' || id === 'paste') {
      clipboard?.[id]?.();
      return;
    }
    if (id === 'rename-section') {
      onRenameSection?.();
      return;
    }
    if (id === 'select-all') {
      onSelectAll?.();
      return;
    }
    if (id === 'fit' || id === 'fit-selection') {
      onFit?.(id === 'fit' ? 'board' : 'selection');
      return;
    }

    if (id === 'lock' && locks.change) {
      onAction({ kind: 'changeLock', locked: locks.change.locked }, locks.change.ids);
      return;
    }

    const action = selectionAction(id);
    if (action) {
      onAction(
        action,
        selection.map((object) => object.id),
      );
    }
  }

  function handleClose(reason: ActionMenuCloseReason) {
    if (reason === 'escape') {
      returnFocus?.();
    }

    onRequestClose();
  }

  return (
    <div className="whiteboard-editor__geometry-menu">
      <ActionMenu
        open={anchor !== null}
        anchor={anchor}
        label="白板操作"
        items={boardMenuItems(props)}
        announceShortcuts
        onAction={handleAction}
        onRequestClose={handleClose}
        returnFocus={returnFocus}
      />
    </div>
  );
}
