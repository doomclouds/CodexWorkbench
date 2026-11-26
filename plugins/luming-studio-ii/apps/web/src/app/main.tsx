import { createRoot } from 'react-dom/client';
import { createArchiveImportService } from '../data/archive-import/index.js';
import { createBoardCatalogService } from '../data/catalog/index.js';
import { createWhiteboardService } from '../data/whiteboard/index.js';
import {
  createCommandId,
  postArchive,
  postProtobuf,
  readBoardId,
  readPreferences,
  rememberLayout,
  rememberTheme,
  subscribeBoardLocation,
  writeBoardLocation,
} from '../platform/browser/index.js';
import { StudioApp } from './index.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少白板页面挂载点。');
}

const service = createWhiteboardService(postProtobuf);
const catalog = createBoardCatalogService(postProtobuf);
const archiveImport = createArchiveImportService(postArchive, postProtobuf);

createRoot(container).render(
  <StudioApp
    catalog={catalog}
    service={service}
    archiveImport={archiveImport}
    createCommandId={createCommandId}
    navigation={{ read: readBoardId, write: writeBoardLocation, subscribe: subscribeBoardLocation }}
    preferences={{ ...readPreferences(), rememberLayout, rememberTheme }}
  />,
);
