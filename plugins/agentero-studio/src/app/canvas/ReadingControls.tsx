import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { ChevronDown, Hand, Highlighter, Maximize, Minus, Plus, Trash2 } from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM } from './canvas-model.js';
import { registerEscapeLayer } from '../shared/escape.js';
import './reading-controls.css';

export interface ReadingControlsProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  markerMode: boolean;
  onMarkerModeChange: (active: boolean) => void;
  onClear: () => void;
  onCanvasFocus: () => void;
  onInteract?: () => void;
}

const percent = (zoom: number) => String(Math.round(zoom * 1000) / 10);
const presets = [25, 50, 75, 100, 150, 200];

function presetIndexForKey(key: string, current: number, count: number) {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }

  return (current + (key === 'ArrowDown' ? 1 : -1) + count) % count;
}

export default function ReadingControls({
  zoom,
  onZoom,
  onFit,
  markerMode,
  onMarkerModeChange,
  onClear,
  onCanvasFocus,
  onInteract,
}: ReadingControlsProps) {
  const [draft, setDraft] = useState(() => percent(zoom));
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const skipBlur = useRef(false);
  const hintId = useId();
  useEffect(() => {
    if (document.activeElement !== input.current) {
      setDraft(percent(zoom));
      setError('');
    }
  }, [zoom]);
  useEffect(() => {
    if (!open || !menu.current) {
      return;
    }

    const close = () => {
      setOpen(false);
      trigger.current?.focus();
    };

    const dispose = registerEscapeLayer(menu.current, close, 30);
    (
      menu.current.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      menu.current.querySelector<HTMLButtonElement>('button')
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', outside, true);

    return () => {
      dispose();
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open]);
  function commit() {
    const value = draft.trim().replace(/%$/, '');
    const number = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(number) || number < MIN_ZOOM * 100 || number > MAX_ZOOM * 100) {
      setError('请输入 5%–800% 的比例。');

      return false;
    }

    setError('');
    onZoom(number / 100);
    setDraft(percent(number / 100));

    return true;
  }

  function handleInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (commit()) {
        skipBlur.current = true;
        event.currentTarget.blur();
        onCanvasFocus();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      skipBlur.current = true;
      setDraft(percent(zoom));
      setError('');
      event.currentTarget.blur();
      onCanvasFocus();
    }
  }

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    items[presetIndexForKey(event.key, current, items.length)]?.focus();
  }

  function focusAfterPointer(event: { detail: number }) {
    if (event.detail > 0) {
      onCanvasFocus();
    }
  }

  function handleBrowse(event: MouseEvent<HTMLButtonElement>) {
    onMarkerModeChange(false);
    focusAfterPointer(event);
  }

  function handleMarkerToggle(event: MouseEvent<HTMLButtonElement>) {
    onMarkerModeChange(!markerMode);
    focusAfterPointer(event);
  }

  function handleClear(event: MouseEvent<HTMLButtonElement>) {
    onClear();
    focusAfterPointer(event);
  }

  function handleZoomOut(event: MouseEvent<HTMLButtonElement>) {
    onZoom(Math.max(MIN_ZOOM, zoom / 1.2));
    focusAfterPointer(event);
  }

  function handleZoomIn(event: MouseEvent<HTMLButtonElement>) {
    onZoom(Math.min(MAX_ZOOM, zoom * 1.2));
    focusAfterPointer(event);
  }

  function handleFit(event: MouseEvent<HTMLButtonElement>) {
    onFit();
    focusAfterPointer(event);
  }

  function handleInputFocus(event: FocusEvent<HTMLInputElement>) {
    skipBlur.current = false;
    setOpen(false);
    event.currentTarget.select();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value);
    setError('');
  }

  function handleInputBlur() {
    if (skipBlur.current) {
      skipBlur.current = false;

      return;
    }

    commit();
  }

  function handlePreset(event: MouseEvent<HTMLButtonElement>, value: number) {
    setError('');
    setDraft(String(value));
    onZoom(value / 100);
    setOpen(false);
    if (event.detail > 0) {
      onCanvasFocus();
    } else {
      trigger.current?.focus();
    }
  }

  return (
    <div
      ref={root}
      className="studio-reading-controls"
      role="toolbar"
      aria-label="全屏观看工具"
      data-native-interactive="true"
      onPointerDownCapture={onInteract}
      onFocusCapture={onInteract}
    >
      <button
        type="button"
        aria-label="浏览内容"
        title="浏览内容：可操作按钮、选字和滚动"
        aria-pressed={!markerMode}
        onClick={handleBrowse}
      >
        <Hand size={18} />
      </button>
      <button
        type="button"
        aria-label="临时荧光笔"
        title="临时荧光笔：圈画后约 3 秒淡出，仅本次观看"
        aria-pressed={markerMode}
        onClick={handleMarkerToggle}
      >
        <Highlighter size={18} />
      </button>
      <button
        type="button"
        aria-label="清除临时笔迹"
        title="清除本次观看的临时笔迹"
        onClick={handleClear}
      >
        <Trash2 size={17} />
      </button>
      <span className="studio-reading-controls-divider" />
      <button
        type="button"
        aria-label="全屏缩小"
        title="缩小"
        disabled={zoom <= MIN_ZOOM}
        onClick={handleZoomOut}
      >
        <Minus size={17} />
      </button>
      <div className={`studio-reading-percent${error ? ' has-error' : ''}`}>
        <input
          ref={input}
          aria-label="全屏缩放比例"
          aria-invalid={!!error}
          aria-describedby={error ? hintId : undefined}
          inputMode="decimal"
          value={draft}
          onFocus={handleInputFocus}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKey}
        />
        <span aria-hidden="true">%</span>
      </div>
      <button
        type="button"
        ref={trigger}
        className="studio-reading-preset-toggle"
        aria-label="常用全屏比例"
        title="选择常用比例"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        aria-label="全屏放大"
        title="放大"
        disabled={zoom >= MAX_ZOOM}
        onClick={handleZoomIn}
      >
        <Plus size={17} />
      </button>
      <button
        type="button"
        aria-label="适应全屏内容"
        title="适应正在观看的内容"
        onClick={handleFit}
      >
        <Maximize size={18} />
      </button>
      {open && (
        <div
          ref={menu}
          className="studio-reading-presets"
          role="menu"
          aria-label="全屏缩放比例预设"
          onKeyDown={handleMenuKey}
        >
          {presets.map((value) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={Math.abs(zoom * 100 - value) < 0.05}
              key={value}
              onClick={(event) => handlePreset(event, value)}
            >
              {value}%
            </button>
          ))}
        </div>
      )}
      {error && (
        <span id={hintId} className="studio-reading-controls-message" role="alert">
          {error}
        </span>
      )}
      {!error && markerMode && (
        <span className="studio-reading-controls-message" role="status">
          临时荧光笔 · 约 3 秒后淡出
        </span>
      )}
    </div>
  );
}
