import {
  ArrowUpRight,
  Braces,
  ChevronDown,
  FileText,
  Frame,
  Hand,
  Link,
  ListTodo,
  MousePointer2,
  PenLine,
  Smile,
  StickyNote,
  Table2,
  Type,
} from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover, type AnchoredPopoverCloseReason } from '../../ui/base/index.js';
import {
  CanvasShapeOutline,
  type CanvasPlacement,
  type CanvasPlacementTool,
  type CanvasShape,
  type CanvasTool,
} from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import { StickerPalette, stickerCatalog } from '../../ui/domain/objects/sticker/index.js';
import { GeometryDrawChoices, type DrawTool } from './GeometryDrawChoices.js';
import './geometry-controls.css';

export interface GeometryToolbarProps {
  readonly tool: CanvasTool;
  readonly onToolChange: (tool: CanvasTool) => void;
  readonly canEditGeometry?: boolean;
  readonly onCanvasFocus?: () => void;
  readonly mediaAction?: (onChoose: () => void) => ReactNode;
  readonly penColor?: string;
  readonly onPenColorChange?: (color: string) => void;
  readonly singleKeys?: boolean;
  readonly onAddHtml?: () => void;
  readonly onAddLink?: () => void;
}

type PaletteKind = 'draw' | 'shape' | 'sticker';
type InsertPalette = Exclude<PaletteKind, 'draw'>;
type InsertKind = 'table' | 'document' | 'todo';
type ShapeTool = CanvasShape | 'table';
type PlacementKind = 'text' | 'section' | 'note' | 'shape' | 'sticker' | InsertKind;

const directTools = [
  { id: 'select', label: '选择', key: '1', Icon: MousePointer2 },
  { id: 'pan', label: '平移', key: '2', Icon: Hand },
] as const;
const simplePlacements = [
  { kind: 'text', label: '文字', key: '3', Icon: Type },
  { kind: 'section', label: '分区', key: '4', Icon: Frame },
  { kind: 'note', label: '便签', key: '5', Icon: StickyNote },
] as const;
const palettes = [
  { kind: 'draw', label: '画笔', key: '6', caret: true },
  { kind: 'shape', label: '形状', key: '7', caret: true },
  { kind: 'sticker', label: '贴纸', key: '8', caret: false },
] as const;
const shapes = [
  { id: 'rounded', label: '圆角矩形' },
  { id: 'rect', label: '矩形' },
  { id: 'ellipse', label: '椭圆' },
  { id: 'diamond', label: '菱形' },
  { id: 'pill', label: '胶囊' },
  { id: 'hexagon', label: '六边形' },
  { id: 'parallelogram', label: '平行四边形' },
  { id: 'database', label: '数据库' },
  { id: 'queue', label: '队列' },
  { id: 'document', label: '文档' },
  { id: 'cloud', label: '云' },
  { id: 'person', label: '人物' },
] satisfies readonly { id: CanvasShape; label: string }[];
const placementExtensions = new Map(
  studioObjectExtensions.map(({ kind, placement }) => [kind, placement]),
);
const firstSticker = stickerCatalog.find(({ id }) => id === 'smile')?.id ?? stickerCatalog[0]?.id;
const unavailable = '当前白板服务暂未提供此操作';

function simplePlacement(kind: PlacementKind): CanvasPlacement | undefined {
  return placementExtensions.get(kind);
}

function shapePlacement(shape: ShapeTool): CanvasPlacement | undefined {
  if (shape === 'table') {
    return simplePlacement('table');
  }

  const outline = simplePlacement('shape');

  return outline ? { ...outline, kind: 'shape', shape } : undefined;
}

function stickerPlacement(id?: string): CanvasPlacement | undefined {
  const sticker = simplePlacement('sticker');

  return sticker && id ? { ...sticker, metadata: { stickerId: id } } : undefined;
}

function toolMatchesPalette(tool: CanvasTool, kind: PaletteKind) {
  if (kind === 'draw') {
    return tool === 'pen' || tool === 'connector';
  }
  if (typeof tool === 'string') {
    return false;
  }

  const placement = tool.object.kind;
  return placement === kind || (kind === 'shape' && placement === 'table');
}

function visiblePalette(tool: CanvasTool, palette: InsertPalette | undefined, canEdit: boolean) {
  if (!canEdit) {
    return undefined;
  }
  if (toolMatchesPalette(tool, 'draw')) {
    return 'draw';
  }

  return palette && toolMatchesPalette(tool, palette) ? palette : undefined;
}

