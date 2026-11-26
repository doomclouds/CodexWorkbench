import type { MouseEvent, PointerEvent, ReactNode } from 'react';

import { RichText, richTextFirstLine } from '../text/index.js';
import type { TableObjectDetail, TableObjectPaint } from './contracts.js';
import type { CellAddress, TableModel } from './table-model.js';

interface TableGridProps {
  readonly model: TableModel;
  readonly active: CellAddress | null;
  readonly detail: TableObjectDetail;
  readonly readable: boolean;
  readonly frameHeight?: number;
  readonly zoom: number;
  readonly bodyPaint?: TableObjectPaint;
  readonly headerPaint?: TableObjectPaint;
  readonly renderEditor: (cell: CellAddress, text: string) => ReactNode;
  readonly onCellPress: (event: PointerEvent<HTMLTableCellElement>, cell: CellAddress) => void;
  readonly onCellOpen: (event: MouseEvent<HTMLTableCellElement>, cell: CellAddress) => void;
  readonly onCellMenu: (event: MouseEvent<HTMLTableCellElement>, cell: CellAddress) => void;
}

export function sameCell(left: CellAddress | null, right: CellAddress) {
  return left?.row === right.row && left.column === right.column;
}

function PreviewCell({ text, readable }: { text: string; readable: boolean }) {
  if (readable) {
    return <span className="studio-object-table-preview-text">{richTextFirstLine(text)}</span>;
  }

  return text.trim() ? (
    <span className="studio-object-table-preview-bar" aria-hidden="true" />
  ) : null;
}

export function TableGrid({
  model,
  active,
  detail,
  readable,
  frameHeight,
  zoom,
  bodyPaint,
  headerPaint,
  renderEditor,
  onCellPress,
  onCellOpen,
  onCellMenu,
}: TableGridProps) {
  const previewRowHeight = frameHeight === undefined ? undefined : frameHeight / model.rows.length;
  if (detail === 'outline') {
    const height =
      frameHeight === undefined
        ? undefined
        : Math.min(frameHeight, Math.max(frameHeight / model.rows.length, 2 / zoom));

    return model.head ? (
      <div
        className="studio-object-table-outline-header"
        aria-hidden="true"
        style={{ ...headerPaint, height }}
      />
    ) : null;
  }

  const preview = detail === 'preview';
  const visibleRows = preview ? model.rows.slice(0, model.head ? 3 : 2) : model.rows;

  function cellContent(text: string, cell: CellAddress) {
    if (sameCell(active, cell)) {
      return renderEditor(cell, text);
    }
    if (preview) {
      return <PreviewCell text={text} readable={readable} />;
    }

    return <RichText text={text} />;
  }

  function renderRow(row: readonly string[], rowIndex: number) {
    const header = model.head && rowIndex === 0;
    const Cell = header ? 'th' : 'td';

    return (
      <tr key={model.rowIds[rowIndex]} style={preview ? { height: previewRowHeight } : undefined}>
        {row.map((text, column) => {
          const cell = { row: rowIndex, column };

          return (
            <Cell
              key={model.columnIds[column]}
              data-cell={rowIndex + ':' + column}
              scope={header ? 'col' : undefined}
              style={header ? headerPaint : undefined}
              onPointerDown={(event) => onCellPress(event, cell)}
              onDoubleClick={(event) => onCellOpen(event, cell)}
              onContextMenu={(event) => onCellMenu(event, cell)}
            >
              {cellContent(text, cell)}
            </Cell>
          );
        })}
      </tr>
    );
  }

  return (
    <table className="studio-object-table-grid" style={bodyPaint}>
      <colgroup>
        {model.widths.map((width, index) => (
          <col key={model.columnIds[index]} style={{ width }} />
        ))}
      </colgroup>
      <tbody>{visibleRows.map(renderRow)}</tbody>
    </table>
  );
}
