import { createRoot } from 'react-dom/client';
import { createArchiveImportService } from '../data/archive-import/index.js';
import {
  createBoardCatalogService,
  createCatalogManagementService,
} from '../data/catalog/index.js';
import {
  createWhiteboardExportService,
  createWhiteboardService,
} from '../data/whiteboard/index.js';
import {
  createCommandId,
  downloadBoardFile,
  postArchive,
  postProtobuf,
  readPreferences,
  readStudioLocation,
  rememberLayout,
  rememberTheme,
  resolveArchiveAssetUrl,
  subscribeStudioLocation,
  writeStudioLocation,
} from '../platform/browser/index.js';
import { StudioApp } from './index.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少白板页面挂载点。');
}

const service = createWhiteboardService(postProtobuf, resolveArchiveAssetUrl);
const exportBoard = createWhiteboardExportService(postProtobuf);
const catalog = createBoardCatalogService(postProtobuf);
const catalogManagement = createCatalogManagementService(postProtobuf);
const archiveImport = createArchiveImportService(postArchive, postProtobuf);

createRoot(container).render(
  <StudioApp
    catalog={catalog}
    catalogManagement={catalogManagement}
    service={service}
    exportBoard={exportBoard}
    downloadExport={downloadBoardFile}
    archiveImport={archiveImport}
    createCommandId={createCommandId}
    navigation={{
      read: readStudioLocation,
      write: writeStudioLocation,
      subscribe: subscribeStudioLocation,
    }}
    preferences={{ ...readPreferences(), rememberLayout, rememberTheme }}
  />,
);