function pickerGlyph(kind: PaletteKind, shape: ShapeTool, drawTool: DrawTool) {
  switch (kind) {
    case 'draw':
      return drawTool === 'connector' ? <ArrowUpRight size={20} /> : <PenLine size={20} />;
    case 'shape':
      return shape === 'table' ? (
        <Table2 size={20} />
      ) : (
        <span className="whiteboard-editor__tool-shape-glyph">
          <CanvasShapeOutline shape={shape} width={24} height={20} stroke="currentColor" hollow />
        </span>
      );
    case 'sticker':
      return <Smile size={20} />;
  }
}

function acceptsToolShortcut(event: KeyboardEvent, toolbar: HTMLElement | null) {
  const { target, altKey, ctrlKey, metaKey, shiftKey, isComposing, repeat, defaultPrevented } =
    event;
  const modified = altKey || ctrlKey || metaKey;
  const consumed = defaultPrevented || repeat || isComposing;
  if (modified || shiftKey || consumed) {
    return false;
  }
  if (!toolbar) {
    return false;
  }

  return (
    target instanceof Element &&
    !toolbar.closest('[hidden], [inert]') &&
    !target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]',
    ) &&
    (toolbar.contains(target) || target.closest('[data-canvas-root]') !== null)
  );
}

interface ShapeChoicesProps {
  readonly selectedShape: ShapeTool;
  readonly onShape: (shape: CanvasShape) => void;
  readonly onInsert: (kind: InsertKind) => void;
  readonly onAddHtml?: () => void;
  readonly onAddLink?: () => void;
}

function ShapeChoices({
  selectedShape,
  onShape,
  onInsert,
  onAddHtml,
  onAddLink,
}: ShapeChoicesProps) {
  return (
    <div className="whiteboard-editor__shape-options">
      <div className="whiteboard-editor__shape-grid" role="group" aria-label="形状选项">
        {shapes.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={'形状 ' + label}
            aria-pressed={id === selectedShape}
            onClick={() => onShape(id)}
          >
            <CanvasShapeOutline shape={id} width={64} height={48} stroke="currentColor" hollow />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onInsert('table')}>
        <Table2 size={17} />
        表格
      </button>
      <button
        type="button"
        title={onAddLink ? '添加链接' : unavailable}
        disabled={!onAddLink}
        onClick={onAddLink}
      >
        <Link size={17} />
        链接
      </button>
      <button
        type="button"
        title={onAddHtml ? '导入 HTML 图解' : unavailable}
        disabled={!onAddHtml}
        onClick={onAddHtml}
      >
        <Braces size={17} />
        HTML 图解
      </button>
      <button type="button" aria-label="添加文档区域" onClick={() => onInsert('document')}>
        <FileText size={17} />
        文档区域
      </button>
      <button type="button" aria-label="添加任务清单" onClick={() => onInsert('todo')}>
        <ListTodo size={17} />
        任务清单
      </button>
    </div>
  );
}

function paletteLabel(kind: PaletteKind | undefined) {
  switch (kind) {
    case 'draw':
      return '绘图工具';
    case 'shape':
      return '插入对象';
    case 'sticker':
      return '添加贴纸';
    case undefined:
      return undefined;
  }
}

