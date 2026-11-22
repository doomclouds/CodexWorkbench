import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react';
import { ChevronDown, Maximize, Minus, Plus, Redo2, RotateCcw } from 'lucide-react';

interface CanvasHistoryControls {
  canEdit: boolean;
  saving: boolean;
  unconfirmed: boolean;
  hasUndo: boolean;
  hasRedo: boolean;
}

interface CanvasViewportToolbarProps {
  documentControls?: ReactNode;
  hidden: boolean;
  zoom: number;
  zoomMenu: boolean;
  hasSelection: boolean;
  history: CanvasHistoryControls;
  showGrid: boolean;
  singleKeys: boolean;
  setZoomMenu: Dispatch<SetStateAction<boolean>>;
  setShowGrid: (show: boolean) => void;
  setSingleKeys: (enabled: boolean) => void;
  fit: (scope: 'all' | 'selection') => void;
  stepZoom: (factor: number) => void;
  changeHistory: (direction: 'undo' | 'redo') => void;
}

export function CanvasViewportToolbar({
  documentControls,
  hidden,
  zoom,
  zoomMenu,
  hasSelection,
  history,
  showGrid,
  singleKeys,
  setZoomMenu,
  setShowGrid,
  setSingleKeys,
  fit,
  stepZoom,
  changeHistory,
}: CanvasViewportToolbarProps) {
  const historyBlocked = !history.canEdit || history.saving || history.unconfirmed;
  const handleFitBoard: NonNullable<ComponentProps<'button'>['onClick']> = () => {
    fit('all');
    setZoomMenu(false);
  };
  const handleFitSelection: NonNullable<ComponentProps<'button'>['onClick']> = () => {
    fit('selection');
    setZoomMenu(false);
  };

  return (
    <div className="studio-canvas-top-tools" hidden={hidden} data-native-interactive="true">
      {documentControls}
      {documentControls && <span className="studio-tool-divider" />}
      <button
        type="button"
        className="studio-zoom-value"
        aria-label="缩放菜单"
        aria-expanded={zoomMenu}
        title="缩放与视图"
        onClick={() => setZoomMenu((value) => !value)}
      >
        {Math.round(zoom * 100)}%<ChevronDown size={14} />
      </button>
      {zoomMenu && (
        <div className="studio-zoom-menu" role="menu" aria-label="缩放与视图">
          <div className="studio-zoom-steps">
            <button type="button" aria-label="缩小" onClick={() => stepZoom(1 / 1.2)}>
              <Minus size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="放大" onClick={() => stepZoom(1.2)}>
              <Plus size={16} />
            </button>
          </div>
          {[25, 50, 75, 100, 150, 200].map((value) => {
            const handlePresetZoom: NonNullable<ComponentProps<'button'>['onClick']> = () => {
              stepZoom(value / 100 / zoom);
              setZoomMenu(false);
            };

            return (
              <button type="button" role="menuitem" key={value} onClick={handlePresetZoom}>
                {value}%
              </button>
            );
          })}
          <button type="button" role="menuitem" onClick={handleFitBoard}>
            <Maximize size={15} />
            适应白板
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasSelection}
            onClick={handleFitSelection}
          >
            <Maximize size={15} />
            适应选区
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            aria-label="撤销"
            disabled={historyBlocked || !history.hasUndo}
            onClick={() => changeHistory('undo')}
          >
            <RotateCcw size={15} />
            撤销<span>⌘/Ctrl Z</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label="重做"
            disabled={historyBlocked || !history.hasRedo}
            onClick={() => changeHistory('redo')}
          >
            <Redo2 size={15} />
            重做
          </button>
          <details>
            <summary>视图设置</summary>
            <label>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => setShowGrid(event.target.checked)}
              />
              显示网格
            </label>
            <label>
              <input
                type="checkbox"
                checked={singleKeys}
                onChange={(event) => setSingleKeys(event.target.checked)}
              />
              数字工具快捷键
            </label>
          </details>
        </div>
      )}
    </div>
  );
}
