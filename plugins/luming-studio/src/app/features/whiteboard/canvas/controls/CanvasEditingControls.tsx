import type { ComponentProps } from 'react';
import {
  ArrowUpRight,
  Braces,
  ChevronDown,
  Circle,
  FileText,
  Frame,
  Hand,
  Link,
  ListTodo,
  MousePointer2,
  PenLine,
  Smile,
  Square,
  StickyNote,
  Table2,
  Type,
} from 'lucide-react';
import { Shape, SHAPES } from '../objects/CanvasShape.js';
import { makeElement } from '../scene/canvas-model.js';
import CanvasActionsMenu from './CanvasActionsMenu.js';
import CanvasFormatToolbar from './CanvasFormatToolbar.js';
import ColorPalette from './ColorPalette.js';
import StickerPalette from './StickerPalette.js';

export type Tool =
  | 'select'
  | 'pan'
  | 'annotate'
  | 'shape'
  | 'note'
  | 'text'
  | 'container'
  | 'stroke'
  | 'arrow'
  | 'sticker'
  | 'table'
  | 'document'
  | 'todo';

type ToolMenu = 'shape' | 'sticker' | null;

export const TOOL_OPTIONS: { tool: Tool; label: string; key: string; icon: typeof Square }[] = [
  { tool: 'select', label: '选择', key: '1', icon: MousePointer2 },
  { tool: 'pan', label: '平移', key: '2', icon: Hand },
  { tool: 'text', label: '文字', key: '3', icon: Type },
  { tool: 'container', label: '分区', key: '4', icon: Frame },
  { tool: 'note', label: '便签', key: '5', icon: StickyNote },
  { tool: 'stroke', label: '画笔', key: '6', icon: PenLine },
  { tool: 'shape', label: '形状', key: '7', icon: Square },
  { tool: 'sticker', label: '贴纸', key: '8', icon: Smile },
];

interface CanvasToolView {
  tool: Tool;
  menu: ToolMenu;
  lastDrawTool: 'stroke' | 'arrow';
  lastShapeTool: 'shape' | 'table';
  shapeKind: string;
  sticker: string;
  penColor: string;
  ink: string;
  theme: 'light' | 'dark';
  annotating: boolean;
  canEdit: boolean;
  hidden: boolean;
}

interface CanvasToolActions {
  chooseTool: (tool: Tool, menu?: ToolMenu) => void;
  changeShape: (kind: string) => void;
  changeSticker: (id: string) => void;
  changePenColor: (color: string) => void;
  addLink: () => void;
  addHtml: () => void;
  addDocument: () => void;
  uploadSticker: () => void;
}

type FormatToolbarProps = ComponentProps<typeof CanvasFormatToolbar>;
type ActionMenuProps = ComponentProps<typeof CanvasActionsMenu>;

type CanvasFormatActions = Pick<
  FormatToolbarProps,
  | 'onChange'
  | 'onEditText'
  | 'onTextFormat'
  | 'onAnnotate'
  | 'onReadSelection'
  | 'onEditHtml'
  | 'onCrop'
  | 'onAlign'
  | 'onMore'
  | 'onCustomColorsChange'
>;
type CanvasActionMenuActions = Pick<ActionMenuProps, 'onCommand' | 'onRenameSection' | 'onClose'>;

export interface CanvasFormatView extends Omit<FormatToolbarProps, keyof CanvasFormatActions> {
  selectionKey: string;
  canEditHtml: boolean;
  canCrop: boolean;
}

export interface CanvasActionMenuView extends Omit<ActionMenuProps, keyof CanvasActionMenuActions> {
  canRenameSection: boolean;
}

interface CanvasEditingControlsProps {
  tools: CanvasToolView;
  actions: CanvasToolActions;
  format?: CanvasFormatView | false | null;
  formatActions: CanvasFormatActions;
  actionMenu?: CanvasActionMenuView | null;
  menuActions: CanvasActionMenuActions;
}

