import type { ImageCrop, MediaSize } from './contracts.js';

export const centeredCrop: ImageCrop = { zoom: 1, x: 0.5, y: 0.5 };

function unitPosition(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : centeredCrop.x;
}

export function normalizeCrop(crop: ImageCrop | undefined): ImageCrop {
  if (!crop) {
    return centeredCrop;
  }

  return {
    zoom: Number.isFinite(crop.zoom) ? Math.max(1, crop.zoom) : centeredCrop.zoom,
    x: unitPosition(crop.x),
    y: unitPosition(crop.y),
  };
}

export function validMediaSize(value: MediaSize | undefined): value is MediaSize {
  return (
    value !== undefined &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}
