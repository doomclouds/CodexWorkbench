import { Fragment, useCallback, useRef, useState, type RefObject } from 'react';
import { LibraryMenu } from '../../../../shared/LibraryMenu.js';

export type CanvasCommand =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'front'
  | 'back'
  | 'forward'
  | 'backward'
  | 'group'
  | 'ungroup'
  | 'create-section'
  | 'tidy'
  | 'delete'
  | 'lock'
  | 'select-all'
  | 'fit'
  | 'fit-selection';

export interface CanvasLayerOrderAnchor {
  kind: 'layer-order';
  button: RefObject<HTMLButtonElement | null>;
  menuId: string;
}

export type CanvasActionMenuAnchor =
  | { kind: 'point'; point: { x: number; y: number } }
  | CanvasLayerOrderAnchor;

interface CommandRow {
  id: CanvasCommand;
  label: string;
  shortcut?: string;
  edit?: boolean;
  selection?: boolean;
  geometry?: boolean;
}

const front: CommandRow = {
  id: 'front',
  label: '置于顶层',
  edit: true,
  selection: true,
  geometry: true,
};
const back: CommandRow = {
  id: 'back',
  label: '置于底层',
  edit: true,
  selection: true,
  geometry: true,
};
const forward: CommandRow = {
  id: 'forward',
  label: '上移一层',
  edit: true,
  selection: true,
  geometry: true,
};
const backward: CommandRow = {
  id: 'backward',
  label: '下移一层',
  edit: true,
  selection: true,
  geometry: true,
};
const layerOrderRows = [forward, backward, front, back];

const rows: CommandRow[] = [
  { id: 'cut', label: '剪切', shortcut: 'Ctrl/⌘ X', edit: true, selection: true, geometry: true },
  { id: 'copy', label: '复制', shortcut: 'Ctrl/⌘ C', selection: true },
  { id: 'paste', label: '粘贴', shortcut: 'Ctrl/⌘ V', edit: true },
  { id: 'duplicate', label: '重复', shortcut: 'Ctrl/⌘ D', edit: true, selection: true },
  front,
  back,
  forward,
  backward,
  { id: 'group', label: '组合', edit: true, selection: true, geometry: true },
  { id: 'ungroup', label: '取消组合', edit: true, selection: true, geometry: true },
  { id: 'tidy', label: '整理', edit: true, selection: true, geometry: true },
  { id: 'lock', label: '锁定位置与尺寸', shortcut: 'Ctrl/⌘ Shift L', edit: true, selection: true },
  { id: 'delete', label: '删除', shortcut: 'Delete', edit: true, selection: true, geometry: true },
  { id: 'select-all', label: '全选' },
  { id: 'fit', label: '适应白板', shortcut: 'Shift 1' },
  { id: 'fit-selection', label: '适应选区', shortcut: 'Shift 2', selection: true },
];

export default function CanvasActionsMenu({
  anchor,
  canEdit,
  selected,
  locked,
  hasClipboard,
  onCommand,
  onRenameSection,
  onClose,
}: {
  anchor: CanvasActionMenuAnchor;
  canEdit: boolean;
  selected: number;
  locked: boolean;
  hasClipboard: boolean;
  onCommand: (command: CanvasCommand) => void;
  onRenameSection?: () => void;
  onClose: () => void;
}) {
  const pointAnchor = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const layerOrder = anchor.kind === 'layer-order';
  const attachAnchor = useCallback((node: HTMLSpanElement | null) => {
    pointAnchor.current = node;
    if (node) {
      setReady(true);
    }
  }, []);

  function handleRenameSection() {
    onClose();
    onRenameSection?.();
  }

  function handleCommand(command: CanvasCommand) {
    onCommand(command);
    onClose();
    if (layerOrder) {
      anchor.button.current?.focus({ preventScroll: true });
    }
  }

  return (
    <>
      {!layerOrder && (
        <span
          ref={attachAnchor}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: anchor.point.x,
            top: anchor.point.y,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      )}
      {(layerOrder || ready) && (
        <LibraryMenu
          anchorRef={layerOrder ? anchor.button : pointAnchor}
          label={layerOrder ? '图层顺序' : '白板操作'}
          id={layerOrder ? anchor.menuId : undefined}
          className="studio-canvas-actions-menu"
          atPoint={!layerOrder}
          onClose={onClose}
        >
          {!layerOrder && canEdit && selected === 1 && onRenameSection && (
            <button type="button" role="menuitem" onClick={handleRenameSection}>
              <span>重命名分区</span>
              <small>F2</small>
            </button>
          )}
          {!layerOrder && canEdit && selected >= 2 && (
            <button type="button" role="menuitem" onClick={() => handleCommand('create-section')}>
              <span>从选区创建分区</span>
            </button>
          )}
          {(layerOrder ? layerOrderRows : rows)
            .filter((row) => selected > 0 || !row.selection)
            .map((row) => (
              <Fragment key={row.id}>
                {layerOrder && row.id === 'front' && (
                  <div className="studio-menu-rule" role="separator" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    (row.edit && !canEdit) ||
                    (row.selection && !selected) ||
                    (row.geometry && locked) ||
                    (row.id === 'paste' && !hasClipboard) ||
                    (row.id === 'group' && selected < 2) ||
                    (row.id === 'tidy' && selected < 2)
                  }
                  onClick={() => handleCommand(row.id)}
                >
                  <span>{row.id === 'lock' && locked ? '解锁位置与尺寸' : row.label}</span>
                  <small>{row.shortcut}</small>
                </button>
              </Fragment>
            ))}
        </LibraryMenu>
      )}
    </>
  );
}
