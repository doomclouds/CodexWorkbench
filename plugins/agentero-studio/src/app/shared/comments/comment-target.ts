import type { Anchor, Board, BoardElement } from '../../../contracts/studio';
import type { StudioDocument, Viewport } from '../../products';
import { anchorBounds, tableRows, type Point, type Rect } from '../../canvas/canvas-model';

export type CommentPoint = Point;

export const TODO_OVERVIEW_PIN_INSET = { right: 34, bottom: 6 };

export const COMMENT_PIN_SIZE = 28;

export function visibleCommentCorner(
  bounds: Rect,
  viewport: Viewport,
  host: { width: number; height: number },
): Point {
  const x = bounds.x * viewport.zoom + viewport.x;
  const y = bounds.y * viewport.zoom + viewport.y;
  const left = Math.max(x, 0);
  const top = Math.max(y, 0);
  const right = Math.min(x + bounds.w * viewport.zoom, host.width);
  const bottom = Math.min(y + bounds.h * viewport.zoom, host.height);
  const visible =
    right > left && bottom > top
      ? { x: left, y: top, w: right - left, h: bottom - top }
      : { x, y, w: bounds.w * viewport.zoom, h: bounds.h * viewport.zoom };
  const inset = Math.min(16, visible.w / 4, visible.h / 4);

  return {
    x: (visible.x + visible.w - inset - viewport.x) / viewport.zoom,
    y: (visible.y + inset - viewport.y) / viewport.zoom,
  };
}

const shapes: Record<string, string> = {
  rect: '矩形',
  rounded: '圆角矩形',
  ellipse: '圆形',
  diamond: '菱形',
  pill: '胶囊',
  hexagon: '六边形',
  parallelogram: '平行四边形',
  database: '数据库',
  queue: '队列',
  document: '文档',
  cloud: '云',
  person: '人物',
};

function quote(text = ''): string {
  const value = text.replace(/\s+/g, ' ').trim();
  const chars = [...value];

  return value ? `“${chars.length > 40 ? `${chars.slice(0, 37).join('')}…` : value}”` : '';
}

function withText(kind: string, text?: string): string {
  const words = quote(text);

  return words ? `${kind}，${words}` : kind;
}

export function describeElement(element: BoardElement, elements: readonly BoardElement[]): string {
  switch (element.type) {
    case 'note':
      return withText('便签', element.text);
    case 'text':
      return withText('文字', element.text);
    case 'document':
      return withText('文档', element.text);
    case 'todo':
      return withText('任务清单', element.text);
    case 'shape':
      return withText(shapes[element.kind || 'rounded'] || '形状', element.text);
    case 'container': {
      const count = elements.filter(
        (item) =>
          item.id !== element.id &&
          item.x >= element.x &&
          item.y >= element.y &&
          item.x + item.w <= element.x + element.w &&
          item.y + item.h <= element.y + element.h,
      ).length;

      return `${withText('分区', element.text)}，${count} 项`;
    }

    case 'table': {
      const rows = tableRows(element);
      const words = rows.flat().filter(Boolean).join('，');

      return withText(
        `表格，${rows.length} 行 × ${Math.max(0, ...rows.map((row) => row.length))} 列`,
        words,
      );
    }

    case 'arrow': {
      const end = (value: BoardElement['from']) =>
        typeof value === 'string'
          ? (() => {
              const target = elements.find((item) => item.id === value);

              return target
                ? quote(target.text) || describeElement(target, []).split('，')[0]
                : '未知对象';
            })()
          : '画布位置';
      const defaultHeads = element.head === 'none' ? ['none', 'none'] : ['none', 'arrow'];
      const heads = element.heads || (element.head === 'both' ? ['arrow', 'arrow'] : defaultHeads);
      const singleHeadKind = heads.includes('arrow') ? '箭头' : '线段';
      const kind = heads.every((head) => head === 'arrow') ? '双向箭头' : singleHeadKind;

      return withText(
        `${element.dash ? '虚线' : ''}${kind}${typeof element.from === 'string' || typeof element.to === 'string' ? `，从${end(element.from)}到${end(element.to)}` : '，未连接对象'}`,
        element.label,
      );
    }

    case 'html':
    case 'diagram': {
      const title = element.html
        ? new DOMParser().parseFromString(element.html, 'text/html').title
        : element.text;

      return withText('网页嵌入', title);
    }

    case 'image': {
      if (element.video) {
        return '视频';
      }

      return element.href ? '带链接的图片' : '图片';
    }

    case 'stroke':
      return '笔迹';
    case 'sticker':
      return withText('贴纸', element.text);
    case 'link':
      return withText('链接', element.text || element.label);
    case 'chart':
      return withText('图表', element.text);
  }
}

export function describeCommentTarget(
  document: StudioDocument,
  anchor: Anchor,
  fallback: string,
): string {
  if (document.artifact.type !== 'whiteboard' || !('elements' in document)) {
    return fallback;
  }

  const board = document as Board;
  const ids = anchor.regionId ? [anchor.regionId] : anchor.elementIds || [];
  const elements = board.elements.filter((element) => ids.includes(element.id));
  if (anchor.quote) {
    return quote(anchor.quote);
  }
  if (elements.length === 1) {
    return describeElement(elements[0]!, board.elements);
  }
  if (elements.length > 1) {
    return `${elements.length} 个对象`;
  }

  return document.artifact.title;
}

