import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent,
  type SubmitEvent,
} from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Crop,
  Maximize,
  Italic,
  Link,
  List,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Unlock,
} from 'lucide-react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import { getBoardSticker } from '../../../../../shared/whiteboard-stickers.js';
import { arrowHeads, type Rect, type Viewport } from '../scene/canvas-model.js';
import { useCanvasFormatToolbarPosition } from './useCanvasFormatToolbarPosition.js';
import type { InlineTextFormatState } from './InlineTextEditor.js';
import ColorPalette from './ColorPalette.js';
import { registerEscapeLayer } from '../../../../shared/escape.js';

interface Props {
  elements: BoardElement[];
  selectionBounds: Rect;
  viewport: Viewport;
  titles?: readonly BoardElement[];
  editingTitle?: string;
  canEdit: boolean;
  canAnnotate: boolean;
  saving: boolean;
  theme: 'light' | 'dark';
  onChange: (changes: Partial<BoardElement>, customColors?: string[]) => void;
  onEditText: () => void;
  onTextFormat: (format: 'bold' | 'italic' | 'list' | 'link' | 'numbered', value?: string) => void;
  onAnnotate: () => void;
  onReadSelection?: () => void;
  onEditHtml?: () => void;
  onCrop?: () => void;
  requestLink?: { key: string; value: string };
  formatState?: InlineTextFormatState;
  customColors?: string[];
  onCustomColorsChange?: (colors: string[]) => void;
  onMore: (point: { x: number; y: number }) => void;
  onAlign: (edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
}

const alignIcons = { left: AlignLeft, center: AlignCenter, right: AlignRight };
const arrowEndpoints = [
  ['none', '无'],
  ['arrow', '箭头'],
  ['circle', '圆点'],
] as const;

function formatRegion(element?: BoardElement) {
  if (
    element?.type === 'html' ||
    (element?.type === 'diagram' && typeof element.html === 'string')
  ) {
    return 'html';
  }
  if (element?.type === 'document' || element?.type === 'todo') {
    return element.type;
  }

  return undefined;
}

const regionNames = { document: '文档', todo: '任务清单', html: 'HTML 图解' };

const textSizes = [
  [14, '小'],
  [16, '正文'],
  [28, '大'],
  [48, '标题'],
  [96, '超大'],
] as const;

function fontOptions(selected?: BoardElement): readonly (readonly [number, string])[] {
  const fontSize = selected?.fontSize;
  if (!fontSize || textSizes.some(([value]) => value === fontSize)) {
    return textSizes;
  }

  return [...textSizes, [fontSize, String(fontSize)]];
}

function selectionFontSize(elements: BoardElement[], selected?: BoardElement) {
  const size = elements[0].fontSize;
  if (elements.some((element) => element.fontSize !== size)) {
    return '';
  }

  return selected?.fontSize ?? size ?? 16;
}

function alignmentIcon(textAlign?: string) {
  if (textAlign === 'center') {
    return AlignCenter;
  }

  return textAlign === 'right' ? AlignRight : AlignLeft;
}

export default function CanvasFormatToolbar({
  elements,
  selectionBounds,
  viewport,
  titles,
  editingTitle,
  canEdit,
  canAnnotate,
  saving,
  theme,
  onChange,
  onTextFormat,
  onAnnotate,
  onReadSelection,
  onEditHtml,
  onCrop,
  onMore,
  onAlign,
  requestLink,
  formatState,
  customColors,
  onCustomColorsChange,
}: Props) {
  const [popover, setPopover] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const popoverId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const toolbar = useCanvasFormatToolbarPosition({
    trigger,
    selectionBounds,
    viewport,
    elements,
    titles,
    editingTitle,
    popover,
    onHidePopover: setPopover,
  });
  const closePopover = (restoreFocus = false) => {
    setPopover(null);
    if (restoreFocus && returnFocus.current?.isConnected) {
      returnFocus.current.focus({ preventScroll: true });
    }
  };

  const rememberTrigger = useCallback(
    (button: HTMLButtonElement) => {
      trigger.current = button;
      const active = document.activeElement;
      if (!toolbar.current?.querySelector('.studio-format-popover')?.contains(active)) {
        returnFocus.current =
          active instanceof HTMLElement &&
          active.matches('input,textarea,[contenteditable]:not([contenteditable="false"])')
            ? active
            : button;
      }
    },
    [toolbar],
  );

  const popoverOpen = popover !== null;
  useEffect(() => {
    if (!popoverOpen) {
      return;
    }

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolbar.current?.contains(event.target)) {
        setPopover(null);
      }
    };

    document.addEventListener('pointerdown', outside, true);
    const unregister = registerEscapeLayer(toolbar.current!, () => closePopover(true));

    return () => {
      document.removeEventListener('pointerdown', outside, true);
      unregister();
    };
  }, [popoverOpen, toolbar]);
  useEffect(() => {
    if (!requestLink || !linkButton.current) {
      return;
    }

    rememberTrigger(linkButton.current);
    linkButton.current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    setLink(requestLink.value);
    setPopover('文字链接');
  }, [requestLink, rememberTrigger]);
  useLayoutEffect(() => {
    if (popover !== '文字链接') {
      return;
    }

    linkInput.current?.focus({ preventScroll: true });
    linkInput.current?.select();
  }, [popover, requestLink?.key]);
  const selected = elements.length === 1 ? elements[0] : undefined;
  const region = formatRegion(selected);
  const regionTitle = selected?.text || regionNames[region ?? 'html'];
  const text = elements.every(
    (element) =>
      ['shape', 'note', 'text', 'container', 'arrow', 'table'].includes(element.type) ||
      (element.type === 'sticker' && !getBoardSticker(element.data?.stickerIconId)),
  );
  const fill = elements.every((element) =>
    ['shape', 'note', 'container', 'table', 'document'].includes(element.type),
  );
  const line = elements.every((element) =>
    ['shape', 'stroke', 'arrow', 'container'].includes(element.type),
  );
  const allLocked = elements.every((element) => element.locked);
  const Align = alignmentIcon(selected?.textAlign);
  const panel = (name: string, content: React.ReactNode) =>
    popover === name && (
      <div id={popoverId} className="studio-format-popover" role="dialog" aria-label={name}>
        {content}
      </div>
    );
  const toggle = (name: string, button: HTMLButtonElement) => {
    if (popover === name) {
      closePopover(true);

      return;
    }

    rememberTrigger(button);
    setPopover(name);
  };

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) {
      event.preventDefault();
    }
  }

  function handleShapeChange(event: ChangeEvent<HTMLSelectElement>) {
    const kind = event.target.value;
    if (kind === 'text') {
      onChange({ type: 'text', fill: 'transparent' });

      return;
    }

    const fill = selected?.fill === 'transparent' ? '#EFEFEF' : selected?.fill;
    onChange({ type: 'shape', kind, fill });
  }

  function handleMore(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onMore({ x: rect.left, y: rect.bottom + 6 });
  }

  function handleFill(fill: string) {
    onChange(region === 'document' ? { fill } : { fill, hollow: false });
  }

  function handleStroke(dash: boolean) {
    const current = selected?.stroke;
    const stroke = current && current !== 'transparent' ? current : '#0B0B0B';
    onChange({ stroke, dash });
  }

  function handleTextAlignment(textAlign: 'left' | 'center' | 'right') {
    onChange({ textAlign });
    closePopover(true);
  }

  function handleObjectAlignment(edge: Parameters<Props['onAlign']>[0]) {
    onAlign(edge);
    closePopover(true);
  }

  function handleLinkSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onTextFormat('link', link);
    closePopover(true);
  }

  function renderAlignmentIcon(value: 'left' | 'center' | 'right') {
    const Icon = alignIcons[value];

    return <Icon size={18} />;
  }

  function renderTextControls() {
    if (!text) {
      return null;
    }

    return (
      <>
        {elements.every((element) => ['shape', 'text'].includes(element.type)) && (
          <select
            aria-label="形状类型"
            disabled={allLocked}
            value={selected?.type === 'text' ? 'text' : (selected?.kind ?? 'rounded')}
            onChange={handleShapeChange}
          >
            {[
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
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="文字大小"
          value={selectionFontSize(elements, selected)}
          disabled={saving}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        >
          <option value="" disabled>
            混合
          </option>
          {fontOptions(selected).map(([size, label]) => (
            <option key={size} value={size}>
              {label} · {size}px
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="加粗"
          title="加粗（Ctrl/⌘ B）"
          aria-pressed={formatState?.bold ?? elements.every((element) => element.bold)}
          onClick={() => onTextFormat('bold')}
          disabled={saving}
        >
          <Bold size={17} />
        </button>
        <button
          type="button"
          aria-label="斜体"
          title="斜体（Ctrl/⌘ I）"
          aria-pressed={formatState?.italic ?? elements.every((element) => element.italic)}
          onClick={() => onTextFormat('italic')}
          disabled={saving}
        >
          <Italic size={17} />
        </button>
        {selected && (
          <>
            <button
              ref={linkButton}
              type="button"
              aria-label="文字链接"
              title="文字链接"
              aria-haspopup="dialog"
              aria-expanded={popover === '文字链接'}
              aria-controls={popover === '文字链接' ? popoverId : undefined}
              onClick={(event) => toggle('文字链接', event.currentTarget)}
            >
              <Link size={17} />
            </button>
            <button
              type="button"
              aria-label="切换列表"
              title="无序列表"
              onClick={() => onTextFormat('list')}
            >
              <List size={17} />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="文字对齐"
          title="文字对齐"
          aria-haspopup="dialog"
          aria-expanded={popover === '文字对齐'}
          aria-controls={popover === '文字对齐' ? popoverId : undefined}
          onClick={(event) => toggle('文字对齐', event.currentTarget)}
        >
          <Align size={17} />
        </button>
        <button
          type="button"
          aria-label="文字颜色"
          title="文字颜色"
          aria-haspopup="dialog"
          aria-expanded={popover === '文字颜色'}
          aria-controls={popover === '文字颜色' ? popoverId : undefined}
          onClick={(event) => toggle('文字颜色', event.currentTarget)}
        >
          A
        </button>
      </>
    );
  }

  function renderArrowEndpoints() {
    if (selected?.type !== 'arrow') {
      return null;
    }

    return (
      <>
        <select
          className="studio-arrow-endpoint-select"
          aria-label="连接线起点"
          value={arrowHeads(selected)[0]}
          onChange={(event) =>
            onChange({
              heads: [event.target.value as 'none' | 'arrow' | 'circle', arrowHeads(selected)[1]],
            })
          }
        >
          {arrowEndpoints.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="studio-arrow-endpoint-select"
          aria-label="连接线终点"
          value={arrowHeads(selected)[1]}
          onChange={(event) =>
            onChange({
              heads: [arrowHeads(selected)[0], event.target.value as 'none' | 'arrow' | 'circle'],
            })
          }
        >
          {arrowEndpoints.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </>
    );
  }

  function renderObjectControls() {
    if (region) {
      return (
        <>
          <span className="studio-selection-label" title={regionTitle}>
            {regionTitle}
          </span>
          {region === 'html' && canEdit && onEditHtml && (
            <button
              type="button"
              aria-label="编辑 HTML 源码"
              title="编辑 HTML 源码"
              onClick={onEditHtml}
            >
              <Braces size={18} />
            </button>
          )}
        </>
      );
    }
    if (!canEdit) {
      return null;
    }

    return (
      <>
        {renderTextControls()}
        {line && (
          <button
            type="button"
            aria-label="边框与线条"
            title="边框与线条"
            aria-haspopup="dialog"
            aria-expanded={popover === '边框与线条'}
            aria-controls={popover === '边框与线条' ? popoverId : undefined}
            onClick={(event) => toggle('边框与线条', event.currentTarget)}
          >
            ☰
          </button>
        )}
        {renderArrowEndpoints()}
        {selected?.type === 'image' && onCrop && (
          <button
            type="button"
            aria-label="裁剪图片"
            title="裁剪图片"
            disabled={allLocked}
            onClick={onCrop}
          >
            <Crop size={17} />
          </button>
        )}
        {elements.length > 1 && (
          <button
            type="button"
            aria-label="对齐对象"
            title="对齐对象"
            disabled={allLocked}
            aria-haspopup="dialog"
            aria-expanded={popover === '对齐对象'}
            aria-controls={popover === '对齐对象' ? popoverId : undefined}
            onClick={(event) => toggle('对齐对象', event.currentTarget)}
          >
            <AlignCenter size={17} />
          </button>
        )}
      </>
    );
  }

  function renderPopovers() {
    return (
      <>
        {panel(
          '文字颜色',
          <ColorPalette
            theme={theme}
            value={selected?.color}
            onChange={(color, colors) => onChange({ color }, colors)}
            custom={customColors}
            onCustomChange={onCustomColorsChange}
          />,
        )}
        {panel(
          '填充颜色',
          <ColorPalette
            theme={theme}
            kind="fill"
            value={selected?.fill}
            onChange={handleFill}
            none={
              elements.every((element) => element.type === 'shape')
                ? () => onChange({ hollow: true })
                : undefined
            }
          />,
        )}
        {panel(
          '边框与线条',
          <>
            <div className="studio-format-row">
              <button
                type="button"
                aria-pressed={elements.every((element) => element.stroke === 'transparent')}
                onClick={() => onChange({ stroke: 'transparent', dash: false })}
              >
                无边框
              </button>
              <button
                type="button"
                aria-pressed={elements.every(
                  (element) => element.stroke !== 'transparent' && !element.dash,
                )}
                onClick={() => handleStroke(false)}
              >
                实线
              </button>
              <button
                type="button"
                aria-pressed={elements.every(
                  (element) => element.stroke !== 'transparent' && element.dash === true,
                )}
                onClick={() => handleStroke(true)}
              >
                虚线
              </button>
            </div>
            <ColorPalette
              theme={theme}
              value={selected?.stroke}
              onChange={(stroke, colors) => onChange({ stroke }, colors)}
              custom={customColors}
              onCustomChange={onCustomColorsChange}
            />
            <label>
              线宽
              <input
                aria-label="线条宽度"
                type="number"
                min="0.5"
                max="40"
                step="0.5"
                value={selected?.strokeWidth ?? (selected?.type === 'container' ? 1 : 3)}
                onChange={(event) => onChange({ strokeWidth: Number(event.target.value) })}
              />
            </label>
          </>,
        )}
        {panel(
          '文字对齐',
          <div className="studio-format-row">
            {(['left', 'center', 'right'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`文字${value}`}
                onClick={() => handleTextAlignment(value)}
              >
                {renderAlignmentIcon(value)}
              </button>
            ))}
          </div>,
        )}
        {panel(
          '对齐对象',
          <div className="studio-format-row">
            {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((value) => (
              <button type="button" key={value} onClick={() => handleObjectAlignment(value)}>
                {
                  {
                    left: '左对齐',
                    hcenter: '水平居中',
                    right: '右对齐',
                    top: '顶部对齐',
                    vcenter: '垂直居中',
                    bottom: '底部对齐',
                  }[value]
                }
              </button>
            ))}
          </div>,
        )}
        {panel(
          '文字链接',
          <form onSubmit={handleLinkSubmit}>
            <input
              ref={linkInput}
              aria-label="文字链接地址"
              type="url"
              placeholder="https://"
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
            <button type="submit">应用</button>
          </form>,
        )}
      </>
    );
  }

  return (
    <div
      ref={toolbar}
      className="studio-selection-toolbar"
      role="toolbar"
      aria-label="选区格式"
      data-native-interactive="true"
      onPointerDown={handlePointerDown}
    >
      <div className="studio-selection-toolbar-scroll">
        {onReadSelection && (
          <button
            type="button"
            aria-label="全屏观看选区"
            title="全屏观看"
            onClick={onReadSelection}
          >
            <Maximize size={18} />
          </button>
        )}
        {renderObjectControls()}
        {canEdit && fill && (
          <button
            type="button"
            aria-label="填充颜色"
            title="填充颜色"
            className="studio-color-chip"
            style={{ background: selected?.fill || '#EFEFEF' }}
            aria-haspopup="dialog"
            aria-expanded={popover === '填充颜色'}
            aria-controls={popover === '填充颜色' ? popoverId : undefined}
            onClick={(event) => toggle('填充颜色', event.currentTarget)}
          />
        )}
        <span className="studio-tool-divider" />
        {canAnnotate && (
          <button type="button" aria-label="备注所选元素" title="备注" onClick={onAnnotate}>
            <MessageSquare size={18} />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className="studio-lock-toggle"
            aria-label={allLocked ? '解锁元素' : '锁定元素'}
            title={allLocked ? '解锁位置与尺寸' : '锁定位置与尺寸（仍可编辑内容）'}
            aria-pressed={allLocked}
            disabled={saving}
            onClick={() => onChange({ locked: !allLocked })}
          >
            {allLocked ? <Unlock size={18} /> : <Lock size={18} />}
          </button>
        )}
        <button type="button" aria-label="更多操作" title="更多操作" onClick={handleMore}>
          <MoreHorizontal size={19} />
        </button>
      </div>
      {renderPopovers()}
    </div>
  );
}
