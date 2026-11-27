import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Crop,
  Italic,
  Link,
  List,
} from 'lucide-react';
import {
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type { WhiteboardArrangePreset, WhiteboardStylePatch } from '../../data/whiteboard/index.js';
import type {
  CanvasInlineFormat,
  CanvasObject,
  CanvasObjectKind,
} from '../../ui/domain/canvas/index.js';
import { FormatPalette, FormatPopover } from './GeometryFormatPanels.js';
import type { GeometrySelectionAction } from './geometry-commands.js';
import './geometry-format.css';

export interface SelectionTextStyle {
  readonly textColor?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly textAlign?: WhiteboardStylePatch['textAlign'];
  readonly bold?: boolean;
  readonly italic?: boolean;
}

interface SelectionObjectControlsProps {
  readonly selection: readonly CanvasObject[];
  readonly canEdit: boolean;
  readonly disabled?: boolean;
  readonly theme?: 'light' | 'dark';
  readonly textStyleById?: ReadonlyMap<string, SelectionTextStyle>;
  readonly customColors?: readonly string[];
  readonly onEditObject?: (id: string) => void;
  readonly selectedHtmlId?: string;
  readonly onFormatObject?: (id: string, format: CanvasInlineFormat) => void;
  readonly onAction: (action: GeometrySelectionAction, ids: readonly string[]) => void;
}

interface FormatSelection {
  readonly selection: readonly CanvasObject[];
  readonly selected?: CanvasObject;
  readonly disabled: boolean;
  readonly theme?: 'light' | 'dark';
  readonly onStyle: (patch: WhiteboardStylePatch, rememberColor?: string) => void;
  readonly inks: { readonly colors: readonly string[]; readonly remove: (color: string) => void };
}

interface TextControlsProps extends FormatSelection {
  readonly textStyleById?: SelectionObjectControlsProps['textStyleById'];
  readonly inlineControls?: ReactNode;
}

const textKinds = new Set<CanvasObjectKind>(['shape', 'text', 'note', 'section', 'connector']);
const fillKinds = new Set<CanvasObjectKind>(['shape', 'note', 'section', 'table', 'document']);
const borderKinds = new Set<CanvasObjectKind>(['shape', 'ink', 'connector', 'section']);
const formKinds = new Set<CanvasObjectKind>(['shape', 'text']);
const regionNames = new Map([
  ['html', 'HTML 图解'],
  ['diagram', '图解'],
  ['chart', '图表'],
  ['document', '文档'],
  ['todo', '任务清单'],
]);
const connectorHeads = [
  { value: 'none', label: '无' },
  { value: 'arrow', label: '箭头' },
  { value: 'circle', label: '圆点' },
] as const;
const shapes = [
  ['text', '文字'],
  ['rounded', '圆角矩形'],
  ['rect', '矩形'],
  ['ellipse', '椭圆'],
  ['diamond', '菱形'],
  ['pill', '胶囊'],
  ['hexagon', '六边形'],
  ['parallelogram', '平行四边形'],
  ['database', '数据库'],
  ['queue', '队列'],
  ['document', '文档'],
  ['cloud', '云'],
  ['person', '人物'],
] as const;

const fontSizes = [
  [14, '小'],
  [16, '正文'],
  [28, '大'],
  [48, '标题'],
  [96, '超大'],
] as const;
const inlineOptions = [
  { action: 'link', label: '文字链接', title: '文字链接', Icon: Link },
  { action: 'bullets', label: '切换列表', title: '无序列表', Icon: List },
] as const;
const cellOptions = [
  { action: 'bold', label: '加粗', title: '加粗（Ctrl/⌘ B）', Icon: Bold },
  { action: 'italic', label: '斜体', title: '斜体（Ctrl/⌘ I）', Icon: Italic },
  ...inlineOptions,
] as const;
const alignments = [
  ['left', '左对齐', AlignLeft],
  ['center', '居中', AlignCenter],
  ['right', '右对齐', AlignRight],
] as const;
const arrangeOptions = [
  ['left', '左对齐'],
  ['hcenter', '水平居中'],
  ['right', '右对齐'],
  ['top', '顶部对齐'],
  ['vcenter', '垂直居中'],
  ['bottom', '底部对齐'],
] as const satisfies readonly (readonly [WhiteboardArrangePreset, string])[];
const borderOptions = [
  ['none', '无边框'],
  ['solid', '实线'],
  ['dashed', '虚线'],
] as const;

type StrokeKind = (typeof borderOptions)[number][0];

const defaultFontSize = 16;
const defaultFill = '#EFEFEF';
const defaultStroke = '#0B0B0B';
const minStrokeWidth = 0.5;
const maxStrokeWidth = 40;

function transparent(value: string | undefined) {
  return /^(?:transparent|#[\da-f]{3}0|#[\da-f]{6}00)$/iu.test(value ?? '');
}

function storedColor(value: string | undefined) {
  const color = value ?? '';
  const paletteColor = /^light-dark\(\s*(#[\da-f]{6})\s*,/iu.exec(color)?.[1];
  if (paletteColor) {
    return paletteColor;
  }

  return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu.test(color) ? color : undefined;
}

function outline(object: CanvasObject) {
  if (object.kind === 'shape') {
    return object.shape ?? 'rounded';
  }

  return 'text';
}

function sharedValue<Value>(values: readonly Value[]) {
  const first = values[0];

  return values.every((value) => value === first) ? first : undefined;
}

function fillChip(object: CanvasObject | undefined) {
  if (object?.hollow || transparent(object?.fill)) {
    return 'transparent';
  }

  return object?.fill ?? defaultFill;
}

function FormControl({ selection, selected, disabled, onStyle }: FormatSelection) {
  const shape = sharedValue(selection.map(outline));

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = shapes.find(([key]) => key === event.currentTarget.value)?.[0];
    if (!next) {
      return;
    }

    if (next === 'text') {
      onStyle({ shapeForm: next, fill: 'transparent' });
      return;
    }

    const restoreFill = selected?.kind === 'text' || transparent(selected?.fill);
    onStyle({ shapeForm: next, fill: restoreFill ? defaultFill : undefined });
  }

  return (
    <select
      className="geometry-format-select geometry-format-shape"
      aria-label="形状类型"
      value={shape ?? ''}
      disabled={disabled}
      onChange={handleChange}
    >
      <option value="" disabled>
        混合
      </option>
      {shapes.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

function TextControls({
  selection,
  textStyleById,
  disabled,
  onStyle,
  theme,
  inks,
  inlineControls,
}: TextControlsProps) {
  const styles = selection.map(({ id }) => textStyleById?.get(id));
  const fontSize = sharedValue(styles.map((style) => style?.fontSize ?? defaultFontSize));
  const alignment = sharedValue(styles.map((style) => style?.textAlign ?? 'left'));
  const color = sharedValue(styles.map((style) => style?.textColor));
  const bold = styles.every((style) => style?.bold === true);
  const italic = styles.every((style) => style?.italic === true);
  const Icon = alignments.find(([kind]) => kind === alignment)?.[2] ?? AlignLeft;
  const hasCustomSize = fontSize !== undefined && !fontSizes.some(([size]) => size === fontSize);

  return (
    <>
      <select
        className="geometry-format-select geometry-format-font-size"
        aria-label="文字大小"
        value={fontSize ?? ''}
        disabled={disabled}
        onChange={(event) => onStyle({ fontSize: Number(event.currentTarget.value) })}
      >
        <option value="" disabled>
          混合
        </option>
        {fontSizes.map(([size, name]) => (
          <option key={size} value={size}>
            {name} · {size}px
          </option>
        ))}
        {hasCustomSize && <option value={fontSize}>{fontSize}px</option>}
      </select>
      <button
        type="button"
        className="whiteboard-editor__selection-icon geometry-format-trigger"
        aria-label="加粗"
        title="加粗（Ctrl/⌘ B）"
        aria-pressed={bold}
        disabled={disabled}
        onClick={() => onStyle({ bold: !bold })}
      >
        <Bold size={17} />
      </button>
      <button
        type="button"
        className="whiteboard-editor__selection-icon geometry-format-trigger"
        aria-label="斜体"
        title="斜体（Ctrl/⌘ I）"
        aria-pressed={italic}
        disabled={disabled}
        onClick={() => onStyle({ italic: !italic })}
      >
        <Italic size={17} />
      </button>
      {inlineControls}
      <FormatPopover label="文字对齐" icon={<Icon size={17} />} disabled={disabled}>
        {(close) => (
          <div className="geometry-format-row">
            {alignments.map(([value, label, Align]) => (
              <button
                type="button"
                key={value}
                aria-label={'文字' + value}
                title={label}
                aria-pressed={alignment === value}
                disabled={disabled}
                onClick={() => {
                  onStyle({ textAlign: value });
                  close();
                }}
              >
                <Align size={18} />
              </button>
            ))}
          </div>
        )}
      </FormatPopover>
      <FormatPopover label="文字颜色" icon="A" disabled={disabled}>
        {() => (
          <FormatPalette
            kind="ink"
            value={color}
            theme={theme}
            shared={inks}
            onSelect={(textColor, rememberColor) => onStyle({ textColor }, rememberColor)}
            disabled={disabled}
          />
        )}
      </FormatPopover>
    </>
  );
}

function handlePreserveEditorSelection(event: PointerEvent<HTMLButtonElement>) {
  if (event.button === 0) {
    event.preventDefault();
  }
}

function InlineFormatButtons({
  selected,
  disabled,
  onFormatObject,
}: {
  readonly selected?: CanvasObject;
  readonly disabled: boolean;
  readonly onFormatObject?: SelectionObjectControlsProps['onFormatObject'];
}) {
  if (!selected || !onFormatObject) {
    return null;
  }

  const { id, kind } = selected;
  const supportsInline = textKinds.has(kind);
  if (kind !== 'table' && !supportsInline) {
    return null;
  }

  const options = kind === 'table' ? cellOptions : inlineOptions;

  return options.map(({ action, label, title, Icon }) => (
    <button
      key={action}
      type="button"
      className="whiteboard-editor__selection-icon geometry-format-trigger"
      aria-label={label}
      title={title}
      disabled={disabled}
      onPointerDown={handlePreserveEditorSelection}
      onClick={() => onFormatObject(id, action)}
    >
      <Icon size={17} />
    </button>
  ));
}

function strokeOf(object: CanvasObject): string {
  return object.stroke ?? (object.kind === 'shape' ? 'transparent' : defaultStroke);
}

function strokeKind(object: CanvasObject): StrokeKind {
  if (transparent(strokeOf(object))) {
    return 'none';
  }

  return object.dashed ? 'dashed' : 'solid';
}

function defaultStrokeWidth(object: CanvasObject | undefined) {
  if (object?.kind === 'ink') {
    return object.ink.width;
  }

  return object?.kind === 'section' ? 1 : 3;
}

function StrokeWidth({
  value,
  disabled,
  onCommit,
}: {
  readonly value: number;
  readonly disabled: boolean;
  readonly onCommit: (width: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function handleCommit(event: FocusEvent<HTMLInputElement>) {
    const next = event.currentTarget.valueAsNumber;
    const valid = Number.isFinite(next) && next >= minStrokeWidth && next <= maxStrokeWidth;
    if (!disabled && valid && next !== value) {
      onCommit(next);
    } else {
      setDraft(String(value));
    }
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <label className="geometry-format-width">
      线宽
      <input
        type="number"
        aria-label="线条宽度"
        min={minStrokeWidth}
        max={maxStrokeWidth}
        step={0.5}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={handleCommit}
        onKeyDown={handleKey}
      />
    </label>
  );
}

function BorderControl({ selection, selected, disabled, theme, inks, onStyle }: FormatSelection) {
  const kind = sharedValue(selection.map(strokeKind));
  const stroke = sharedValue(selection.map(strokeOf));
  const width = selected?.strokeWidth ?? defaultStrokeWidth(selected);

  function changeStroke(next: StrokeKind) {
    if (next === 'none') {
      onStyle({ stroke: 'transparent', dashed: false });
      return;
    }

    const color = stroke && !transparent(stroke) ? storedColor(stroke) : defaultStroke;
    onStyle({ stroke: color, dashed: next === 'dashed' });
  }

  return (
    <FormatPopover label="边框与线条" icon="☰" disabled={disabled}>
      {() => (
        <>
          <div className="geometry-format-row">
            {borderOptions.map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={kind === value}
                disabled={disabled}
                onClick={() => changeStroke(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <FormatPalette
            kind="ink"
            theme={theme}
            value={storedColor(stroke)}
            shared={inks}
            disabled={disabled}
            onSelect={(stroke, rememberColor) => onStyle({ stroke }, rememberColor)}
          />
          <StrokeWidth
            key={width}
            value={width}
            disabled={disabled}
            onCommit={(strokeWidth) => onStyle({ strokeWidth })}
          />
        </>
      )}
    </FormatPopover>
  );
}

function FillControl({ selection, selected, theme, disabled, onStyle }: FormatSelection) {
  const canHollow = selection.every(({ kind }) => kind === 'shape');
  const documentsOnly = selection.every(({ kind }) => kind === 'document');

  return (
    <FormatPopover
      label="填充颜色"
      icon={null}
      style={{ backgroundColor: fillChip(selected) }}
      disabled={disabled}
    >
      {() => (
        <FormatPalette
          kind="fill"
          value={storedColor(selected?.fill)}
          theme={theme}
          disabled={disabled}
          onSelect={(fill) => onStyle(documentsOnly ? { fill } : { fill, hollow: false })}
          onClear={canHollow ? () => onStyle({ hollow: true }) : undefined}
        />
      )}
    </FormatPopover>
  );
}

function ArrangeControl({
  onAction,
  targetIds,
  disabled,
}: {
  readonly onAction: SelectionObjectControlsProps['onAction'];
  readonly targetIds: readonly string[];
  readonly disabled: boolean;
}) {
  return (
    <FormatPopover label="对齐对象" icon={<AlignCenter size={17} />} disabled={disabled}>
      {(close) => (
        <div className="geometry-format-row">
          {arrangeOptions.map(([preset, label]) => (
            <button
              type="button"
              key={preset}
              disabled={disabled}
              onClick={() => {
                onAction({ kind: 'arrange', preset }, targetIds);
                close();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </FormatPopover>
  );
}

function ConnectorControls({
  object,
  disabled,
  onAction,
}: {
  readonly object: Extract<CanvasObject, { kind: 'connector' }>;
  readonly disabled: boolean;
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
            disabled={disabled || object.locked}
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

function ObjectControls({
  selected,
  canEdit,
  disabled,
  onEditObject,
  selectedHtmlId,
  onAction,
}: Omit<SelectionObjectControlsProps, 'selection'> & { readonly selected?: CanvasObject }) {
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
        {id === selectedHtmlId && canEdit && onEditObject && (
          <button
            type="button"
            className="whiteboard-editor__selection-icon"
            aria-label="编辑 HTML 源码"
            title="编辑 HTML 源码"
            disabled={disabled}
            onClick={() => onEditObject(id)}
          >
            <Braces size={18} />
          </button>
        )}
      </>
    );
  }
  if (kind === 'connector' && canEdit) {
    return <ConnectorControls object={selected} disabled={Boolean(disabled)} onAction={onAction} />;
  }
  if (kind === 'image' && canEdit && onEditObject) {
    return (
      <button
        type="button"
        className="whiteboard-editor__selection-icon"
        aria-label="裁剪图片"
        title="裁剪图片"
        disabled={locked || disabled}
        onClick={() => onEditObject(id)}
      >
        <Crop size={17} />
      </button>
    );
  }

  return null;
}

export function GeometrySelectionObjectControls({
  selection,
  canEdit,
  disabled = false,
  theme,
  textStyleById,
  customColors,
  onAction,
  onEditObject,
  selectedHtmlId,
  onFormatObject,
}: SelectionObjectControlsProps) {
  const selected = selection.length === 1 ? selection[0] : undefined;
  const objectControls = (
    <ObjectControls
      selected={selected}
      canEdit={canEdit}
      disabled={disabled}
      onAction={onAction}
      onEditObject={onEditObject}
      selectedHtmlId={selectedHtmlId}
    />
  );

  if (!canEdit || !selection.length) {
    return objectControls;
  }

  const ids = selection.map(({ id }) => id);
  const movable = selection.filter(({ locked }) => !locked).map(({ id }) => id);
  const format = {
    selection,
    selected,
    disabled,
    theme,
    inks: {
      colors: customColors ?? [],
      remove: (color: string) => onAction({ kind: 'removeCustomColor', color }, []),
    },
    onStyle: (patch: WhiteboardStylePatch, rememberColor?: string) =>
      onAction({ kind: 'style', patch, ...(rememberColor ? { rememberColor } : {}) }, ids),
  };
  const supportsForm = selection.every(({ kind }) => formKinds.has(kind));
  const supportsText = selection.every(({ kind }) => textKinds.has(kind));
  const supportsBorder = selection.every(({ kind }) => borderKinds.has(kind));
  const supportsFill = selection.every(({ kind }) => fillKinds.has(kind));
  const inlineControls = (
    <InlineFormatButtons selected={selected} disabled={disabled} onFormatObject={onFormatObject} />
  );

  return (
    <>
      {supportsForm && (
        <FormControl
          {...format}
          disabled={disabled || movable.length === 0}
          onStyle={(patch) => onAction({ kind: 'style', patch }, movable)}
        />
      )}
      {supportsText ? (
        <TextControls {...format} textStyleById={textStyleById} inlineControls={inlineControls} />
      ) : (
        inlineControls
      )}
      {supportsBorder && <BorderControl {...format} />}
      {objectControls}
      {selection.length > 1 && (
        <ArrangeControl
          onAction={onAction}
          targetIds={movable}
          disabled={disabled || movable.length < 2}
        />
      )}
      {supportsFill && <FillControl {...format} />}
    </>
  );
}
