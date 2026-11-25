import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react';

import { InlineTextEditor } from '../text/index.js';
import type { InlineTextEditorHandle, InlineTextFormat } from '../text/index.js';
import type { TableObjectProps } from './contracts.js';
import { TableColumns } from './table-columns.js';
import { TableCellMenu, TableControls } from './table-controls.js';
import type { TableMenu } from './table-controls.js';
import { sameCell, TableGrid } from './table-grid.js';
import { changeCell, clampCell, insertAxis, removeAxis, tabCell } from './table-model.js';
import type { CellAddress, TableAxis } from './table-model.js';
import { useTableColumnResize } from './useTableColumnResize.js';
import { useTableSession } from './useTableSession.js';
import './TableObject.css';

const defaultFontSize = 17;
const readableFontSize = 8;
const primaryButton = 0;

function tableScale(zoom: number) {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function TableObjectSession(props: TableObjectProps) {
  const {
    value,
    canEdit,
    locked = false,
    selected,
    detail = 'full',
    zoom = 1,
    fontSize = defaultFontSize,
    ref,
    onRequestLink,
    onFormatStateChange,
  } = props;
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<InlineTextEditorHandle>(null);
  const linkOpen = useRef(false);
  const [menu, setMenu] = useState<TableMenu | null>(null);
  const controls = canEdit && selected;
  const canResize = controls && !locked;
  const scale = tableScale(zoom);
  const columns = useTableColumnResize(canResize, scale, value.version);
  const { resizing } = columns;
  const session = useTableSession(props, resizing);
  const model = columns.preview ?? session.model;
  const active = canEdit ? session.active : null;
  const visibleMenu = controls ? menu : null;
  const fullDetail = session.editing || visibleMenu || session.error;
  const view = fullDetail ? 'full' : detail;
  const activeRow = active?.row;
  const activeColumn = active?.column;

  useEffect(() => {
    if (activeRow !== undefined && activeColumn !== undefined) {
      editor.current?.focus();
    }
  }, [activeRow, activeColumn]);

  const hideUnavailableMenu = useEffectEvent(() => {
    if (!selected || !canEdit) {
      setMenu(null);
    }
  });
  useLayoutEffect(() => {
    hideUnavailableMenu();
  }, [canEdit, selected]);

  function format(format: InlineTextFormat, url?: string) {
    const applied = editor.current?.format(format, url) ?? false;
    if (applied && format === 'link') {
      linkOpen.current = false;
    }

    return applied;
  }

  function focus() {
    editor.current?.focus();
  }

  useImperativeHandle(ref, () => ({ format, focus }));

  function handleStartColumn(event: PointerEvent<HTMLDivElement>, column: number) {
    if (session.saving) {
      return;
    }

    columns.start(
      event,
      column,
      session.source().model,
      root.current?.getBoundingClientRect().width ?? 0,
    );
  }

  function handleFinishColumn(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const next = columns.end(event, cancelled);
    if (next) {
      session.commit(active, next);
    }
  }

  function handleInsert(axis: TableAxis, index?: number) {
    const source = session.source().model;
    const end = axis === 'row' ? source.rows.length : source.columnIds.length;
    const position = index ?? end;
    const target =
      axis === 'row'
        ? { row: position, column: active?.column ?? 0 }
        : { row: active?.row ?? 0, column: position };
    setMenu(null);
    session.commit(target, insertAxis(source, axis, position, locked));
  }

  function handleRemove(axis: TableAxis, cell: CellAddress) {
    const source = session.source().model;
    const length = axis === 'row' ? source.rows.length : source.columnIds.length;
    if (length < 2) {
      return;
    }

    const position = axis === 'row' ? cell.row : cell.column;
    const next = removeAxis(source, axis, position, locked);
    setMenu(null);
    session.commit(clampCell(cell, next), next);
  }

  function handleToggleHead() {
    const source = session.source().model;
    session.commit(active, { ...source, head: !source.head });
  }

  function handleCellPress(event: PointerEvent<HTMLTableCellElement>, cell: CellAddress) {
    const canNavigate = active && !session.saving;
    if (event.button !== primaryButton || !canNavigate || sameCell(active, cell)) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    session.commit(cell);
  }

  function handleCellOpen(event: MouseEvent<HTMLTableCellElement>, cell: CellAddress) {
    if (event.button !== primaryButton || !canEdit) {
      return;
    }

    event.stopPropagation();
    session.select(cell);
  }

  function handleMenuOpen(event: MouseEvent<HTMLTableCellElement>, cell: CellAddress) {
    if (!canEdit || session.saving) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (!active) {
      session.select(cell);
    }

    setMenu({
      cell,
      anchor: { x: event.clientX, y: event.clientY },
      host: event.currentTarget.ownerDocument.body,
    });
  }

  function handleEditorBlur(event: FocusEvent<HTMLDivElement>) {
    const target = event.relatedTarget;
    const inTable = root.current?.contains(target);
    const inMenu =
      target?.closest('[data-table-floating-menu]')?.getAttribute('data-table-floating-menu') ===
      value.id;

    if (inTable || inMenu || linkOpen.current) {
      event.preventDefault();
    }
  }

  function handleLinkRequest(url: string) {
    linkOpen.current = true;
    onRequestLink?.(url);
  }

  function navigateTab(event: KeyboardEvent<HTMLDivElement>, cell: CellAddress) {
    event.preventDefault();
    const source = session.source().model;
    const target = tabCell(source, cell, event.shiftKey);
    if (!target) {
      return;
    }

    const next =
      target.row >= source.rows.length
        ? insertAxis(source, 'row', source.rows.length, locked)
        : undefined;
    session.commit(target, next);
  }

  function editorKeys(event: KeyboardEvent<HTMLDivElement>, cell: CellAddress) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) {
      return;
    }

    const movesCell = event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey);
    if (movesCell && session.saving) {
      event.preventDefault();
      return;
    }

    if (event.key === 'Escape' && visibleMenu) {
      event.preventDefault();
      setMenu(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const nextRow = cell.row + 1;
      const finish = event.ctrlKey || event.metaKey || nextRow >= model.rows.length;
      session.commit(finish ? null : { row: nextRow, column: cell.column });
    }
    if (event.key === 'Tab') {
      navigateTab(event, cell);
    }
  }

  function renderEditor(cell: CellAddress, text: string) {
    return (
      <InlineTextEditor
        ref={editor}
        className="studio-object-table-editor"
        ariaLabel={'表格第' + (cell.row + 1) + '行第' + (cell.column + 1) + '列'}
        value={text}
        disabled={!canEdit}
        onChange={(value) => session.patch(changeCell(session.source().model, cell, value))}
        onCommit={() => session.commit(null)}
        onBlur={handleEditorBlur}
        onKeyDown={(event) => editorKeys(event, cell)}
        onRequestLink={onRequestLink ? handleLinkRequest : undefined}
        onFormatStateChange={onFormatStateChange}
      />
    );
  }

  function closeMenu() {
    setMenu(null);
  }

  function handleOutlineOpen(event: MouseEvent<HTMLDivElement>) {
    if (view !== 'outline' || event.button !== primaryButton) {
      return;
    }

    event.stopPropagation();
    session.select({ row: 0, column: 0 });
  }

  return (
    <div
      ref={root}
      className="studio-object-table"
      data-table-detail={view}
      style={{ width: model.width, fontSize }}
      onDoubleClick={handleOutlineOpen}
    >
      <div className="studio-object-table-content">
        <TableGrid
          model={model}
          active={active}
          detail={view}
          readable={fontSize * scale >= readableFontSize}
          bodyPaint={props.bodyPaint}
          headerPaint={props.headerPaint}
          renderEditor={renderEditor}
          onCellPress={handleCellPress}
          onCellOpen={handleCellOpen}
          onCellMenu={handleMenuOpen}
        />
        {canResize && (detail === 'full' || resizing) && (
          <TableColumns
            model={model}
            zoom={scale}
            onStart={handleStartColumn}
            onMove={columns.handleMove}
            onEnd={handleFinishColumn}
          />
        )}
      </div>
      {controls && (
        <TableControls
          tableId={value.id}
          model={model}
          active={active}
          saving={session.saving}
          error={session.error}
          onInsert={handleInsert}
          onRemove={handleRemove}
          onToggleHead={handleToggleHead}
          onRetry={() => session.commit(null)}
          onDiscard={session.discard}
        />
      )}
      {visibleMenu && (
        <TableCellMenu
          tableId={value.id}
          menu={visibleMenu}
          model={model}
          saving={session.saving}
          onInsert={handleInsert}
          onRemove={handleRemove}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

export function TableObject(props: TableObjectProps) {
  return <TableObjectSession key={props.value.id} {...props} />;
}
