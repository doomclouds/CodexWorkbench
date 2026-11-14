import type { Anchor, Board, BoardElement } from '../../../contracts/studio';
import type { StudioDocument, Viewport } from '../../products';
import { anchorBounds, tableRows } from '../../canvas/canvas-model';

export interface CommentPoint { x: number; y: number; width?: number; height?: number }

const shapes: Record<string, string> = { rect: '矩形', rounded: '圆角矩形', ellipse: '圆形', diamond: '菱形', pill: '胶囊', hexagon: '六边形', parallelogram: '平行四边形', database: '数据库', queue: '队列', document: '文档', cloud: '云', person: '人物' };
function quote(text = ''): string {
  const value = text.replace(/\s+/g, ' ').trim(), chars = [...value];
  return value ? `“${chars.length > 40 ? `${chars.slice(0, 37).join('')}…` : value}”` : '';
}
function withText(kind: string, text?: string): string { const words = quote(text); return words ? `${kind}，${words}` : kind; }

/** Mirrors the original editor's per-element descriptions, including table dimensions and arrow ends. */
export function describeElement(element: BoardElement, elements: readonly BoardElement[]): string {
  switch (element.type) {
    case 'note': return withText('便签', element.text);
    case 'text': return withText('文字', element.text);
    case 'shape': return withText(shapes[element.kind || 'rounded'] || '形状', element.text);
    case 'container': {
      const count = elements.filter(item => item.id !== element.id && item.x >= element.x && item.y >= element.y && item.x + item.w <= element.x + element.w && item.y + item.h <= element.y + element.h).length;
      return `${withText('分区', element.text)}，${count} 项`;
    }
    case 'table': {
      const rows = tableRows(element), words = rows.flat().filter(Boolean).join('，');
      return withText(`表格，${rows.length} 行 × ${Math.max(0, ...rows.map(row => row.length))} 列`, words);
    }
    case 'arrow': {
      const end = (value: BoardElement['from']) => typeof value === 'string' ? (() => { const target = elements.find(item => item.id === value); return target ? quote(target.text) || describeElement(target, []).split('，')[0] : '未知对象'; })() : '画布位置';
      const heads = element.heads || (element.head === 'both' ? ['arrow', 'arrow'] : element.head === 'none' ? ['none', 'none'] : ['none', 'arrow']);
      const kind = heads.every(head => head === 'arrow') ? '双向箭头' : heads.includes('arrow') ? '箭头' : '线段';
      return withText(`${element.dash ? '虚线' : ''}${kind}${typeof element.from === 'string' || typeof element.to === 'string' ? `，从${end(element.from)}到${end(element.to)}` : '，未连接对象'}`, element.label);
    }
    case 'html': case 'diagram': {
      const title = element.html ? new DOMParser().parseFromString(element.html, 'text/html').title : element.text;
      return withText('网页嵌入', title);
    }
    case 'image': return element.video ? '视频' : element.href ? '带链接的图片' : '图片';
    case 'stroke': return '笔迹';
    case 'sticker': return withText('贴纸', element.text);
    case 'link': return withText('链接', element.text || element.label);
    case 'chart': return withText('图表', element.text);
  }
}

export function describeCommentTarget(document: StudioDocument, anchor: Anchor, fallback: string): string {
  if (document.artifact.type !== 'whiteboard' || !('elements' in document)) return fallback;
  const board = document as Board, ids = anchor.regionId ? [anchor.regionId] : anchor.elementIds || [];
  const elements = board.elements.filter(element => ids.includes(element.id));
  if (anchor.quote) return quote(anchor.quote);
  if (elements.length === 1) return describeElement(elements[0]!, board.elements);
  if (elements.length > 1) return `${elements.length} 个对象`;
  return document.artifact.title;
}

export function liveCommentPoint(canvas: HTMLElement | null, document: StudioDocument | null, anchor: Anchor, viewport?: Viewport, feedbackId?: string, fallback?: CommentPoint): CommentPoint | undefined {
  const pin = feedbackId ? [...canvas?.querySelectorAll<HTMLElement>('[data-feedback-pin]') || []].find(node => node.dataset.feedbackPin === feedbackId) : undefined;
  if (pin) { const rect = pin.getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }; }
  if (!canvas || !document || !('elements' in document) || !viewport) return fallback;
  const bounds = anchorBounds(anchor, (document as Board).elements), host = canvas.querySelector('.studio-canvas-viewport')?.getBoundingClientRect();
  if (!bounds || !host) return fallback;
  return { x: host.left + viewport.x + (bounds.x + (anchor.x === undefined ? bounds.w : 0)) * viewport.zoom, y: host.top + viewport.y + bounds.y * viewport.zoom + 4, width: 36, height: 36 };
}
