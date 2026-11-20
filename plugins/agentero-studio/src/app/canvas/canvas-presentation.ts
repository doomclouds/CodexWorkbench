type Size = { w: number; h: number };
export type TableDetail = 'full' | 'preview' | 'outline';

export function projectedSize(size: Size, zoom: number): Size {
  return { w: size.w * zoom, h: size.h * zoom };
}

export function canReadCanvasText(size: Size, fontSize: number, zoom: number): boolean {
  return size.w >= 32 && size.h >= 12 && fontSize * zoom >= 8;
}

export function tableDetail(size: Size, fontSize: number, zoom: number): TableDetail {
  if (size.w < 96 || size.h < 44) return 'outline';
  if (size.w < 240 || size.h < 96 || fontSize * zoom < 8) return 'preview';
  return 'full';
}

export function mediaControlsFit(size: Size): boolean {
  return size.w >= 128 && size.h >= 72;
}

export function overviewStrokeWidth(width: number, zoom: number): number {
  return zoom < .5 ? Math.max(width, .7 / zoom) : width;
}

export function canvasGridSpacing(zoom: number): number {
  const spacing = 24 * zoom;
  return spacing >= 8 ? spacing : spacing * 2 ** Math.ceil(Math.log2(8 / spacing));
}
