import type { PointerEvent } from 'react';

import type { TableModel } from './table-model.js';

interface TableColumnsProps {
  readonly model: TableModel;
  readonly zoom: number;
  readonly onStart: (event: PointerEvent<HTMLDivElement>, column: number) => void;
  readonly onMove: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onEnd: (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => void;
}

const handleWidth = 8;

function columnEdges(widths: readonly number[]) {
  const edges: number[] = [];
  for (const width of widths) {
    edges.push(width + (edges.at(-1) ?? 0));
  }

  return edges;
}

export function TableColumns({ model, zoom, onStart, onMove, onEnd }: TableColumnsProps) {
  return (
    <>
      {columnEdges(model.widths).map((edge, column) => (
        <div
          key={model.columnIds[column]}
          role="separator"
          aria-label={'调整第' + (column + 1) + '列宽度'}
          aria-orientation="vertical"
          className="studio-object-table-column-handle"
          style={{ left: edge, width: handleWidth / zoom }}
          onPointerDown={(event) => onStart(event, column)}
          onPointerMove={onMove}
          onPointerUp={(event) => onEnd(event, false)}
          onPointerCancel={(event) => onEnd(event, true)}
          onLostPointerCapture={(event) => onEnd(event, true)}
        />
      ))}
    </>
  );
}
