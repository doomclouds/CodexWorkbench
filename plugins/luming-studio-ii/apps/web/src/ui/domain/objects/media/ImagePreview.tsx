import type { CSSProperties, SyntheticEvent } from 'react';
import type { ImageCrop, MediaSize } from './contracts.js';
import { normalizeCrop, validMediaSize } from './media-geometry.js';

export interface ImagePreviewProps {
  readonly src: string;
  readonly label: string;
  readonly crop?: ImageCrop;
  readonly onNaturalSize: (size: MediaSize) => void;
  readonly onError?: () => void;
  readonly onRequestCrop?: () => void;
}

function cropStyle(crop: ImageCrop | undefined): CSSProperties | undefined {
  if (!crop) {
    return undefined;
  }

  const { zoom, x, y } = normalizeCrop(crop);
  const percent = (value: number) => value * 100 + '%';
  const size = percent(zoom);

  return {
    position: 'absolute',
    left: percent((1 - zoom) * x),
    top: percent((1 - zoom) * y),
    width: size,
    height: size,
    maxWidth: 'none',
    objectFit: 'cover',
    objectPosition: percent(x) + ' ' + percent(y),
  };
}

export function ImagePreview({
  src,
  label,
  crop,
  onNaturalSize,
  onError,
  onRequestCrop,
}: ImagePreviewProps) {
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
        alt={label}
        draggable={false}
        style={cropStyle(crop)}
        onLoad={handleLoad}
        onError={onError}
        onDoubleClick={onRequestCrop}
      />
    </div>
  );
}
