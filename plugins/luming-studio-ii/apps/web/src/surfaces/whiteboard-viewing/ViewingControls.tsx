import { ChevronDown, Hand, Highlighter, Maximize, Minus, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';

import { AnchoredPopover } from '../../ui/base/index.js';

interface ViewingControlsProps {
  readonly zoom: number;
  readonly marker: boolean;
  readonly onMarker: (enabled: boolean) => void;
  readonly onClear: () => void;
  readonly onFit: () => void;
  readonly onZoom: (zoom: number) => void;
  readonly onCanvasFocus: () => void;
  readonly onInteract: () => void;
}

const minPercent = 5;
const maxPercent = 800;
const zoomStep = 1.2;
const presets = [25, 50, 75, 100, 150, 200];
const presetNavigationKeys = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

function percent(zoom: number) {
  return String(Math.round(zoom * 1000) / 10);
}

function nextPreset(key: string, current: number, count: number) {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }

  return (current + (key === 'ArrowDown' ? 1 : -1) + count) % count;
}

function handlePresetKey(event: KeyboardEvent<HTMLDivElement>) {
  if (!presetNavigationKeys.has(event.key)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const items = [...event.currentTarget.querySelectorAll('button')];
  const current = items.findIndex(
    (item) => item === event.currentTarget.ownerDocument.activeElement,
  );
  items[nextPreset(event.key, current, items.length)]?.focus({ preventScroll: true });
}

export function ViewingControls({
  zoom,
  marker,
  onMarker,
  onClear,
  onFit,
  onZoom,
  onCanvasFocus,
  onInteract,
}: ViewingControlsProps) {
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const skipBlur = useRef(false);
  const hintId = useId();

  function refocus(event: MouseEvent<HTMLButtonElement>, callback: () => void) {
    callback();
    if (event.detail > 0) {
      onCanvasFocus();
    }
  }

  function applyZoom(value: number) {
    setInvalid(false);
    setDraft(undefined);
    onZoom(value);
  }

  function commitPercent() {
    if (draft === undefined) {
      return true;
    }

    const raw = draft.trim().replace(/%$/, '');
    const value = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (value >= minPercent && value <= maxPercent) {
      applyZoom(value / 100);

      return true;
    }

    setInvalid(true);

    return false;
  }

  function finishField(input: HTMLInputElement) {
    skipBlur.current = true;
    input.blur();
    onCanvasFocus();
  }

  function handleInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDraft(undefined);
      setInvalid(false);
      finishField(event.currentTarget);

      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (commitPercent()) {
        finishField(event.currentTarget);
      }
    }
  }

  function handleInputFocus(event: FocusEvent<HTMLInputElement>) {
    setPresetsOpen(false);
    skipBlur.current = false;
    event.currentTarget.select();
  }

  function handleInputBlur() {
    if (skipBlur.current) {
      skipBlur.current = false;

      return;
    }

    commitPercent();
  }

  function focusPresetMenu() {
    const first = menu.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]');
    (first ?? menu.current?.querySelector('button'))?.focus({ preventScroll: true });
  }

  function choosePreset(event: MouseEvent<HTMLButtonElement>, value: number) {
    applyZoom(value / 100);
    setPresetsOpen(false);
    if (event.detail > 0) {
      onCanvasFocus();

      return;
    }

    anchor?.focus({ preventScroll: true });
  }

  function closePresets(useAnchor: boolean) {
    setPresetsOpen(false);
    if (useAnchor) {
      anchor?.focus({ preventScroll: true });
    }
  }

  return (
    <div
      className="whiteboard-viewing__toolbar"
      role="toolbar"
      aria-label="全屏观看工具"
      data-whiteboard-viewing-chrome
      onPointerDownCapture={onInteract}
      onFocusCapture={onInteract}
    >
      <button
        type="button"
        aria-label="浏览内容"
        title="浏览内容：可操作按钮、选字和滚动"
        aria-pressed={!marker}
        onClick={(event) => refocus(event, () => onMarker(false))}
      >
        <Hand size={18} />
      </button>
      <button
        type="button"
        aria-label="临时荧光笔"
        title="临时荧光笔：圈画后约 3 秒淡出，仅本次观看"
        aria-pressed={marker}
        onClick={(event) => refocus(event, () => onMarker(!marker))}
      >
        <Highlighter size={18} />
      </button>
      <button
        type="button"
        className="whiteboard-viewing__clear-ink"
        aria-label="清除临时笔迹"
        title="清除本次观看的临时笔迹"
        onClick={(event) => refocus(event, onClear)}
      >
        <Trash2 size={17} />
      </button>
      <span className="whiteboard-viewing__divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="全屏缩小"
        title="缩小"
        disabled={zoom <= minPercent / 100}
        onClick={(event) =>
          refocus(event, () => applyZoom(Math.max(minPercent / 100, zoom / zoomStep)))
        }
      >
        <Minus size={17} />
      </button>
      <div className="whiteboard-viewing__percent" data-invalid={invalid || undefined}>
        <input
          aria-label="全屏缩放比例"
          aria-invalid={invalid}
          aria-describedby={invalid ? hintId : undefined}
          inputMode="decimal"
          value={draft ?? percent(zoom)}
          onFocus={handleInputFocus}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setInvalid(false);
          }}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKey}
        />
        <span aria-hidden="true">%</span>
      </div>
      <button
        ref={setAnchor}
        type="button"
        className="whiteboard-viewing__preset-toggle"
        aria-label="常用全屏比例"
        title="选择常用比例"
        aria-haspopup="menu"
        aria-expanded={presetsOpen}
        onClick={() => setPresetsOpen((previous) => !previous)}
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        aria-label="全屏放大"
        title="放大"
        disabled={zoom >= maxPercent / 100}
        onClick={(event) =>
          refocus(event, () => applyZoom(Math.min(maxPercent / 100, zoom * zoomStep)))
        }
      >
        <Plus size={17} />
      </button>
      <button
        type="button"
        aria-label="适应全屏内容"
        title="适应正在观看的内容"
        onClick={(event) => refocus(event, onFit)}
      >
        <Maximize size={18} />
      </button>
      <AnchoredPopover
        anchor={anchor}
        open={presetsOpen}
        placement="top"
        initialFocus={focusPresetMenu}
        onRequestClose={(reason) => closePresets(reason === 'escape')}
      >
        <div
          ref={menu}
          className="whiteboard-viewing__presets"
          role="menu"
          aria-label="全屏缩放比例预设"
          onKeyDown={handlePresetKey}
        >
          {presets.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={Math.abs(zoom * 100 - value) < 0.05}
              onClick={(event) => choosePreset(event, value)}
            >
              {value}%
            </button>
          ))}
        </div>
      </AnchoredPopover>
      {invalid && (
        <span role="alert" id={hintId} className="whiteboard-viewing__message">
          请输入 5%–800% 的比例。
        </span>
      )}
      {!invalid && marker && (
        <span role="status" className="whiteboard-viewing__message">
          临时荧光笔 · 约 3 秒后淡出
        </span>
      )}
    </div>
  );
}
