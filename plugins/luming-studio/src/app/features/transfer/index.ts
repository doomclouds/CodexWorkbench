import { STUDIO_HOME_TITLE } from '../../../contracts/branding.js';
import { STUDIO_TOOLS, type Artifact, type StudioClient } from '../../../contracts/studio';
import type { ProductDescriptor, StudioDocument } from '../../product-contract';
import type { StudioViewRequests } from '../../shared/studio-view-scope';
import { downloadStudioFile, studioRequest } from '../../transport/client';

export { downloadBoard } from './download-board';

type ExportDocument = ProductDescriptor['exportDocument'];

export type StudioExportFormat = Parameters<ExportDocument>[1] | 'zip';

interface TransferOptions {
  client: StudioClient;
  canManage: boolean;
  busy: string;
  setBusy: (busy: string) => void;
  clearError: () => void;
  reportError: (cause: unknown) => void;
  inform: (message: string) => void;
  scope: StudioViewRequests;
  isMounted: () => boolean;
  getDocument: () => StudioDocument | null;
  resolveProduct: (type: string) => Pick<ProductDescriptor, 'exportDocument'> | undefined;
  openArtifact: (id: string, document?: StudioDocument) => void;
}

interface ArchiveImportResult {
  ok: boolean;
  data?: { artifact: Artifact; document?: StudioDocument; board?: StudioDocument };
  error?: { message?: string };
}

const archiveSizeLimit = 128 * 1024 * 1024;

export function createTransferActions({
  client,
  canManage,
  busy,
  setBusy,
  clearError,
  reportError,
  inform,
  scope,
  isMounted,
  getDocument,
  resolveProduct,
  openArtifact,
}: TransferOptions) {
  async function importArchive(file: File) {
    if (!canManage || busy) {
      return;
    }

    if (file.size > archiveSizeLimit) {
      reportError(new Error('作品备份超过 128 MB。'));

      return;
    }

    const route = scope.capture();
    setBusy('import');
    clearError();
    try {
      const response = await studioRequest(client, `${client.baseUrl}/api/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/zip' },
        body: file,
      });
      const result = (await response.json()) as ArchiveImportResult;

      if (!result.ok || !result.data) {
        throw new Error(result.error?.message || '作品备份未能导入。');
      }
      if (!isMounted()) {
        return;
      }

      if (!scope.isCurrent(route)) {
        inform(`作品已导入，可从 ${STUDIO_HOME_TITLE} 打开。`);

        return;
      }

      openArtifact(result.data.artifact.id, result.data.document || result.data.board);
      inform('作品已导入，原作品保持完整。');
    } catch (cause) {
      reportError(cause);
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  async function exportBoard(format: StudioExportFormat) {
    const current = getDocument();
    if (!current || busy) {
      return;
    }

    const product = resolveProduct(current.artifact.type);
    if (!product) {
      return;
    }

    setBusy('export');
    clearError();
    try {
      if (format === 'zip') {
        const result = await client.call<{ filename: string; downloadPath: string }>(
          STUDIO_TOOLS.export,
          { artifactId: current.artifact.id, format },
        );
        await downloadStudioFile(client, result.downloadPath, result.filename);
      } else {
        await product.exportDocument(current, format, client);
      }

      inform('导出已生成。');
    } catch (cause) {
      reportError(cause);
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  return { importArchive, exportBoard };
}
