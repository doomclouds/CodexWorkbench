import { maxExportFileBytes, type ExportBoardResult } from '../domain/index.js';

export type SvgPngRenderer = (svg: string) => Promise<Uint8Array | undefined>;

export async function renderExportPng(
  source: ExportBoardResult,
  render: SvgPngRenderer | undefined,
  assertAccess: () => void,
): Promise<ExportBoardResult> {
  if (source.kind !== 'file') {
    return source;
  }
  if (!render) {
    return { kind: 'rejected', reason: 'unsupported' };
  }

  const content = await render(new TextDecoder().decode(source.content));
  if (!content || !content.byteLength || content.byteLength > maxExportFileBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  assertAccess();

  return {
    ...source,
    filename: source.filename.slice(0, -4) + '.png',
    mimeType: 'image/png',
    content,
  };
}