export function commentBoardTip(anchor: Anchor, elements: readonly BoardElement[]): Point | null {
  if (anchor.pin?.coordinateSpace === 'board') {
    return { x: anchor.pin.x, y: anchor.pin.y };
  }
  if (anchor.pin?.coordinateSpace === 'document' || anchor.coordinateSpace === 'todo') {
    return null;
  }

  const bounds = anchorBounds(anchor, elements);
  if (!bounds) {
    return null;
  }

  const carriesPoint = Number.isFinite(anchor.x) && Number.isFinite(anchor.y);

  return { x: bounds.x + (carriesPoint ? 0 : bounds.w), y: bounds.y };
}

export function documentCommentTip(root: HTMLElement, anchor: Anchor): CommentPoint | undefined {
  if (anchor.coordinateSpace !== 'document' || anchor.pin?.coordinateSpace === 'board') {
    return;
  }

  const id = anchor.blockIds?.[0];
  const block = id
    ? root.querySelector<HTMLElement>(
        `[data-document-block-id="${CSS.escape(id)}"],.bn-block-outer[data-id="${CSS.escape(id)}"]`,
      )
    : root;

  if (!block?.getClientRects().length) {
    return;
  }

  const rect = block.getBoundingClientRect();
  if (anchor.pin?.coordinateSpace === 'document') {
    return { x: rect.left + rect.width * anchor.pin.x, y: rect.top + rect.height * anchor.pin.y };
  }

  return { x: rect.right, y: rect.top + 12 };
}

function renderedPinTip(canvas: HTMLElement, feedbackId: string): CommentPoint | undefined {
  const pins = canvas.querySelectorAll<HTMLElement>('[data-feedback-pin]');
  for (const pin of pins) {
    if (pin.dataset.feedbackPin !== feedbackId) {
      continue;
    }

    const rect = pin.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left, y: rect.bottom };
    }
  }
}

function visibleDocumentTip(
  canvas: HTMLElement,
  id: string,
  anchor: Anchor,
): CommentPoint | undefined {
  const roots = [...canvas.querySelectorAll<HTMLElement>(`[data-document-id="${CSS.escape(id)}"]`)];
  for (const root of roots.sort(
    (a, b) =>
      Number(b.classList.contains('studio-document-focus')) -
      Number(a.classList.contains('studio-document-focus')),
  )) {
    const point = documentCommentTip(root, anchor);
    if (point) {
      return point;
    }
  }
}

function visibleTodoTip(canvas: HTMLElement, id: string, anchor: Anchor): CommentPoint | undefined {
  const root = canvas.querySelector<HTMLElement>(`[data-todo-id="${CSS.escape(id)}"]`);
  const row =
    anchor.itemId &&
    root?.querySelector<HTMLElement>(`[data-todo-item-id="${CSS.escape(anchor.itemId)}"]`);
  const box = row && row.getBoundingClientRect();
  if (box && box.width && box.height) {
    const point = anchor.pin?.coordinateSpace === 'todo' ? anchor.pin : { x: 0.97, y: 0.9 };

    return { x: box.left + point.x * box.width, y: box.top + point.y * box.height };
  }

  const card = root?.getBoundingClientRect();
  if (card?.width && card.height) {
    return {
      x: Math.max(card.left, card.right - TODO_OVERVIEW_PIN_INSET.right),
      y: Math.max(card.top, card.bottom - TODO_OVERVIEW_PIN_INSET.bottom),
    };
  }
}

function anchoredContentTip(canvas: HTMLElement, anchor: Anchor): CommentPoint | undefined {
  const id = anchor.elementIds?.[0];
  if (!id || anchor.pin?.coordinateSpace === 'board') {
    return;
  }
  if (anchor.coordinateSpace === 'document') {
    return visibleDocumentTip(canvas, id, anchor);
  }
  if (anchor.coordinateSpace === 'todo') {
    return visibleTodoTip(canvas, id, anchor);
  }
}

export function liveCommentPoint(
  canvas: HTMLElement | null,
  document: StudioDocument | null,
  anchor: Anchor,
  viewport?: Viewport,
  feedbackId?: string,
  fallback?: CommentPoint,
): CommentPoint | undefined {
  if (!canvas) {
    return fallback;
  }

  const rendered = feedbackId ? renderedPinTip(canvas, feedbackId) : undefined;
  const contentTip = rendered ?? anchoredContentTip(canvas, anchor);
  if (contentTip) {
    return contentTip;
  }
  if (!document || !('elements' in document) || !viewport) {
    return fallback;
  }

  const tip = commentBoardTip(anchor, (document as Board).elements);
  const host = canvas.querySelector('.studio-canvas-viewport')?.getBoundingClientRect();
  if (!tip || !host) {
    return fallback;
  }

  return {
    x: host.left + viewport.x + tip.x * viewport.zoom,
    y: host.top + viewport.y + tip.y * viewport.zoom,
  };
}
