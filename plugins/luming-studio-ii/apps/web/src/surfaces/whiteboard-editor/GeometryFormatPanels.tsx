import { Check, Plus } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SubmitEvent,
} from 'react';

import { AnchoredPopover } from '../../ui/base/index.js';

const fillColors = [
  ['黄色', '#F9E56F', '#F5D515'],
  ['桃色', '#F9BD85', '#ED953D'],
  ['粉色', '#F7ABC9', '#EE7FAC'],
  ['绿色', '#AEE2AB', '#72D071'],
  ['蓝色', '#9DC8F7', '#6AABF1'],
  ['紫色', '#C6BDFA', '#A89AF0'],
  ['白色', '#EFEFEF', '#EFEFEF'],
] as const;

const inkColors = [
  ['墨色', '#0B0B0B', '#EFEFEF'],
  ['陶土色', '#D97757', '#F0A77F'],
  ['蓝色', '#2F7CC4', '#9CCDE8'],
  ['绿色', '#2E8B57', '#B7DFA4'],
  ['紫色', '#7C5CBF', '#CDB6EC'],
] as const;

type Theme = 'light' | 'dark';
type PaletteKind = 'fill' | 'ink';

interface FormatPopoverProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly style?: CSSProperties;
  readonly disabled?: boolean;
  readonly children: (closePanel: () => void) => ReactNode;
}

export function FormatPopover({ label, icon, style, disabled, children }: FormatPopoverProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  const portal = anchor?.closest<HTMLElement>('.whiteboard-editor');

  function closePanel() {
    setAnchor(null);
    anchor?.focus({ preventScroll: true });
  }

  function focusPanel() {
    const body = panel.current;
    const first = body?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)');
    (first ?? body)?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        type="button"
        className="whiteboard-editor__selection-icon geometry-format-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        style={style}
        onClick={(event) => setAnchor(open ? null : event.currentTarget)}
      >
        {icon}
      </button>
      <AnchoredPopover
        open={open}
        anchor={anchor}
        portalRoot={portal}
        placement="bottom"
        label={label}
        initialFocus={focusPanel}
        onRequestClose={(reason) => {
          if (reason === 'escape') {
            closePanel();
          } else {
            setAnchor(null);
          }
        }}
      >
        <div ref={panel} className="geometry-format-panel" data-canvas-native="" tabIndex={-1}>
          {children(closePanel)}
        </div>
      </AnchoredPopover>
    </>
  );
}

interface FormatPaletteProps {
  readonly kind: PaletteKind;
  readonly value?: string;
  readonly theme?: Theme;
  readonly onSelect: (color: string) => void;
  readonly onClear?: () => void;
  readonly disabled?: boolean;
}

function normalizeHex(value: string) {
  const candidate = value.trim();

  return /^#?[\da-f]{6}$/iu.test(candidate)
    ? '#' + candidate.replace(/^#/, '').toUpperCase()
    : undefined;
}

interface CustomColorProps {
  readonly value?: string;
  readonly onSelect: (color: string) => void;
  readonly onClose: () => void;
  readonly disabled?: boolean;
}

const customColorDefault = '#D97757';

function CustomColor({ value, onSelect, onClose, disabled }: CustomColorProps) {
  const [input, setInput] = useState(normalizeHex(value ?? '') ?? customColorDefault);
  const color = normalizeHex(input);
  const hexInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    hexInput.current?.focus({ preventScroll: true });
    hexInput.current?.select();
  }, []);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (color && !disabled) {
      onSelect(color);
      onClose();
    }
  }

  return (
    <form className="geometry-format-custom-editor" aria-label="自定义颜色" onSubmit={handleSubmit}>
      <input
        type="color"
        aria-label="取色器"
        value={color ?? customColorDefault}
        disabled={disabled}
        onChange={(event) => setInput(event.currentTarget.value)}
      />
      <input
        ref={hexInput}
        type="text"
        aria-label="颜色值"
        value={input}
        placeholder="#RRGGBB"
        aria-invalid={!color}
        disabled={disabled}
        onChange={(event) => setInput(event.currentTarget.value)}
      />
      <div className="geometry-format-row">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="submit" disabled={!color || disabled}>
          应用颜色
        </button>
      </div>
    </form>
  );
}

function displayColor(light: string, dark: string, theme: Theme | undefined) {
  if (theme === 'light') {
    return light;
  }
  if (theme === 'dark') {
    return dark;
  }

  return 'light-dark(' + light + ', ' + dark + ')';
}

export function FormatPalette({
  kind,
  value,
  theme,
  onSelect,
  onClear,
  disabled,
}: FormatPaletteProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const custom = useRef<HTMLButtonElement>(null);
  const palette = kind === 'fill' ? fillColors : inkColors;
  const heading = kind === 'fill' ? '填充' : '墨色';
  const current = value?.toUpperCase();

  function handleCloseCustom() {
    setCustomOpen(false);
    custom.current?.focus({ preventScroll: true });
  }

  return (
    <div className="geometry-format-palette" role="group" aria-label={heading + '色板'}>
      {palette.map(([name, light, dark]) => (
        <button
          key={name}
          type="button"
          aria-label={heading + ' ' + name}
          title={name}
          aria-pressed={current === light}
          disabled={disabled}
          style={{ background: displayColor(light, dark, theme) }}
          onClick={() => onSelect(light)}
        >
          {current === light && <Check size={13} />}
        </button>
      ))}
      <button
        ref={custom}
        type="button"
        aria-label="添加自定义颜色"
        title="添加自定义颜色"
        aria-expanded={customOpen}
        disabled={disabled}
        onClick={() => setCustomOpen(true)}
      >
        <Plus size={15} />
      </button>
      {onClear && (
        <button
          type="button"
          aria-label="无颜色"
          title="无颜色"
          disabled={disabled}
          onClick={onClear}
        >
          ∅
        </button>
      )}
      {customOpen && (
        <CustomColor
          value={value}
          onSelect={onSelect}
          onClose={handleCloseCustom}
          disabled={disabled}
        />
      )}
    </div>
  );
}
