import { ChevronDown, Maximize, Minus, Plus, Redo2, RotateCcw } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover } from '../../ui/base/index.js';
import { BoardTimer } from './BoardTimer.js';
import './board-viewport-tools.css';

type FitScope = 'board' | 'selection';
type HistoryDirection = 'undo' | 'redo';

interface ViewportHistory {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onChange: (direction: HistoryDirection) => void;
}

interface BoardViewportToolsProps {
  readonly zoom: number;
  readonly onZoom: (value: number) => void;
  readonly onFit: (scope: FitScope) => void;
  readonly hasSelection: boolean;
  readonly showGrid: boolean;
  readonly onShowGridChange: (show: boolean) => void;
  readonly singleKeys: boolean;
  readonly onSingleKeysChange: (enabled: boolean) => void;
  readonly history?: ViewportHistory;
  readonly timerEditable?: boolean;
  readonly timer?: ReactNode;
}

type ViewSettingsProps = Pick<
  BoardViewportToolsProps,
  'showGrid' | 'onShowGridChange' | 'singleKeys' | 'onSingleKeysChange'
>;

const zoomStep = 1.2;
const zoomPresets = [25, 50, 75, 100, 150, 200];

function HistoryButtons({ history }: { readonly history?: ViewportHistory }) {
  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-label="撤销"
        disabled={!history?.canUndo}
        onClick={() => history?.onChange('undo')}
      >
        <RotateCcw size={15} />
        撤销<span>⌘/Ctrl Z</span>
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label="重做"
        disabled={!history?.canRedo}
        onClick={() => history?.onChange('redo')}
      >
        <Redo2 size={15} />
        重做
      </button>
    </>
  );
}

function ViewSettings({
  showGrid,
  onShowGridChange,
  singleKeys,
  onSingleKeysChange,
}: ViewSettingsProps) {
  return (
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
      <label>
        <input
          type="checkbox"
          checked={singleKeys}
          onChange={(event) => onSingleKeysChange(event.currentTarget.checked)}
        />
        数字工具快捷键
      </label>
    </details>
  );
}

export function BoardViewportTools({
  zoom,
  onZoom,
  onFit,
  hasSelection,
  history,
  timerEditable = true,
  timer,
  ...settings
}: BoardViewportToolsProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const percent = Math.round(zoom * 100);

  function closeAndFocus() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function chooseZoom(value: number) {
    onZoom(value / 100);
    closeAndFocus();
  }

  function fit(scope: FitScope) {
    onFit(scope);
    closeAndFocus();
  }

  return (
    <div className="whiteboard-viewport-tools">
      {timer ?? <BoardTimer canEdit={timerEditable} />}
      <span className="whiteboard-viewport-tools__divider" aria-hidden="true" />
      <div ref={setAnchor} className="whiteboard-viewport-tools__zoom">
        <button
          ref={trigger}
          className="whiteboard-viewport-tools__zoom-value"
          type="button"
          aria-label="缩放菜单"
          aria-expanded={open}
          title="缩放与视图"
          onClick={() => setOpen((value) => !value)}
        >
          {percent}%<ChevronDown size={14} />
        </button>
        <AnchoredPopover
          open={open}
          anchor={anchor}
          placement="bottom"
          align="end"
          onRequestClose={(reason) => {
            if (reason === 'escape') {
              closeAndFocus();
              return;
            }

            setOpen(false);
          }}
        >
          <div className="whiteboard-viewport-tools__menu" role="menu" aria-label="缩放与视图">
            <div className="whiteboard-viewport-tools__steps">
              <button type="button" aria-label="缩小" onClick={() => onZoom(zoom / zoomStep)}>
                <Minus size={16} />
              </button>
              <span>{percent}%</span>
              <button type="button" aria-label="放大" onClick={() => onZoom(zoom * zoomStep)}>
                <Plus size={16} />
              </button>
            </div>
            {zoomPresets.map((value) => (
              <button key={value} type="button" role="menuitem" onClick={() => chooseZoom(value)}>
                {value}%
              </button>
            ))}
            <button type="button" role="menuitem" onClick={() => fit('board')}>
              <Maximize size={15} />
              适应白板
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasSelection}
              onClick={() => fit('selection')}
            >
              <Maximize size={15} />
              适应选区
            </button>
            <hr />
            <HistoryButtons history={history} />
            <ViewSettings {...settings} />
          </div>
        </AnchoredPopover>
      </div>
    </div>
  );
}
