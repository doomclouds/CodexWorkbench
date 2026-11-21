import { useRef, useState, type SubmitEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { readableText } from '../../../../../shared/theme.js';
import { FILL_COLORS, INK_COLORS } from '../scene/native-palette.js';

export default function ColorPalette({
  value,
  onChange,
  kind = 'ink',
  theme,
  custom = [],
  onCustomChange,
  none,
  presetOnly = false,
}: {
  value?: string;
  onChange: (value: string, customColors?: string[]) => void;
  kind?: 'fill' | 'ink';
  theme: 'light' | 'dark';
  custom?: string[];
  onCustomChange?: (colors: string[]) => void;
  none?: () => void;
  presetOnly?: boolean;
}) {
  const colors = kind === 'fill' ? FILL_COLORS : INK_COLORS;
  const [draft, setDraft] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const candidate = draft?.trim() ?? '';
  const draftColor = /^#?[0-9a-f]{6}$/i.test(candidate)
    ? `#${candidate.replace(/^#/, '').toUpperCase()}`
    : null;
  const handleClose = () => {
    setDraft(null);
    addButton.current?.focus({ preventScroll: true });
  };

  const apply = () => {
    if (!draftColor) {
      return;
    }

    const nextColors =
      onCustomChange && !custom.some((color) => color.toLowerCase() === draftColor.toLowerCase())
        ? [...custom, draftColor]
        : undefined;
    onChange(draftColor, nextColors);
    handleClose();
  };

  function handleRemoveColor(event: MouseEvent<HTMLButtonElement>, color: string) {
    event.preventDefault();
    onCustomChange?.(custom.filter((item) => item !== color));
  }

  function handleOpenPalette() {
    setDraft(/^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : '#D97757');
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    apply();
  }

  function handleEscape(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }
  }

  return (
    <div
      className="studio-native-colors"
      role="group"
      aria-label={kind === 'fill' ? '填充色板' : '墨色色板'}
    >
      {colors.map((color) => (
        <button
          type="button"
          key={color[0]}
          aria-label={`${kind === 'fill' ? '填充' : '墨色'} ${color[1]}`}
          title={color[1]}
          aria-pressed={value?.toLowerCase() === color[2].toLowerCase()}
          style={{ background: color[theme === 'dark' ? 3 : 2] }}
          onClick={() => onChange(color[2])}
        >
          {value?.toLowerCase() === color[2].toLowerCase() && <Check size={13} />}
        </button>
      ))}
      {custom.map((color) => (
        <button
          type="button"
          key={color}
          style={{ background: color, color: readableText(color) }}
          aria-label={`自定义颜色 ${color}`}
          aria-pressed={value?.toLowerCase() === color.toLowerCase()}
          title={`${color} · 右键移除`}
          onClick={() => onChange(color)}
          onContextMenu={(event) => handleRemoveColor(event, color)}
        >
          {value?.toLowerCase() === color.toLowerCase() && <Check size={13} />}
        </button>
      ))}
      {!presetOnly && (
        <button
          ref={addButton}
          type="button"
          className="studio-custom-color"
          aria-label="添加自定义颜色"
          title="添加自定义颜色"
          aria-expanded={draft !== null}
          onClick={handleOpenPalette}
        >
          <Plus size={15} />
        </button>
      )}
      {none && (
        <button
          type="button"
          className="studio-no-color"
          aria-label="无颜色"
          title="无颜色"
          onClick={none}
        >
          ∅
        </button>
      )}
      {draft !== null && (
        <form
          className="studio-custom-color-editor"
          aria-label="自定义颜色"
          onSubmit={handleSubmit}
          onKeyDown={handleEscape}
        >
          <input
            type="color"
            aria-label="取色器"
            value={draftColor ?? '#D97757'}
            onChange={(event) => setDraft(event.target.value)}
          />
          <input
            type="text"
            aria-label="颜色值"
            placeholder="#RRGGBB"
            autoFocus
            value={draft}
            aria-invalid={!draftColor}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="studio-format-row studio-custom-color-actions">
            <button type="button" onClick={handleClose}>
              取消
            </button>
            <button type="submit" disabled={!draftColor}>
              应用颜色
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
