import type { ExportOptions } from '../../shared/serialization.js';

export type SvgPngRenderer = (
  svg: string,
  options?: Pick<ExportOptions, 'scale'>,
  maxPixels?: number,
) => Promise<{ bytes: Buffer; width: number; height: number }>;
