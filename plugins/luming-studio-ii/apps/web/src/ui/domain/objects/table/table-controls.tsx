import { createPortal } from 'react-dom';

import { ActionMenu, Button, OperationNotice, ToggleButton, Toolbar } from '../../../base/index.js';
import type { ActionMenuItem } from '../../../base/index.js';
import type { CellAddress, TableAxis, TableModel } from './table-model.js';

interface TableControlsProps {
  readonly tableId: string;
  readonly model: TableModel;
  readonly active: CellAddress | null;
  readonly saving: boolean;
  readonly error: string;
  readonly onInsert: (axis: TableAxis, index?: number) => void;
  readonly onRemove: (axis: TableAxis, cell: CellAddress) => void;
  readonly onToggleHead: () => void;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}

export interface TableMenu {
  readonly cell: CellAddress;
  readonly anchor: { x: number; y: number };
  readonly host: HTMLElement;
}

interface MenuAction extends ActionMenuItem {
  readonly axis: TableAxis;
  readonly operation: 'insert' | 'remove';
  readonly offset?: number;
}

interface TableMenuProps {
  readonly tableId: string;
  readonly menu: TableMenu;
  readonly model: TableModel;
  readonly saving: boolean;
  readonly onInsert: (axis: TableAxis, index: number) => void;
  readonly onRemove: (axis: TableAxis, cell: CellAddress) => void;
  readonly onClose: () => void;
}

const menuActions: readonly MenuAction[] = [
  { id: 'above', label: '在上方插入行', axis: 'row', operation: 'insert', offset: 0 },
  { id: 'below', label: '在下方插入行', axis: 'row', operation: 'insert', offset: 1 },
  { id: 'before', label: '在左侧插入列', axis: 'column', operation: 'insert', offset: 0 },
  { id: 'after', label: '在右侧插入列', axis: 'column', operation: 'insert', offset: 1 },
  { id: 'remove-row', label: '删除行', axis: 'row', operation: 'remove' },
  { id: 'remove-column', label: '删除列', axis: 'column', operation: 'remove' },
];

function cannotRemove(axis: TableAxis, model: TableModel) {
  return axis === 'row' ? model.rows.length < 2 : model.columnIds.length < 2;
}

export function TableControls({
  tableId,
  model,
  active,
  saving,
  error,
  onInsert,
  onRemove,
  onToggleHead,
  onRetry,
  onDiscard,
}: TableControlsProps) {
  return (
    <div className="studio-object-table-controls">
      <Toolbar label="表格操作">
        <Button label="添加表格行" disabled={saving} onActivate={() => onInsert('row')} />
        <Button label="添加表格列" disabled={saving} onActivate={() => onInsert('column')} />
        <ToggleButton
          label="切换表头"
          pressed={model.head}
          disabled={saving}
          onPressedChange={onToggleHead}
        />
        {active && (
          <>
            <Button
              label="删除当前行"
              disabled={saving || cannotRemove('row', model)}
              onActivate={() => onRemove('row', active)}
            />
            <Button
              label="删除当前列"
              disabled={saving || cannotRemove('column', model)}
              onActivate={() => onRemove('column', active)}
            />
          </>
        )}
      </Toolbar>
      {error && (
        <OperationNotice
          id={tableId + ':save-error'}
          level="error"
          message={error}
          actions={[
            { id: 'retry', label: '重试保存表格', disabled: saving, onActivate: onRetry },
            { id: 'discard', label: '放弃表格草稿', disabled: saving, onActivate: onDiscard },
          ]}
        />
      )}
    </div>
  );
}

export function TableCellMenu({
  tableId,
  menu,
  model,
  saving,
  onInsert,
  onRemove,
  onClose,
}: TableMenuProps) {
  const items = menuActions.map((action) => ({
    id: action.id,
    label: action.label,
    disabled: saving || (action.operation === 'remove' && cannotRemove(action.axis, model)),
  }));

  function handleCellAction(id: string) {
    const action = menuActions.find((candidate) => candidate.id === id);
    if (!action || saving) {
      return;
    }

    if (action.operation === 'remove') {
      onRemove(action.axis, menu.cell);
      return;
    }

    const index = action.axis === 'row' ? menu.cell.row : menu.cell.column;
    onInsert(action.axis, index + (action.offset ?? 0));
  }

  return createPortal(
    <div data-table-floating-menu={tableId}>
      <ActionMenu
        open
        label="表格单元格操作"
        anchor={menu.anchor}
        items={items}
        onAction={handleCellAction}
        onRequestClose={onClose}
      />
    </div>,
    menu.host,
  );
}
