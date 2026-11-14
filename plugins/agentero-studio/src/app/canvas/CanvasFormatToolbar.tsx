import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Braces, Crop, ExternalLink, Italic, Link, List, Lock, MessageSquare, MoreHorizontal, MousePointer2, Unlock } from 'lucide-react';
import type { BoardElement } from '../../contracts/studio.js';
import { getBoardSticker } from '../../core/products/whiteboard-stickers.js';
import { arrowHeads, placeFormatToolbar } from './canvas-model.js';
import type { InlineTextFormatState } from './InlineTextEditor.js';
import ColorPalette from './ColorPalette.js';

interface Props {
  elements: BoardElement[]; style: CSSProperties; canEdit: boolean; canAnnotate: boolean; saving: boolean; interactive: boolean; theme: 'light' | 'dark';
  onChange: (changes: Partial<BoardElement>) => void; onEditText: () => void;
  onTextFormat: (format: 'bold' | 'italic' | 'list' | 'link' | 'numbered', value?: string) => void;
  onAnnotate: () => void; onToggleInteractive: () => void; onOpenHtml?: () => void; onEditHtml?: () => void; onCrop?: () => void;
  requestLink?:{key:string;value:string}; formatState?:InlineTextFormatState;
  customColors?: string[]; onCustomColorsChange?: (colors: string[]) => void;
  onMore: (point: { x: number; y: number }) => void; onAlign: (edge: 'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom') => void;
}
export default function CanvasFormatToolbar({ elements, style, canEdit, canAnnotate, saving, interactive, theme, onChange, onEditText, onTextFormat, onAnnotate, onToggleInteractive, onOpenHtml, onEditHtml, onCrop, onMore, onAlign, requestLink, formatState, customColors, onCustomColorsChange }: Props) {
  const [popover, setPopover] = useState<string | null>(null), [link, setLink] = useState('');
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    const node = toolbar.current, host = node?.parentElement;
    if (!node || !host) return;
    const place = () => {
      const bounds = node.getBoundingClientRect(), canvas = host.getBoundingClientRect();
      if (!canvas.width || !canvas.height || !bounds.width) return;
      const next = placeFormatToolbar({ x: Number(style.left), y: Number(style.top) }, { w: bounds.width, h: bounds.height }, { w: canvas.width, h: canvas.height });
      setPosition(current => current?.left === next.x && current.top === next.y ? current : { left: next.x, top: next.y });
      const dialog = node.querySelector<HTMLElement>('.studio-format-popover');
      if (dialog) {
        dialog.style.maxWidth = `${canvas.width - 24}px`;
        dialog.style.minWidth = `${Math.min(220, canvas.width - 24)}px`;
        const available = canvas.width - 12 - (next.x - bounds.width / 2);
        dialog.style.left = `${Math.min(0, available - dialog.getBoundingClientRect().width)}px`;
      }
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    observer?.observe(node); observer?.observe(host);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [style.left, style.top, elements.length, popover]);
  useEffect(()=>{if(requestLink){setLink(requestLink.value);setPopover('文字链接');}},[requestLink?.key]);
  const selected = elements.length === 1 ? elements[0] : undefined;
  const html = selected && (selected.type === 'html' || selected.type === 'diagram' && typeof selected.html === 'string');
  const text = elements.every(element => ['shape','note','text','container','arrow','table'].includes(element.type) || element.type === 'sticker' && !getBoardSticker(element.data?.stickerIconId));
  const fill = elements.every(element => ['shape','note','container','table'].includes(element.type));
  const line = elements.every(element => ['shape','stroke','arrow','container'].includes(element.type));
  const allLocked = elements.every(element => element.locked);
  const Align = selected?.textAlign === 'center' ? AlignCenter : selected?.textAlign === 'right' ? AlignRight : AlignLeft;
  const panel = (name: string, content: React.ReactNode) => popover === name && <div className="studio-format-popover" role="dialog" aria-label={name}>{content}</div>;
  const toggle = (name: string) => setPopover(value => value === name ? null : name);
  return <div ref={toolbar} className="studio-selection-toolbar" role="toolbar" aria-label="选区格式" data-native-interactive="true" style={{ ...style, ...position }} onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}><div className="studio-selection-toolbar-scroll">
    {html ? <><span className="studio-selection-label">HTML 图解</span>{onOpenHtml && <button type="button" aria-label="新标签页打开 HTML 图解" title="新标签页打开" onClick={onOpenHtml}><ExternalLink size={18}/></button>}<button type="button" aria-label="与 HTML 内容交互" title="与内容交互" aria-pressed={interactive} onClick={onToggleInteractive}><MousePointer2 size={18}/></button>{canEdit && onEditHtml && <button type="button" aria-label="编辑 HTML 源码" title="编辑 HTML 源码" onClick={onEditHtml}><Braces size={18}/></button>}</> : canEdit && <>
      {text && <>{elements.every(element=>['shape','text'].includes(element.type)) && <select aria-label="形状类型" disabled={allLocked} value={selected?.type==='text'?'text':selected?.kind??'rounded'} onChange={event=>onChange(event.target.value==='text'?{type:'text',fill:'transparent'}:{type:'shape',kind:event.target.value,fill:selected?.fill==='transparent'?'#EFEFEF':selected?.fill})}>{[['text','文字'],['rounded','圆角矩形'],['rect','矩形'],['ellipse','椭圆'],['diamond','菱形'],['pill','胶囊'],['hexagon','六边形'],['parallelogram','平行四边形'],['database','数据库'],['queue','队列'],['document','文档'],['cloud','云'],['person','人物']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}<select aria-label="文字大小" value={elements.every(element => element.fontSize === elements[0].fontSize) ? selected?.fontSize ?? elements[0].fontSize ?? 16 : ''} disabled={saving} onChange={event => onChange({fontSize:Number(event.target.value)})}><option value="" disabled>混合</option>{[[14,'小'],[16,'正文'],[28,'大'],[48,'标题'],[96,'超大'],...selected?.fontSize && ![14,16,28,48,96].includes(selected.fontSize) ? [[selected.fontSize,String(selected.fontSize)]] : []].map(([size,label]) => <option key={size} value={size}>{label} · {size}px</option>)}</select><button type="button" aria-label="加粗" title="加粗（Ctrl/⌘ B）" aria-pressed={formatState?.bold ?? elements.every(element => element.bold)} onClick={() => onTextFormat('bold')} disabled={saving}><Bold size={17}/></button><button type="button" aria-label="斜体" title="斜体（Ctrl/⌘ I）" aria-pressed={formatState?.italic ?? elements.every(element => element.italic)} onClick={() => onTextFormat('italic')} disabled={saving}><Italic size={17}/></button>{selected && <><button type="button" aria-label="文字链接" title="文字链接" onClick={() => toggle('文字链接')}><Link size={17}/></button><button type="button" aria-label="切换列表" title="无序列表" onClick={() => onTextFormat('list')}><List size={17}/></button></>}<button type="button" aria-label="文字对齐" title="文字对齐" onClick={() => toggle('文字对齐')}><Align size={17}/></button><button type="button" aria-label="文字颜色" title="文字颜色" onClick={() => toggle('文字颜色')}>A</button></>}
      {fill && <button type="button" aria-label="填充颜色" title="填充颜色" className="studio-color-chip" style={{background:selected?.fill || '#EFEFEF'}} onClick={() => toggle('填充颜色')}/>}
      {line && <button type="button" aria-label="边框与线条" title="边框与线条" onClick={() => toggle('边框与线条')}>☰</button>}
      {selected?.type === 'arrow' && <><select aria-label="连接线起点" value={arrowHeads(selected)[0]} onChange={event => onChange({heads:[event.target.value as 'none'|'arrow'|'circle',arrowHeads(selected)[1]]})}>{['none','arrow','circle'].map(value => <option key={value} value={value}>{value==='none'?'无':value==='arrow'?'箭头':'圆点'}</option>)}</select><select aria-label="连接线终点" value={arrowHeads(selected)[1]} onChange={event => onChange({heads:[arrowHeads(selected)[0],event.target.value as 'none'|'arrow'|'circle']})}>{['none','arrow','circle'].map(value => <option key={value} value={value}>{value==='none'?'无':value==='arrow'?'箭头':'圆点'}</option>)}</select></>}
      {selected?.type === 'image' && onCrop && <button type="button" aria-label="裁剪图片" title="裁剪图片" disabled={allLocked} onClick={onCrop}><Crop size={17}/></button>}
      {elements.length > 1 && <button type="button" aria-label="对齐对象" title="对齐对象" disabled={allLocked} onClick={() => toggle('对齐对象')}><AlignCenter size={17}/></button>}
    </>}
    <span className="studio-tool-divider"/>{canAnnotate && <button type="button" aria-label="备注所选元素" title="备注" onClick={onAnnotate}><MessageSquare size={18}/></button>}{canEdit && <button type="button" aria-label={allLocked?'解锁元素':'锁定元素'} title={allLocked?'解锁位置':'锁定位置与尺寸'} aria-pressed={allLocked} disabled={saving} onClick={() => onChange({locked:!allLocked})}>{allLocked?<Unlock size={18}/>:<Lock size={18}/>}</button>}<button type="button" aria-label="更多操作" title="更多操作" onClick={event => {const rect=event.currentTarget.getBoundingClientRect();onMore({x:rect.left,y:rect.bottom+6});}}><MoreHorizontal size={19}/></button>
    </div>{panel('文字颜色',<ColorPalette theme={theme} value={selected?.color} onChange={color => onChange({color})} custom={customColors} onCustomChange={onCustomColorsChange}/>)}
    {panel('填充颜色',<ColorPalette theme={theme} kind="fill" value={selected?.fill} onChange={fill => onChange({fill,hollow:false})} none={elements.every(element => element.type === 'shape') ? () => onChange({hollow:true}) : undefined}/>)}
    {panel('边框与线条',<><div className="studio-format-row"><button type="button" onClick={() => onChange({stroke:'transparent',dash:false})}>无边框</button><button type="button" onClick={() => onChange({stroke:selected?.stroke==='transparent'?'#0B0B0B':selected?.stroke || '#0B0B0B',dash:false})}>实线</button><button type="button" onClick={() => onChange({dash:true})}>虚线</button></div><ColorPalette theme={theme} value={selected?.stroke} onChange={stroke => onChange({stroke})} custom={customColors} onCustomChange={onCustomColorsChange}/><label>线宽<input aria-label="线条宽度" type="number" min="0.5" max="40" step="0.5" value={selected?.strokeWidth??3} onChange={event => onChange({strokeWidth:Number(event.target.value)})}/></label></>)}
    {panel('文字对齐',<div className="studio-format-row">{(['left','center','right'] as const).map(value => <button type="button" key={value} aria-label={`文字${value}`} onClick={() => {onChange({textAlign:value});setPopover(null);}}>{value==='left'?<AlignLeft size={18}/>:value==='center'?<AlignCenter size={18}/>:<AlignRight size={18}/>}</button>)}</div>)}
    {panel('对齐对象',<div className="studio-format-row">{(['left','hcenter','right','top','vcenter','bottom'] as const).map(value => <button type="button" key={value} onClick={() => {onAlign(value);setPopover(null);}}>{{left:'左对齐',hcenter:'水平居中',right:'右对齐',top:'顶部对齐',vcenter:'垂直居中',bottom:'底部对齐'}[value]}</button>)}</div>)}
    {panel('文字链接',<form onSubmit={event => {event.preventDefault();onTextFormat('link',link);setPopover(null);}}><input aria-label="文字链接地址" type="url" placeholder="https://" value={link} onChange={event => setLink(event.target.value)}/><button type="submit">应用</button></form>)}
  </div>;
}
