import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Range, StatusText } from '../../../base/index.js';
import type { ImageCrop, MediaSize, SaveImageCrop } from './contracts.js';
import { ImagePreview } from './ImagePreview.js';
import { centeredCrop, normalizeCrop, validMediaSize } from './media-geometry.js';

interface ImageCropDialogProps {
  readonly src: string;
  readonly label: string;
  readonly frame: MediaSize;
  readonly initialCrop?: ImageCrop;
  readonly naturalSize?: MediaSize;
  readonly onActivityChange?: (active: boolean) => void;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
  readonly onSave: SaveImageCrop;
}

const saveFailureMessage = '保存裁剪失败。';
const previewMaximum = { width: 480, height: 300 };

export function ImageCropDialog({
  src,
  label,
  frame,
  initialCrop,
  naturalSize,
  onActivityChange,
  onClose,
  onRestoreFocus,
  onSave,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState(() => normalizeCrop(initialCrop));
  const [saveCrop] = useState(() => onSave);
  const [decodedSize, setDecodedSize] = useState<MediaSize>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const savePending = useRef(false);
  const natural = decodedSize ?? naturalSize;
  const previewScale = Math.min(
    1,
    previewMaximum.width / Math.max(1, frame.width),
    previewMaximum.height / Math.max(1, frame.height),
  );

  useEffect(() => {
    onActivityChange?.(true);

    return () => onActivityChange?.(false);
  }, [onActivityChange]);

  function handleClose() {
    if (!savePending.current) {
      onClose();
    }
  }

  async function save() {
    if (savePending.current || !validMediaSize(natural)) {
      return;
    }

    savePending.current = true;
    setBusy(true);
    setError('');
    try {
      const confirmed = await saveCrop({ crop, naturalSize: natural });
      if (confirmed === false) {
        setError(saveFailureMessage);
      } else {
        onClose();
      }
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : saveFailureMessage);
    } finally {
      savePending.current = false;
      setBusy(false);
    }
  }

  function change(field: keyof ImageCrop, next: number) {
    setCrop((current) => ({ ...current, [field]: next }));
  }

  return (
    <Dialog
      open
      title="裁剪图片"
      closeLabel="关闭裁剪"
      dismissPolicy={{ escape: !busy }}
      onRequestClose={handleClose}
      restoreFocus={onRestoreFocus}
    >
      <div className="luming-image-crop" data-canvas-native="">
        <div
          className="luming-image-crop__preview"
          style={{ width: frame.width * previewScale, aspectRatio: frame.width / frame.height }}
        >
          <ImagePreview
            src={src}
            label={label}
            frame={frame}
            naturalSize={natural}
            crop={crop}
            onNaturalSize={setDecodedSize}
          />
        </div>
        <p className="luming-image-crop__hint">
          缩放图片，并调整画面位置。裁剪只改变显示范围，原始图片保持完整。
        </p>
        <Range
          label="裁剪缩放"
          min={1}
          max={Math.max(10, crop.zoom)}
          step={0.05}
          value={crop.zoom}
          unit="倍"
          disabled={busy}
          onValueChange={(next) => change('zoom', next)}
        />
        <Range
          label="裁剪水平位置"
          min={0}
          max={100}
          value={Math.round(crop.x * 100)}
          unit="%"
          disabled={busy}
          onValueChange={(next) => change('x', next / 100)}
        />
        <Range
          label="裁剪垂直位置"
          min={0}
          max={100}
          value={Math.round(crop.y * 100)}
          unit="%"
          disabled={busy}
          onValueChange={(next) => change('y', next / 100)}
        />
        {error && <StatusText message={error} tone="error" announcement="assertive" />}
        <div className="luming-image-crop__actions">
          <Button label="居中重置" disabled={busy} onActivate={() => setCrop(centeredCrop)} />
          <Button label="取消" disabled={busy} onActivate={handleClose} />
          <Button
            label={busy ? '正在保存…' : '保存裁剪'}
            variant="primary"
            disabled={!validMediaSize(natural)}
            busy={busy}
            onActivate={() => void save()}
          />
        </div>
      </div>
    </Dialog>
  );
}
