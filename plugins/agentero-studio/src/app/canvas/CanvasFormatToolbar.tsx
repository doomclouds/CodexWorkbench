import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Braces, Crop, Maximize, Italic, Link, List, Lock, MessageSquare, MoreHorizontal, Unlock } from 'lucide-react';
import type { BoardElement } from '../../contracts/studio.js';
import { getBoardSticker } from '../../core/products/whiteboard-stickers.js';
import { arrowHeads, placeFormatToolbar } from './canvas-model.js';
import type { InlineTextFormatState } from './InlineTextEditor.js';
import ColorPalette from './ColorPalette.js';
import { registerEscapeLayer } from '../shared/escape.js';

interface Props {
  elements: BoardElement[]; style: CSSProperties; canEdit: boolean; canAnnotate: boolean; saving: boolean; theme: 'light' | 'dark';
  onChange: (changes: Partial<BoardElement>, customColors?: string[]) => void; onEditText: () => void;
  onTextFormat: (format: 'bold' | 'italic' | 'list' | 'link' | 'numbered', value?: string) => void;
  onAnnotate: () => void; onReadSelection?: () => void; onEditHtml?: () => void; onCrop?: () => void;
  requestLink?:{key:string;value:string}; formatState?:InlineTextFormatState;
  customColors?: string[]; onCustomColorsChange?: (colors: string[]) => void;
  onMore: (point: { x: number; y: number }) => void; onAlign: (edge: 'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom') => void;
}
export default function CanvasFormatToolbar({ elements, style, canEdit, canAnnotate, saving, theme, onChange, onEditText, onTextFormat, onAnnotate, onReadSelection, onEditHtml, onCrop, onMore, onAlign, requestLink, formatState, customColors, onCustomColorsChange }: Props) {
  const [popover, setPopover] = useState<string | null>(null), [link, setLink] = useState('');
  const toolbar = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closePopover = (restoreFocus = false) => {
    setPopover(null);
    if (restoreFocus && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
  };
  const rememberTrigger = (button: HTMLButtonElement) => {
    trigger.current = button;
    const active = document.activeElement;
    if (!toolbar.current?.querySelector('.studio-format-popover')?.contains(active)) {
      returnFocus.current = active instanceof HTMLElement && active.matches('input,textarea,[contenteditable]:not([contenteditable="false"])') ? active : button;
    }
  };
  useEffect(() => {
    if (!popover) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !toolbar.current?.contains(event.target)) setPopover(null); };
    document.addEventListener('pointerdown', outside, true);
    const unregister = registerEscapeLayer(toolbar.current!, () => closePopover(true));
    return () => { document.removeEventListener('pointerdown', outside, true); unregister(); };
  }, [Boolean(popover)]);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    const node = toolbar.current, host = node?.parentElement;
    if (!node || !host) return;
    const topTools = host.querySelector<HTMLElement>('.studio-canvas-top-tools');
    const place = () => {
      const bounds = node.getBoundingClientRect(), canvas = host.getBoundingClientRect();
      if (!canvas.width || !canvas.height || !bounds.width) return;
      const controls = topTools?.getBoundingClientRect();
      const reserved = controls?.width && controls.height ? { x: controls.left - canvas.left, y: controls.top - canvas.top, w: controls.width, h: controls.height } : undefined;
      const next = placeFormatToolbar({ x: Number(style.left), y: Number(style.top) }, { w: bounds.width, h: bounds.height }, { w: canvas.width, h: canvas.height }, reserved);
      setPosition(current => current?.left === next.x && current.top === next.y ? current : { left: next.x, top: next.y });
      const dialog = node.querySelector<HTMLElement>('.studio-format-popover');
      if (dialog) {
        const button = trigger.current;
        if (!button?.isConnected) { setPopover(null); return; }
        const anchor = button.getBoundingClientRect(), scroller = button.parentElement?.getBoundingClientRect();
        if (scroller?.width && (anchor.right <= scroller.left || anchor.left >= scroller.right)) { setPopover(null); return; }
        const leftEdge = Math.max(canvas.left, 0) + 12, rightEdge = Math.min(canvas.right, window.innerWidth) - 12;
        const topEdge = Math.max(canvas.top, 0) + 12, bottomEdge = Math.min(canvas.bottom, window.innerHeight) - 12;
        const maxWidth = Math.max(0, rightEdge - leftEdge);
        dialog.style.maxWidth = `${maxWidth}px`;
        dialog.style.minWidth = `${Math.min(220, maxWidth)}px`;
        const panelBounds = dialog.getBoundingClientRect();
        const height = dialog.scrollHeight + panelBounds.height - dialog.clientHeight;
        const below = Math.max(0, bottomEdge - bounds.bottom - 7), above = Math.max(0, bounds.top - topEdge - 7);
        const useAbove = height > below && above > below, maxHeight = useAbove ? above : below;
        const left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - panelBounds.width));
        const top = useAbove ? bounds.top - 7 - Math.min(height, maxHeight) : bounds.bottom + 7;
        dialog.style.left = `${left - bounds.left - node.clientLeft}px`;
        dialog.style.top = `${top - bounds.top - node.clientTop}px`;
        dialog.style.maxHeight = `${maxHeight}px`;
        dialog.dataset.placement = useAbove ? 'above' : 'below';
        dialog.style.visibility = 'visible';
      }
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    observer?.observe(node); observer?.observe(host); if (topTools) observer?.observe(topTools);
    const dialog = node.querySelector<HTMLElement>('.studio-format-popover');
    if (dialog) observer?.observe(dialog);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !dialog?.contains(event.target)) place(); };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', place); };
  }, [style.left, style.top, elements.length, popover, position?.left, position?.top]);
  useEffect(() => {
    if (!requestLink || !linkButton.current) return;
    rememberTrigger(linkButton.current);
    linkButton.current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    setLink(requestLink.value); setPopover('文字链接');
  }, [requestLink?.key]);
  useLayoutEffect(() => {
    if (popover !== '文字链接') return;
    linkInput.current?.focus({ preventScroll: true });
    linkInput.current?.select();
  }, [popover, requestLink?.key]);
  const selected = elements.length === 1 ? elements[0] : undefined;
  const html = selected && (selected.type === 'html' || selected.type === 'diagram' && typeof selected.html === 'string');
  const documentRegion = selected?.type === 'document';
  const regionTitle = selected?.text || (documentRegion ? '文档' : 'HTML 图解');
  const text = elements.every(element => ['shape','note','text','container','arrow','table'].includes(element.type) || element.type === 'sticker' && !getBoardSticker(element.data?.stickerIconId));
  const fill = elements.every(element => ['shape','note','container','table','document'].includes(element.type));
  const line = elements.every(element => ['shape','stroke','arrow','container'].includes(element.type));
  const allLocked = elements.every(element => element.locked);
  const Align = selected?.textAlign === 'center' ? AlignCenter : selected?.textAlign === 'right' ? AlignRight : AlignLeft;
  const panel = (name: string, content: React.ReactNode) => popover === name && <div id={popoverId} className="studio-format-popover" role="dialog" aria-label={name}>{content}</div>;
  const toggle = (name: string, button: HTMLButtonElement) => {
    if (popover === name) { closePopover(true); return; }
    rememberTrigger(button); setPopover(name);
  };
  return <div ref={toolbar} className="studio-selection-toolbar" role="toolbar" aria-label="选区格式" data-native-interactive="true" style={{ ...style, ...position }} onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}><div className="studio-selection-toolbar-scroll">
    {onReadSelection && <button type="button" aria-label="全屏观看选区" title="全屏观看" onClick={onReadSelection}><Maximize size={18}/></button>}
    {documentRegion || html ? <>
      <span className="studio-selection-label" title={regionTitle}>{regionTitle}</span>
      {html && canEdit && onEditHtml && <button type="button" aria-label="编辑 HTML 源码" title="编辑 HTML 源码" onClick={onEditHtml}><Braces size={18}/></button>}
    </> : canEdit && <>
      {text && <>{elements.every(element=>['shape','text'].includes(element.type)) && <select aria-label="形状类型" disabled={allLocked} value={selected?.type==='text'?'text':selected?.kind??'rounded'} onChange={event=>onChange(event.target.value==='text'?{type:'text',fill:'transparent'}:{type:'shape',kind:event.target.value,fill:selected?.fill==='transparent'?'#EFEFEF':selected?.fill})}>{[['text','文字'],['rounded','圆角矩形'],['rect','矩形'],['ellipse','椭圆'],['diamond','菱形'],['pill','胶囊'],['hexagon','六边形'],['parallelogram','平行四边形'],['database','数据库'],['queue','队列'],['document','文档'],['cloud','云'],['person','人物']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}<select aria-label="文字大小" value={elements.every(element => element.fontSize === elements[0].fontSize) ? selected?.fontSize ?? elements[0].fontSize ?? 16 : ''} disabled={saving} onChange={event => onChange({fontSize:Number(event.target.value)})}><option value="" disabled>混合</option>{[[14,'小'],[16,'正文'],[28,'大'],[48,'标题'],[96,'超大'],...selected?.fontSize && ![14,16,28,48,96].includes(selected.fontSize) ? [[selected.fontSize,String(selected.fontSize)]] : []].map(([size,label]) => <option key={size} value={size}>{label} · {size}px</option>)}</select><button type="button" aria-label="加粗" title="加粗（Ctrl/⌘ B）" aria-pressed={formatState?.bold ?? elements.every(element => element.bold)} onClick={() => onTextFormat('bold')} disabled={saving}><Bold size={17}/></button><button type="button" aria-label="斜体" title="斜体（Ctrl/⌘ I）" aria-pressed={formatState?.italic ?? elements.every(element => element.italic)} onClick={() => onTextFormat('italic')} disabled={saving}><Italic size={17}/></button>{selected && <><button ref={linkButton} type="button" aria-label="文字链接" title="文字链接" aria-haspopup="dialog" aria-expanded={popover === '文字链接'} aria-controls={popover === '文字链接' ? popoverId : undefined} onClick={event => toggle('文字链接', event.currentTarget)}><Link size={17}/></button><button type="button" aria-label="切换列表" title="无序列表" onClick={() => onTextFormat('list')}><List size={17}/></button></>}<button type="button" aria-label="文字对齐" title="文字对齐" aria-haspopup="dialog" aria-expanded={popover === '文字对齐'} aria-controls={popover === '文字对齐' ? popoverId : undefined} onClick={event => toggle('文字对齐', event.currentTarget)}><Align size={17}/></button><button type="button" aria-label="文字颜色" title="文字颜色" aria-haspopup="dialog" aria-expanded={popover === '文字颜色'} aria-controls={popover === '文字颜色' ? popoverId : undefined} onClick={event => toggle('文字颜色', event.currentTarget)}>A</button></>}
      {line && <button type="button" aria-label="边框与线条" title="边框与线条" aria-haspopup="dialog" aria-expanded={popover === '边框与线条'} aria-controls={popover === '边框与线条' ? popoverId : undefined} onClick={event => toggle('边框与线条', event.currentTarget)}>☰</button>}
      {selected?.type === 'arrow' && <><select className="studio-arrow-endpoint-select" aria-label="连接线起点" value={arrowHeads(selected)[0]} onChange={event => onChange({heads:[event.target.value as 'none'|'arrow'|'circle',arrowHeads(selected)[1]]})}>{['none','arrow','circle'].map(value => <option key={value} value={value}>{value==='none'?'无':value==='arrow'?'箭头':'圆点'}</option>)}</select><select className="studio-arrow-endpoint-select" aria-label="连接线终点" value={arrowHeads(selected)[1]} onChange={event => onChange({heads:[arrowHeads(selected)[0],event.target.value as 'none'|'arrow'|'circle']})}>{['none','arrow','circle'].map(value => <option key={value} value={value}>{value==='none'?'无':value==='arrow'?'箭头':'圆点'}</option>)}</select></>}
      {selected?.type === 'image' && onCrop && <button type="button" aria-label="裁剪图片" title="裁剪图片" disabled={allLocked} onClick={onCrop}><Crop size={17}/></button>}
      {elements.length > 1 && <button type="button" aria-label="对齐对象" title="对齐对象" disabled={allLocked} aria-haspopup="dialog" aria-expanded={popover === '对齐对象'} aria-controls={popover === '对齐对象' ? popoverId : undefined} onClick={event => toggle('对齐对象', event.currentTarget)}><AlignCenter size={17}/></button>}
    </>}
    {canEdit && fill && <button type="button" aria-label="填充颜色" title="填充颜色" className="studio-color-chip" style={{background:selected?.fill || '#EFEFEF'}} aria-haspopup="dialog" aria-expanded={popover === '填充颜色'} aria-controls={popover === '填充颜色' ? popoverId : undefined} onClick={event => toggle('填充颜色', event.currentTarget)}/>}
    <span className="studio-tool-divider"/>{canAnnotate && <button type="button" aria-label="备注所选元素" title="备注" onClick={onAnnotate}><MessageSquare size={18}/></button>}{canEdit && <button type="button" className="studio-lock-toggle" aria-label={allLocked?'解锁元素':'锁定元素'} title={allLocked?'解锁位置与尺寸':'锁定位置与尺寸（仍可编辑内容）'} aria-pressed={allLocked} disabled={saving} onClick={() => onChange({locked:!allLocked})}>{allLocked?<Unlock size={18}/>:<Lock size={18}/>}</button>}<button type="button" aria-label="更多操作" title="更多操作" onClick={event => {const rect=event.currentTarget.getBoundingClientRect();onMore({x:rect.left,y:rect.bottom+6});}}><MoreHorizontal size={19}/></button>
    </div>{panel('文字颜色',<ColorPalette theme={theme} value={selected?.color} onChange={(color, colors) => onChange({color}, colors)} custom={customColors} onCustomChange={onCustomColorsChange}/>)}
    {panel('填充颜色',<ColorPalette theme={theme} kind="fill" value={selected?.fill} onChange={fill => onChange(documentRegion ? {fill} : {fill,hollow:false})} none={elements.every(element => element.type === 'shape') ? () => onChange({hollow:true}) : undefined}/>)}
    {panel('边框与线条',<><div className="studio-format-row"><button type="button" aria-pressed={elements.every(element=>element.stroke==='transparent')} onClick={() => onChange({stroke:'transparent',dash:false})}>无边框</button><button type="button" aria-pressed={elements.every(element=>element.stroke!=='transparent'&&!element.dash)} onClick={() => onChange({stroke:selected?.stroke==='transparent'?'#0B0B0B':selected?.stroke || '#0B0B0B',dash:false})}>实线</button><button type="button" aria-pressed={elements.every(element=>element.stroke!=='transparent'&&element.dash===true)} onClick={() => onChange({stroke:selected?.stroke==='transparent'?'#0B0B0B':selected?.stroke || '#0B0B0B',dash:true})}>虚线</button></div><ColorPalette theme={theme} value={selected?.stroke} onChange={(stroke, colors) => onChange({stroke}, colors)} custom={customColors} onCustomChange={onCustomColorsChange}/><label>线宽<input aria-label="线条宽度" type="number" min="0.5" max="40" step="0.5" value={selected?.strokeWidth??(selected?.type==='container'?1:3)} onChange={event => onChange({strokeWidth:Number(event.target.value)})}/></label></>)}
    {panel('文字对齐',<div className="studio-format-row">{(['left','center','right'] as const).map(value => <button type="button" key={value} aria-label={`文字${value}`} onClick={() => {onChange({textAlign:value});closePopover(true);}}>{value==='left'?<AlignLeft size={18}/>:value==='center'?<AlignCenter size={18}/>:<AlignRight size={18}/>}</button>)}</div>)}
    {panel('对齐对象',<div className="studio-format-row">{(['left','hcenter','right','top','vcenter','bottom'] as const).map(value => <button type="button" key={value} onClick={() => {onAlign(value);closePopover(true);}}>{{left:'左对齐',hcenter:'水平居中',right:'右对齐',top:'顶部对齐',vcenter:'垂直居中',bottom:'底部对齐'}[value]}</button>)}</div>)}
    {panel('文字链接',<form onSubmit={event => {event.preventDefault();onTextFormat('link',link);closePopover(true);}}><input ref={linkInput} aria-label="文字链接地址" type="url" placeholder="https://" value={link} onChange={event => setLink(event.target.value)}/><button type="submit">应用</button></form>)}
  </div>;
}
