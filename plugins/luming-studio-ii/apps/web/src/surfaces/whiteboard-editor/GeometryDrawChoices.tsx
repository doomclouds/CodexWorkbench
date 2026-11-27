import { ArrowUpRight, Check, PenLine } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { CanvasTool } from '../../ui/domain/canvas/index.js';

export type DrawTool = Extract<CanvasTool, 'pen' | 'connector'>;

const inkPresets = [
  { label: '墨色', color: '#0B0B0B' },
  { label: '陶土色', color: '#D97757' },
  { label: '蓝色', color: '#2F7CC4' },
  { label: '绿色', color: '#2E8B57' },
  { label: '紫色', color: '#7C5CBF' },
] as const;

export const defaultInkColor = inkPresets[0].color;

type InkStyle = CSSProperties & {
  readonly '--geometry-ink-paint': string;
};

interface DrawChoicesProps {
  readonly tool: CanvasTool;
  readonly onToolChange: (tool: DrawTool) => void;
  readonly penColor?: string;
  readonly onPenColorChange?: (color: string) => void;
}

export function GeometryDrawChoices({
  tool,
  onToolChange,
  penColor = defaultInkColor,
  onPenColorChange,
}: DrawChoicesProps) {
  return (
    <div className="whiteboard-editor__draw-options" role="toolbar" aria-label="绘图选项">
      <div className="whiteboard-editor__draw-modes">
        <button
          type="button"
          aria-label="画笔模式"
          aria-pressed={tool === 'pen'}
          title="画笔（6）"
          onClick={() => onToolChange('pen')}
        >
          <PenLine size={18} />
        </button>
        <button
          type="button"
          aria-label="箭头模式"
          aria-pressed={tool === 'connector'}
          title="箭头"
          onClick={() => onToolChange('connector')}
        >
          <ArrowUpRight size={18} />
        </button>
      </div>
      <span className="whiteboard-editor__tool-divider" aria-hidden="true" />
      <div className="whiteboard-editor__draw-inks" role="group" aria-label="墨色色板">
        {inkPresets.map(({ label, color }) => {
          const selected = penColor.toLowerCase() === color.toLowerCase();
          const style: InkStyle = { '--geometry-ink-paint': color };

          return (
            <button
              key={color}
              type="button"
              aria-label={'墨色 ' + label}
              aria-pressed={selected}
              title={label}
              disabled={!onPenColorChange}
              style={style}
              data-canvas-stroke={color}
              onClick={() => onPenColorChange?.(color)}
            >
              {selected && <Check size={13} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