export function GeometryToolbar({
  tool,
  onToolChange,
  canEditGeometry = false,
  onCanvasFocus,
  mediaAction,
  penColor,
  onPenColorChange,
  singleKeys = true,
  onAddHtml,
  onAddLink,
}: GeometryToolbarProps) {
  const nextPlacement = useRef(0);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [palette, setPalette] = useState<InsertPalette>();
  const [shape, setShape] = useState<ShapeTool>('rounded');
  const [sticker, setSticker] = useState(firstSticker);
  const [drawTool, setDrawTool] = useState<DrawTool>('pen');
  const placement = typeof tool === 'string' ? undefined : tool.object.kind;
  const open = visiblePalette(tool, palette, canEditGeometry);

  function selectTool(next: CanvasTool) {
    onToolChange(next);
    onCanvasFocus?.();
  }

  function nextPlacementTool(object: CanvasPlacement): CanvasPlacementTool {
    nextPlacement.current += 1;
    return { kind: 'place', requestId: 'toolbar-' + nextPlacement.current, object };
  }

  function activatePlacement(object: CanvasPlacement | undefined) {
    if (object) {
      selectTool(nextPlacementTool(object));
    }
  }

  function closePalette() {
    setPalette(undefined);
  }

  function cancelPalette() {
    closePalette();
    selectTool('select');
  }

  function closeMediaPalette() {
    closePalette();
    onToolChange('select');
  }

  function handleAddHtml() {
    closeMediaPalette();
    onAddHtml?.();
  }

  function handleAddLink() {
    closeMediaPalette();
    onAddLink?.();
  }

  function handlePickDraw(next: DrawTool) {
    setDrawTool(next);
    selectTool(next);
  }

  function handlePickShape(next: CanvasShape) {
    setShape(next);
    activatePlacement(shapePlacement(next));
  }

  function handleInsert(kind: InsertKind) {
    if (kind === 'table') {
      setShape(kind);
    }

    activatePlacement(simplePlacement(kind));
    closePalette();
  }

  function handlePickSticker(id: string) {
    setSticker(id);
    activatePlacement(stickerPlacement(id));
    closePalette();
  }

  function handleActivatePalette(kind: PaletteKind) {
    if (kind === 'draw') {
      onToolChange(drawTool);
      closePalette();
      return;
    }

    const object = kind === 'shape' ? shapePlacement(shape) : stickerPlacement(sticker);
    if (object) {
      onToolChange(nextPlacementTool(object));
      setPalette(open === kind ? undefined : kind);
    }
  }

  function applyToolShortcut(key: string) {
    const direct = directTools.find((option) => option.key === key);
    if (direct) {
      selectTool(direct.id);
      return true;
    }
    if (!canEditGeometry) {
      return false;
    }

    const insertion = simplePlacements.find((option) => option.key === key);
    if (insertion) {
      activatePlacement(simplePlacement(insertion.kind));
      return true;
    }

    const picker = palettes.find((option) => option.key === key);
    if (picker) {
      handleActivatePalette(picker.kind);
      return true;
    }

    return false;
  }

  function handlePaletteDismiss(reason: AnchoredPopoverCloseReason) {
    if (reason === 'escape') {
      cancelPalette();
      return;
    }
    if (open !== 'draw') {
      closePalette();
    }
  }

  const toolShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!singleKeys || !acceptsToolShortcut(event, anchor)) {
      return;
    }

    if (applyToolShortcut(event.key)) {
      event.preventDefault();
    }
  });
  useEffect(() => {
    const board = anchor?.closest('.whiteboard-editor');
    if (!board) {
      return;
    }

    function handleToolShortcut(event: Event) {
      if (event instanceof KeyboardEvent) {
        toolShortcut(event);
      }
    }

    board.addEventListener('keydown', handleToolShortcut);
    return () => board.removeEventListener('keydown', handleToolShortcut);
  }, [anchor]);

  return (
    <>
      <div
        ref={setAnchor}
        className="whiteboard-editor__toolbar"
        data-canvas-toolbar-obstacle=""
        role="toolbar"
        aria-label="白板工具"
      >
        {directTools.map(({ id, label, key, Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-keyshortcuts={key}
            title={label + '（' + key + '）'}
            aria-pressed={tool === id}
            onClick={() => selectTool(id)}
          >
            <Icon size={20} />
          </button>
        ))}
        {simplePlacements.map(({ kind, label, key, Icon }) => (
          <button
            key={kind}
            type="button"
            aria-label={label}
            aria-keyshortcuts={key}
            title={canEditGeometry ? label + '（' + key + '）' : unavailable}
            aria-pressed={placement === kind}
            disabled={!canEditGeometry}
            onClick={() => activatePlacement(simplePlacement(kind))}
          >
            <Icon size={20} />
          </button>
        ))}
        {palettes.map(({ kind, label, key, caret }) => (
          <button
            key={kind}
            type="button"
            aria-label={label}
            aria-keyshortcuts={key}
            title={canEditGeometry ? label + '（' + key + '）' : unavailable}
            aria-pressed={toolMatchesPalette(tool, kind)}
            aria-haspopup="dialog"
            aria-expanded={open === kind}
            disabled={!canEditGeometry}
            onClick={() => handleActivatePalette(kind)}
          >
            {pickerGlyph(kind, shape, drawTool)}
            {caret && <ChevronDown size={9} className="whiteboard-editor__tool-caret" />}
          </button>
        ))}
      </div>
      <div className="whiteboard-editor__tool-palette" data-palette={open}>
        <AnchoredPopover
          open={Boolean(open)}
          anchor={anchor}
          label={paletteLabel(open)}
          placement="top"
          onRequestClose={handlePaletteDismiss}
        >
          {open === 'draw' && (
            <GeometryDrawChoices
              tool={tool}
              onToolChange={handlePickDraw}
              penColor={penColor}
              onPenColorChange={onPenColorChange}
            />
          )}
          {open === 'shape' && (
            <ShapeChoices
              selectedShape={shape}
              onShape={handlePickShape}
              onInsert={handleInsert}
              onAddHtml={onAddHtml ? handleAddHtml : undefined}
              onAddLink={onAddLink ? handleAddLink : undefined}
            />
          )}
          {open === 'sticker' && (
            <div className="whiteboard-editor__sticker-options">
              <StickerPalette
                selectedId={sticker}
                onSelect={(preset) => handlePickSticker(preset.id)}
              />
              {mediaAction?.(closeMediaPalette)}
            </div>
          )}
        </AnchoredPopover>
      </div>
    </>
  );
}
