import {
  ArrowLeft,
  ChevronDown,
  Clock3,
  Download,
  Frame,
  Hand,
  Maximize,
  MessageSquare,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Share2,
  Smile,
  Square,
  StickyNote,
  Timer,
  Type,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AnchoredPopover } from '../../ui/base/index.js';

export type BoardTool = 'select' | 'pan';

interface BoardHeaderProps {
  readonly title: string;
  readonly onBack?: () => void;
  readonly status: ReactNode;
  readonly onOpenViewing?: (trigger: HTMLButtonElement) => void;
  readonly onOpenExport?: (trigger: HTMLButtonElement) => void;
}

interface BoardToolbarProps {
  readonly tool: BoardTool;
  readonly onToolChange: (tool: BoardTool) => void;
}

interface BoardViewportToolsProps {
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly onFit: (scope: 'board' | 'selection') => void;
  readonly hasObjects: boolean;
  readonly hasSelection: boolean;
  readonly showGrid: boolean;
  readonly onShowGridChange: (visible: boolean) => void;
}

const selectionTools = [
  { tool: 'select', label: '选择', Icon: MousePointer2 },
  { tool: 'pan', label: '平移', Icon: Hand },
] as const;
const placementTools = [
  { label: '文字', Icon: Type },
  { label: '分区', Icon: Frame },
  { label: '便签', Icon: StickyNote },
  { label: '画笔', Icon: PenLine },
  { label: '形状', Icon: Square },
  { label: '贴纸', Icon: Smile },
] as const;
const zoomPresets = [0.25, 0.5, 0.75, 1, 1.5, 2];
const zoomStep = 1.2;
const unavailable = '当前白板服务暂未提供此操作';

export function BoardHeader({
  title,
  onBack,
  status,
  onOpenViewing,
  onOpenExport,
}: BoardHeaderProps) {
  return (
    <header className="whiteboard-editor__header">
      <div className="whiteboard-editor__header-main">
        <button
          className="whiteboard-editor__icon"
          type="button"
          aria-label="返回 Luming Studio"
          onClick={onBack}
          disabled={!onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="whiteboard-editor__title" title={title}>
          {title}
        </h1>
        <div className="whiteboard-editor__status">{status}</div>
      </div>
      <div className="whiteboard-editor__actions">
        {onOpenViewing && (
          <button
            className="whiteboard-editor__icon"
            aria-label="全屏观看白板"
            title="全屏观看白板"
            type="button"
            onClick={(event) => onOpenViewing(event.currentTarget)}
          >
            <Maximize size={20} />
          </button>
        )}
        {onOpenExport && (
          <button
            className="whiteboard-editor__icon whiteboard-editor__share"
            type="button"
            aria-haspopup="dialog"
            onClick={(event) => onOpenExport(event.currentTarget)}
          >
            <Download size={20} />
            导出
          </button>
        )}
        <button
          className="whiteboard-editor__icon"
          aria-label="版本历史"
          type="button"
          disabled
          title={unavailable}
        >
          <Clock3 size={20} />
        </button>
        <button
          className="whiteboard-editor__icon whiteboard-editor__share"
          type="button"
          disabled
          title={unavailable}
        >
          <Share2 size={20} />
          分享
        </button>
        <button
          className="whiteboard-editor__icon"
          aria-label="备注列表"
          type="button"
          disabled
          title={unavailable}
        >
          <MessageSquare size={20} />
        </button>
        <button
          className="whiteboard-editor__icon"
          aria-label="更多白板操作"
          type="button"
          disabled
          title={unavailable}
        >
          <ChevronDown size={15} />
        </button>
      </div>
    </header>
  );
}

interface SelectionViewingProps {
  readonly onOpen: (trigger: HTMLButtonElement) => void;
}

export function BoardSelectionViewing({ onOpen }: SelectionViewingProps) {
  return (
    <button
      className="whiteboard-editor__icon"
      type="button"
      aria-label="全屏观看选区"
      title="全屏观看选区"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <Maximize size={18} />
    </button>
  );
}

export function BoardToolbar({ tool, onToolChange }: BoardToolbarProps) {
  return (
    <div className="whiteboard-editor__toolbar" role="toolbar" aria-label="白板工具">
      {selectionTools.map(({ tool: id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={tool === id}
          onClick={() => onToolChange(id)}
        >
          <Icon size={20} />
        </button>
      ))}
      {placementTools.map(({ label, Icon }) => (
        <button key={label} type="button" aria-label={label} title={unavailable} disabled>
          <Icon size={20} />
        </button>
      ))}
    </div>
  );
}

export function BoardViewportTools({
  zoom,
  onZoom,
  onFit,
  hasObjects,
  hasSelection,
  showGrid,
  onShowGridChange,
}: BoardViewportToolsProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  function closeAndFocus() {
    setOpen(false);
    anchor?.focus({ preventScroll: true });
  }

  function chooseZoom(value: number) {
    onZoom(value);
    closeAndFocus();
  }

  function handleFit(scope: 'board' | 'selection') {
    onFit(scope);
    closeAndFocus();
  }

  return (
    <div className="whiteboard-editor__viewport-tools">
      <button type="button" aria-label="计时器" disabled title={unavailable}>
        <Timer size={19} />
      </button>
      <span className="whiteboard-editor__tool-divider" aria-hidden="true" />
      <button
        ref={setAnchor}
        className="whiteboard-editor__zoom-value"
        type="button"
        aria-label="缩放菜单"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {Math.round(zoom * 100)}% <ChevronDown size={14} />
      </button>
      <AnchoredPopover
        open={open}
        anchor={anchor}
        onRequestClose={(reason) => {
          if (reason === 'escape') {
            closeAndFocus();
            return;
          }
          setOpen(false);
        }}
      >
        <div className="whiteboard-editor__zoom-menu" role="menu" aria-label="缩放与视图">
          <div className="whiteboard-editor__zoom-steps">
            <button type="button" aria-label="缩小" onClick={() => onZoom(zoom / zoomStep)}>
              <Minus size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="放大" onClick={() => onZoom(zoom * zoomStep)}>
              <Plus size={16} />
            </button>
          </div>
          {zoomPresets.map((value) => (
            <button key={value} type="button" role="menuitem" onClick={() => chooseZoom(value)}>
              {Math.round(value * 100)}%
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            disabled={!hasObjects}
            onClick={() => handleFit('board')}
          >
            <Maximize size={15} />
            适应白板
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasSelection}
            onClick={() => handleFit('selection')}
          >
            <Maximize size={15} />
            适应选区
          </button>
          <hr />
          <details>
            <summary>视图设置</summary>
            <label>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => onShowGridChange(event.currentTarget.checked)}
              />
              显示网格
            </label>
          </details>
        </div>
      </AnchoredPopover>
    </div>
  );
}
