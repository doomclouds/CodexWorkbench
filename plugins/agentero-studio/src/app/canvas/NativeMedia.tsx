import { useEffect, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import type { BoardElement } from '../../contracts/studio.js';

export interface ImageCrop { zoom: number; x: number; y: number }
export function imageCrop(value: unknown): ImageCrop {
  const crop = value && typeof value === 'object' ? value as Partial<ImageCrop> : {};
  return { zoom: typeof crop.zoom === 'number' && Number.isFinite(crop.zoom) ? Math.max(1, crop.zoom) : 1, x: typeof crop.x === 'number' && Number.isFinite(crop.x) ? Math.max(0, Math.min(1, crop.x)) : .5, y: typeof crop.y === 'number' && Number.isFinite(crop.y) ? Math.max(0, Math.min(1, crop.y)) : .5 };
}
export function imageCropRect(frame: { w: number; h: number }, natural: { w: number; h: number }, crop: ImageCrop) {
  const scale = Math.max(frame.w / Math.max(1, natural.w), frame.h / Math.max(1, natural.h)) * crop.zoom;
  const w = natural.w * scale, h = natural.h * scale;
  return { x: (frame.w - w) * crop.x, y: (frame.h - h) * crop.y, w, h };
}

export function CroppedImage({ element, src, onNaturalSize }: { element: BoardElement; src: string; onNaturalSize?: (size: { w: number; h: number }) => void }) {
  const [natural, setNatural] = useState({ w: Number(element.data?.naturalWidth) || element.w, h: Number(element.data?.naturalHeight) || element.h });
  useEffect(() => { setNatural({ w: Number(element.data?.naturalWidth) || element.w, h: Number(element.data?.naturalHeight) || element.h }); }, [src, element.data?.naturalWidth, element.data?.naturalHeight]);
  const rect = element.crop ? imageCropRect(element, natural, imageCrop(element.crop)) : null;
  const style: CSSProperties = rect ? { position: 'absolute', left: `${rect.x / element.w * 100}%`, top: `${rect.y / element.h * 100}%`, width: `${rect.w / element.w * 100}%`, height: `${rect.h / element.h * 100}%`, maxWidth: 'none' } : { width: '100%', height: '100%', objectFit: 'contain' };
  return <div className="studio-image-frame"><img src={src} alt={element.text || '白板图片'} draggable={false} style={style} onLoad={event => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) { const size = { w: image.naturalWidth, h: image.naturalHeight }; setNatural(size); onNaturalSize?.(size); }
  }} /></div>;
}

export function ImageCropDialog({ element, src, onClose, onSave, onDirtyChange }: { element: BoardElement; src: string; onClose: () => void; onSave: (changes: Partial<BoardElement>) => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const [crop, setCrop] = useState(() => imageCrop(element.crop));
  const [natural, setNatural] = useState({ w: Number(element.data?.naturalWidth) || 0, h: Number(element.data?.naturalHeight) || 0 });
  const [busy, setBusy] = useState(false);
  const original = JSON.stringify(element.crop ?? null);
  useEffect(() => { onDirtyChange(JSON.stringify(crop) !== original); }, [crop, original, onDirtyChange]);
  const ratio = Math.min(1, 480 / Math.max(1, element.w), 300 / Math.max(1, element.h));
  const save = async () => {
    if (busy || !natural.w || !natural.h) return;
    setBusy(true);
    try { await onSave({ crop, data: { ...element.data, naturalWidth: natural.w, naturalHeight: natural.h } }); } finally { setBusy(false); }
  };
  return <div className="studio-canvas-modal-backdrop" data-native-interactive="true"><section className="studio-canvas-modal is-wide" role="dialog" aria-modal="true" aria-label="裁剪图片">
    <header><h2>裁剪图片</h2><button type="button" aria-label="关闭裁剪" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="studio-crop-preview" style={{ width: element.w * ratio, height: element.h * ratio }}><CroppedImage element={{ ...element, crop }} src={src} onNaturalSize={setNatural} /></div>
    <p>缩放图片，并调整画面位置。裁剪只改变显示范围，原始图片保持完整。</p>
    <label>缩放 · {crop.zoom.toFixed(2)} 倍<input aria-label="裁剪缩放" type="range" min={1} max={Math.max(10, crop.zoom)} step={.05} value={crop.zoom} disabled={busy} onChange={event => setCrop(value => ({ ...value, zoom: Number(event.target.value) }))} /></label>
    <label>水平位置 · {Math.round(crop.x * 100)}%<input aria-label="裁剪水平位置" type="range" min={0} max={1} step={.01} value={crop.x} disabled={busy} onChange={event => setCrop(value => ({ ...value, x: Number(event.target.value) }))} /></label>
    <label>垂直位置 · {Math.round(crop.y * 100)}%<input aria-label="裁剪垂直位置" type="range" min={0} max={1} step={.01} value={crop.y} disabled={busy} onChange={event => setCrop(value => ({ ...value, y: Number(event.target.value) }))} /></label>
    <footer><button type="button" disabled={busy} onClick={() => setCrop({ zoom: 1, x: .5, y: .5 })}>居中重置</button><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="studio-primary" disabled={busy || !natural.w || !natural.h} onClick={() => void save()}>{busy ? '正在保存…' : '保存裁剪'}</button></footer>
  </section></div>;
}