function renderShape(kind: string, width: number, height: number, ink: string) {
  return (
    <Shape
      element={makeElement(
        'shape',
        { x: 0, y: 0 },
        { w: width, h: height, kind, fill: 'transparent', stroke: ink },
      )}
    />
  );
}

function renderToolBar(view: CanvasToolView, chooseTool: CanvasToolActions['chooseTool']) {
  const { tool, menu, lastDrawTool, lastShapeTool, shapeKind, ink, annotating, canEdit, hidden } =
    view;

  function activeToolFor(choice: Tool): Tool {
    if (choice === 'stroke') {
      return lastDrawTool;
    }

    return choice === 'shape' ? lastShapeTool : choice;
  }

  function renderToolIcon(choice: Tool, Icon: typeof Square) {
    if (choice === 'stroke' && lastDrawTool === 'arrow') {
      return <ArrowUpRight size={20} />;
    }
    if (choice !== 'shape') {
      return <Icon size={20} />;
    }
    if (lastShapeTool === 'table') {
      return <Table2 size={20} />;
    }

    return <span className="studio-tool-shape-glyph">{renderShape(shapeKind, 24, 20, ink)}</span>;
  }

  return (
    <div
      className="studio-canvas-toolbar"
      hidden={hidden}
      role="toolbar"
      aria-label="白板工具"
      data-native-interactive="true"
    >
      {TOOL_OPTIONS.map(({ tool: choice, label, key, icon: Icon }) => {
        const representsArrow = choice === 'stroke' && tool === 'arrow';
        const representsTable = choice === 'shape' && tool === 'table';
        const isCurrentTool = choice === tool || representsArrow || representsTable;
        const active = !annotating && isCurrentTool;
        const handleToolClick: NonNullable<ComponentProps<'button'>['onClick']> = () => {
          chooseTool(
            activeToolFor(choice),
            ['shape', 'sticker'].includes(choice) && menu !== choice
              ? (choice as 'shape' | 'sticker')
              : null,
          );
        };

        return (
          <button
            type="button"
            key={choice}
            aria-label={label}
            aria-keyshortcuts={key}
            title={`${label}（${key}）`}
            aria-pressed={active}
            className={active ? 'is-active' : ''}
            onClick={handleToolClick}
            disabled={!canEdit && !['select', 'pan'].includes(choice)}
          >
            {renderToolIcon(choice, Icon)}{' '}
            {['shape', 'stroke'].includes(choice) && (
              <ChevronDown size={9} className="studio-tool-caret" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function renderInsertMenu(view: CanvasToolView, actions: CanvasToolActions) {
  const { tool, menu, canEdit, shapeKind, ink } = view;
  const { changeShape, chooseTool, addLink, addHtml, addDocument } = actions;

  return (
    menu === 'shape' &&
    canEdit && (
      <div className="studio-shape-options studio-insert-menu" data-native-interactive="true">
        <div className="studio-shape-grid">
          {SHAPES.map(([kind, label]) => {
            const handlePickShape: NonNullable<ComponentProps<'button'>['onClick']> = () => {
              changeShape(kind);
              chooseTool('shape', 'shape');
            };

            return (
              <button
                type="button"
                key={kind}
                aria-label={`形状 ${label}`}
                title={label}
                aria-pressed={shapeKind === kind && tool === 'shape'}
                onClick={handlePickShape}
              >
                {renderShape(kind, 64, 48, ink)}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => chooseTool('table')}>
          <Table2 size={17} />
          表格
        </button>
        <button type="button" onClick={addLink}>
          <Link size={17} />
          链接
        </button>
        <button type="button" onClick={addHtml}>
          <Braces size={17} />
          HTML 图解
        </button>
        <button type="button" aria-label="添加文档区域" onClick={addDocument}>
          <FileText size={17} />
          文档区域
        </button>
        <button type="button" aria-label="添加任务清单" onClick={() => chooseTool('todo')}>
          <ListTodo size={17} />
          任务清单
        </button>
      </div>
    )
  );
}

function renderPenTools(view: CanvasToolView, actions: CanvasToolActions) {
  const { tool, theme, penColor, annotating, canEdit } = view;
  const { chooseTool, changePenColor } = actions;
  return (
    !annotating &&
    (tool === 'stroke' || tool === 'arrow') &&
    canEdit && (
      <div
        className="studio-shape-options studio-pen-menu"
        role="toolbar"
        aria-label="绘图选项"
        data-native-interactive="true"
      >
        <div className="studio-pen-choices">
          <button
            type="button"
            aria-label="画笔模式"
            title="画笔（6）"
            aria-pressed={tool === 'stroke'}
            onClick={() => chooseTool('stroke')}
          >
            <PenLine size={18} />
          </button>
          <button
            type="button"
            aria-label="箭头模式"
            title="箭头"
            aria-pressed={tool === 'arrow'}
            onClick={() => chooseTool('arrow')}
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
        <span className="studio-tool-divider" />
        <ColorPalette presetOnly theme={theme} value={penColor} onChange={changePenColor} />
      </div>
    )
  );
}

function renderStickerMenu(view: CanvasToolView, actions: CanvasToolActions) {
  const { menu, canEdit, sticker } = view;
  const { chooseTool, changeSticker, uploadSticker } = actions;
  const handleSelectSticker: ComponentProps<typeof StickerPalette>['onSelect'] = (choice) => {
    changeSticker(choice.id);
    chooseTool('sticker');
  };

  return (
    menu === 'sticker' &&
    canEdit && (
      <StickerPalette
        selectedId={sticker}
        onSelect={handleSelectSticker}
        onUpload={uploadSticker}
      />
    )
  );
}

function renderFormatToolbar(
  { selectionKey, canEditHtml, canCrop, ...props }: CanvasFormatView,
  actions: CanvasFormatActions,
) {
  return (
    <CanvasFormatToolbar
      key={selectionKey}
      {...props}
      {...actions}
      onEditHtml={canEditHtml ? actions.onEditHtml : undefined}
      onCrop={canCrop ? actions.onCrop : undefined}
    />
  );
}

function renderActionsMenu(
  { canRenameSection, ...props }: CanvasActionMenuView,
  actions: CanvasActionMenuActions,
) {
  return (
    <CanvasActionsMenu
      {...props}
      {...actions}
      onRenameSection={canRenameSection ? actions.onRenameSection : undefined}
    />
  );
}

export function CanvasEditingControls({
  tools,
  actions,
  format,
  formatActions,
  actionMenu,
  menuActions,
}: CanvasEditingControlsProps) {
  return (
    <>
      {renderToolBar(tools, actions.chooseTool)}
      {renderInsertMenu(tools, actions)}
      {renderPenTools(tools, actions)}
      {renderStickerMenu(tools, actions)}
      {format && renderFormatToolbar(format, formatActions)}
      {actionMenu && renderActionsMenu(actionMenu, menuActions)}
    </>
  );
}

interface CanvasEmptyStateProps {
  empty: boolean;
  interacting: boolean;
  canEdit: boolean;
  addDocument: () => void;
  addHtml: () => void;
}

export function CanvasEmptyState({
  empty,
  interacting,
  canEdit,
  addDocument,
  addHtml,
}: CanvasEmptyStateProps) {
  if (!empty || interacting) {
    return null;
  }

  return (
    <div className="studio-canvas-empty">
      <div className="studio-empty-symbol">
        <Square size={27} />
        <Circle size={25} />
        <ArrowUpRight size={24} />
      </div>
      <strong>从一个想法开始</strong>
      <p>
        {canEdit ? '添加文档、文字、便签或图形，也可以导入 HTML 图解。' : '这块白板还没有内容。'}
      </p>
      {canEdit && (
        <>
          <button type="button" data-native-interactive="true" onClick={addDocument}>
            <FileText size={16} />
            添加文档
          </button>
          <button type="button" data-native-interactive="true" onClick={addHtml}>
            <Braces size={16} />
            添加 HTML 图解
          </button>
        </>
      )}
    </div>
  );
}
