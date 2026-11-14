import { useState, type CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, ExternalLink, Italic, Link, List, Lock, MessageSquare, MoreHorizontal, MousePointer2, Type, Unlock } from 'lucide-react';
import type { BoardElement } from '../../contracts/studio.js';
import { getBoardSticker } from '../../core/products/whiteboard-stickers.js';

interface Props {
  elements: BoardElement[];
  style: CSSProperties;
  canEdit: boolean;
  canAnnotate: boolean;
  saving: boolean;
  interactive: boolean;
  onChange: (changes: Partial<BoardElement>) => void;
  onEditText: () => void;
  onTextFormat: (format: 'list' | 'link', value?: string) => void;
  onAnnotate: () => void;
  onToggleInteractive: () => void;
  onOpenHtml?: () => void;
  onMore: () => void;
}

export default function CanvasFormatToolbar({ elements, style, canEdit, canAnnotate, saving, interactive, onChange, onEditText, onTextFormat, onAnnotate, onToggleInteractive, onOpenHtml, onMore }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const selected = elements.length === 1 ? elements[0] : undefined;
  const html = Boolean(selected && (selected.type === 'html' || selected.type === 'diagram' && typeof selected.html === 'string'));
  const text = elements.every(element => ['shape', 'note', 'text', 'container', 'sticker', 'arrow'].includes(element.type) && !(element.type === 'sticker' && getBoardSticker(element.data?.stickerIconId)));
  const fill = elements.every(element => ['shape', 'note', 'container', 'table', 'link'].includes(element.type));
  const line = elements.every(element => ['shape', 'stroke', 'arrow', 'container'].includes(element.type));
  const allLocked = elements.every(element => element.locked);
  const Align = selected?.textAlign === 'center' ? AlignCenter : selected?.textAlign === 'right' ? AlignRight : AlignLeft;
  const colorValue = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return <div className="studio-selection-toolbar" role="toolbar" aria-label="选区格式" data-native-interactive="true" style={style} onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
    {html ? <>
      <span className="studio-selection-label">HTML 图解</span>
      {onOpenHtml && <button type="button" aria-label="新标签页打开 HTML 图解" title="新标签页打开" onClick={onOpenHtml}><ExternalLink size={18} /></button>}
      <button type="button" aria-label="与 HTML 内容交互" title={interactive ? '返回白板操作' : '与内容交互'} aria-pressed={interactive} className={interactive ? 'is-active' : ''} onClick={onToggleInteractive}><MousePointer2 size={18} /></button>
    </> : canEdit && <>
      {text && <>
        <select aria-label="文字大小" title="文字大小" value={selected?.fontSize ?? 17} disabled={saving} onChange={event => onChange({ fontSize: Number(event.target.value) })}>{[12, 14, 17, 18, 20, 24, 28, 32, 40, 48, 64, ...(selected?.fontSize && ![12, 14, 17, 18, 20, 24, 28, 32, 40, 48, 64].includes(selected.fontSize) ? [selected.fontSize] : [])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}</select>
        <button type="button" aria-label="加粗" title="加粗" aria-pressed={Boolean(selected?.bold)} disabled={saving} onClick={() => onChange({ bold: !elements.every(element => element.bold) })}><Bold size={17} /></button>
        <button type="button" aria-label="斜体" title="斜体" aria-pressed={Boolean(selected?.italic)} disabled={saving} onClick={() => onChange({ italic: !elements.every(element => element.italic) })}><Italic size={17} /></button>
        {selected && <><button type="button" aria-label="文字链接" title="文字链接" disabled={saving} onClick={() => setLinkOpen(value => !value)}><Link size={17} /></button><button type="button" aria-label="切换列表" title="切换列表" disabled={saving} onClick={() => onTextFormat('list')}><List size={17} /></button><button type="button" aria-label="编辑所选文字" title="编辑文字" disabled={saving} onClick={onEditText}><Type size={17} /></button></>}
        <button type="button" aria-label="文字对齐" title="文字对齐" disabled={saving} onClick={() => onChange({ textAlign: selected?.textAlign === 'left' ? 'center' : selected?.textAlign === 'center' ? 'right' : 'left' })}><Align size={17} /></button>
        <label className="studio-format-color" title="文字颜色"><input aria-label="文字颜色" type="color" value={colorValue(selected?.color, '#2d3142')} disabled={saving} onChange={event => onChange({ color: event.target.value })} /></label>
      </>}
      {fill && <label className="studio-format-color" title="填充颜色"><input aria-label="填充颜色" type="color" value={colorValue(selected?.fill, '#ffffff')} disabled={saving} onChange={event => onChange({ fill: event.target.value })} /></label>}
      {line && <><label className="studio-format-color is-stroke" title="边框颜色"><input aria-label="边框颜色" type="color" value={colorValue(selected?.stroke, '#4f5d75')} disabled={saving} onChange={event => onChange({ stroke: event.target.value })} /></label><select aria-label="线条宽度" title="线条宽度" value={Number(selected?.strokeWidth ?? selected?.width ?? (selected?.type === 'stroke' ? 3 : 1.8))} disabled={saving} onChange={event => onChange({ strokeWidth: Number(event.target.value) })}>{[1, 1.4, 1.8, 2, 3, 4, 6, 8, ...(selected?.strokeWidth ? [Number(selected.strokeWidth)] : [])].filter((value, index, values) => values.indexOf(value) === index).sort((a, b) => a - b).map(width => <option key={width} value={width}>{width}</option>)}</select></>}
    </>}
    <span className="studio-tool-divider" />
    {canAnnotate && <button type="button" aria-label="备注所选元素" title="备注" onClick={onAnnotate}><MessageSquare size={18} /></button>}
    {canEdit && <button type="button" aria-label={allLocked ? '解锁元素' : '锁定元素'} title={allLocked ? '解锁位置' : '锁定位置与尺寸'} aria-pressed={allLocked} className={allLocked ? 'is-active' : ''} disabled={saving} onClick={() => onChange({ locked: !allLocked })}>{allLocked ? <Unlock size={18} /> : <Lock size={18} />}</button>}
    <button type="button" aria-label="更多元素属性" title="更多" onClick={onMore}><MoreHorizontal size={19} /></button>
    {linkOpen && <form className="studio-format-link" onSubmit={event => { event.preventDefault(); if (/^https?:\/\//i.test(link)) { onTextFormat('link', link); setLinkOpen(false); } }}><input autoFocus type="url" aria-label="文字链接地址" placeholder="https://" value={link} onChange={event => setLink(event.target.value)} /><button type="submit" disabled={saving || !/^https?:\/\//i.test(link)}>应用</button></form>}
  </div>;
}
