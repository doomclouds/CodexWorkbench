import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MarkRect } from '../../contracts/reader';
import { rectsPath, rectsUnderlinePath, subtractRects, usefulRects } from './geometry';

/** Read leaf text ranges only; parent span boxes can cover whole lines or columns. */
export function textSelectionRects(range: Range, layer: Element): DOMRect[] {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT); const rects: DOMRect[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange(); part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    rects.push(...part.getClientRects());
  }
  return rects;
}

export function NativeSelectionLayer({ pageRef, width, height, savedRects = [] }: { pageRef: RefObject<HTMLDivElement | null>; width: number; height: number; savedRects?: MarkRect[] }) {
  const [rects, setRects] = useState<MarkRect[]>([]); const frame = useRef(0);
  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const selection = window.getSelection(); const page = pageRef.current; const layer = page?.querySelector('.textLayer');
        if (!selection?.rangeCount || selection.isCollapsed || !page || !layer) { setRects([]); return; }
        const range = selection.getRangeAt(0); if (!range.intersectsNode(layer)) { setRects([]); return; }
        const bounds = page.getBoundingClientRect(); const sx = width / bounds.width; const sy = height / bounds.height;
        setRects(usefulRects(textSelectionRects(range, layer).filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({ x: (rect.left - bounds.left) * sx, y: (rect.top - bounds.top) * sy, w: rect.width * sx, h: rect.height * sy }))));
      });
    };
    document.addEventListener('selectionchange', update); update();
    return () => { document.removeEventListener('selectionchange', update); cancelAnimationFrame(frame.current); };
  }, [pageRef, width, height]);
  return <svg className="pdf-live-selection" width={width} height={height} aria-hidden="true"><path d={rectsPath(subtractRects(rects, savedRects))} fill="#72a8f6" fillOpacity=".4" /><path d={rectsUnderlinePath(rects)} fill="none" stroke="#3b82f6" strokeWidth="1.5" /></svg>;
}
