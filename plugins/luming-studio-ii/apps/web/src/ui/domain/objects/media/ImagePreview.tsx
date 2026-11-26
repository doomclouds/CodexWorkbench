import type { CSSProperties, SyntheticEvent } from 'react';
import type { ImageCrop, MediaSize } from './contracts.js';
import { imageCropRect, validMediaSize } from './media-geometry.js';

export interface ImagePreviewProps {
  readonly src: string;
  readonly label: string;
  readonly frame: MediaSize;
  readonly naturalSize?: MediaSize;
  readonly crop?: ImageCrop;
  readonly onNaturalSize: (size: MediaSize) => void;
  readonly onError?: () => void;
  readonly onRequestCrop?: () => void;
}

function cropStyle(props: ImagePreviewProps): CSSProperties | undefined {
  const { frame, naturalSize, crop } = props;
  if (!crop || !validMediaSize(frame)) {
    return undefined;
  }

  const rect = imageCropRect(frame, validMediaSize(naturalSize) ? naturalSize : frame, crop);
  const percent = (value: number) => value * 100 + '%';

  return {
    position: 'absolute',
    left: percent(rect.x / frame.width),
    top: percent(rect.y / frame.height),
    width: percent(rect.width / frame.width),
    height: percent(rect.height / frame.height),
    maxWidth: 'none',
  };
}

export function ImagePreview(props: ImagePreviewProps) {
  const { src, label, onNaturalSize, onError, onRequestCrop } = props;

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    const size = { width, height };
    if (validMediaSize(size)) {
      onNaturalSize(size);
    }
  }

  return (
    <div className="luming-image-frame">
      <img
        src={src}
        alt={label || '白板图片'}
        draggable={false}
        style={cropStyle(props)}
        onLoad={handleLoad}
        onError={onError}
        onDoubleClick={onRequestCrop}
      />
    </div>
  );
}
