import { ArrowUpRight, Check, PenLine } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { CanvasTool } from '../../ui/domain/canvas/index.js';

export type DrawTool = Extract<CanvasTool, 'pen' | 'connector'>;

const inkPresets = [
  { label: '墨色', light: '#0B0B0B', dark: '#EFEFEF' },
  { label: '陶土色', light: '#D97757', dark: '#F0A77F' },
  { label: '蓝色', light: '#2F7CC4', dark: '#9CCDE8' },
  { label: '绿色', light: '#2E8B57', dark: '#B7DFA4' },
  { label: '紫色', light: '#7C5CBF', dark: '#CDB6EC' },
] as const;

type InkStyle = CSSProperties & {
  readonly '--geometry-ink-light': string;
  readonly '--geometry-ink-dark': string;
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
  penColor = inkPresets[0].light,
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
        {inkPresets.map(({ label, light, dark }) => {
          const selected = penColor.toLowerCase() === light.toLowerCase();
          const style: InkStyle = { '--geometry-ink-light': light, '--geometry-ink-dark': dark };

          return (
            <button
              key={light}
              type="button"
              aria-label={'墨色 ' + label}
              aria-pressed={selected}
              title={label}
              disabled={!onPenColorChange}
              style={style}
              onClick={() => onPenColorChange?.(light)}
            >
              {selected && <Check size={13} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
