import { Braces, Crop } from 'lucide-react';

import type { CanvasObject } from '../../ui/domain/canvas/index.js';
import type { GeometrySelectionAction } from './geometry-commands.js';

interface SelectionObjectControlsProps {
  readonly selection: readonly CanvasObject[];
  readonly canEdit: boolean;
  readonly onEditObject?: (id: string) => void;
  readonly onAction: (action: GeometrySelectionAction, ids: readonly string[]) => void;
}

const regionNames = new Map([
  ['html', 'HTML 图解'],
  ['diagram', '图解'],
  ['chart', '图表'],
  ['document', '文档区域'],
  ['todo', '任务清单'],
]);
const connectorHeads = [
  { value: 'none', label: '无' },
  { value: 'arrow', label: '箭头' },
  { value: 'circle', label: '圆点' },
] as const;

function ConnectorControls({
  object,
  onAction,
}: {
  readonly object: Extract<CanvasObject, { kind: 'connector' }>;
  readonly onAction: SelectionObjectControlsProps['onAction'];
}) {
  return (
    <>
      {(['start', 'end'] as const).map((end) => {
        const start = end === 'start';
        const value = start
          ? (object.connection.startHead ?? 'none')
          : (object.connection.endHead ?? 'arrow');
        const label = start ? '连接线起点' : '连接线终点';

        return (
          <select
            key={end}
            className="whiteboard-editor__connector-end"
            aria-label={label}
            value={value}
            disabled={object.locked}
            onChange={(event) => {
              const selected = connectorHeads.find(
                (choice) => choice.value === event.currentTarget.value,
              );

              if (selected) {
                onAction({ kind: 'connectorHead', end, head: selected.value }, [object.id]);
              }
            }}
          >
            {connectorHeads.map(({ value: id, label: name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        );
      })}
    </>
  );
}

export function GeometrySelectionObjectControls({
  selection,
  canEdit,
  onEditObject,
  onAction,
}: SelectionObjectControlsProps) {
  const selected = selection.length === 1 ? selection[0] : undefined;
  if (!selected) {
    return null;
  }

  const { id, kind, label, locked } = selected;
  const region = regionNames.get(kind);
  if (region) {
    const title = label || region;

    return (
      <>
        <span className="whiteboard-editor__selection-label" title={title}>
          {title}
        </span>
        {kind === 'html' && canEdit && onEditObject && (
          <button
            type="button"
            className="whiteboard-editor__selection-icon"
            aria-label="编辑 HTML 源码"
            title="编辑 HTML 源码"
            onClick={() => onEditObject(id)}
          >
            <Braces size={18} />
          </button>
        )}
      </>
    );
  }
  if (kind === 'connector' && canEdit) {
    return <ConnectorControls object={selected} onAction={onAction} />;
  }
  if (kind === 'image' && canEdit && onEditObject) {
    return (
      <button
        type="button"
        className="whiteboard-editor__selection-icon"
        aria-label="裁剪图片"
        title="裁剪图片"
        disabled={locked}
        onClick={() => onEditObject(id)}
      >
        <Crop size={17} />
      </button>
    );
  }

  return null;
}
