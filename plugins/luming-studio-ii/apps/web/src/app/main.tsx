import { createRoot } from 'react-dom/client';
import { createArchiveImportService } from '../data/archive-import/index.js';
import {
  createBoardCatalogService,
  createCatalogManagementService,
} from '../data/catalog/index.js';
import { createBoardFeedbackService } from '../data/feedback/index.js';
import {
  createBoardRoomService,
  createBoardRoomSession,
  createBoardRoomStream,
  type BoardRoomService,
} from '../data/rooms/index.js';
import { createBoardSharingService } from '../data/sharing/index.js';
import { createSuggestionService, type AttachedReviewSource } from '../data/suggestions/index.js';
import {
  createBoardHistoryService,
  createWhiteboardEditService,
  createWhiteboardExportService,
  createWhiteboardService,
} from '../data/whiteboard/index.js';
import {
  boardRoomClock,
  copyShareLink,
  createBoardDraftStorage,
  createCommandId,
  createRoomStreamTransport,
  downloadBoardFile,
  isGuestAccessDenied,
  postArchive,
  postGuestProtobuf,
  postProtobuf,
  prepareBoardImage,
  prepareBoardVideo,
  readCanvasClipboard,
  readArchivedDocumentAsset,
  readDocumentImageFile,
  readHtmlSource,
  readPreferences,
  readStudioGuestEntry,
  readStudioLocation,
  rememberLayout,
  rememberTheme,
  renderBrowserVectorExport,
  replaceStudioGuestLocation,
  resolveArchiveAssetUrl,
  subscribeGuestAccessRefresh,
  subscribeStudioLocation,
  subscribeTheme,
  writeStudioLocation,
} from '../platform/browser/index.js';
import { StudioApp } from './index.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少白板页面挂载点。');
}

const service = createWhiteboardService(postProtobuf, resolveArchiveAssetUrl);
const exportBoard = createWhiteboardExportService(postProtobuf, renderBrowserVectorExport);
const editService = createWhiteboardEditService(postProtobuf, resolveArchiveAssetUrl);
const historyService = createBoardHistoryService(
  postProtobuf,
  resolveArchiveAssetUrl,
  renderBrowserVectorExport,
);
const feedbackService = createBoardFeedbackService(postProtobuf);
const suggestions = createSuggestionService(postProtobuf, editService, resolveArchiveAssetUrl);
const catalog = createBoardCatalogService(postProtobuf);
const catalogManagement = createCatalogManagementService(postProtobuf);
const archiveImport = createArchiveImportService(postArchive, postProtobuf);
const sharingService = createBoardSharingService(postProtobuf);
const roomService = createBoardRoomService(
  postProtobuf,
  createBoardRoomStream(createRoomStreamTransport('owner')),
);
const guestRoomService = createBoardRoomService(
  postGuestProtobuf,
  createBoardRoomStream(createRoomStreamTransport('guest')),
);

function roomFactory(service: BoardRoomService) {
  return (boardId: string) =>
    createBoardRoomSession({
      boardId,
      viewId: createCommandId(),
      service,
      clock: boardRoomClock,
    });
}

const guest = {
  sharingService: createBoardSharingService(postGuestProtobuf),
  service: createWhiteboardService(postGuestProtobuf, resolveArchiveAssetUrl),
  exportBoard: createWhiteboardExportService(postGuestProtobuf, renderBrowserVectorExport),
  editService: createWhiteboardEditService(postGuestProtobuf, resolveArchiveAssetUrl),
  historyService: createBoardHistoryService(
    postGuestProtobuf,
    resolveArchiveAssetUrl,
    renderBrowserVectorExport,
  ),
  feedbackService: createBoardFeedbackService(postGuestProtobuf),
  createRoomSession: roomFactory(guestRoomService),
  readEntry: readStudioGuestEntry,
  replaceEntry: replaceStudioGuestLocation,
  isAccessDenied: isGuestAccessDenied,
  subscribeRefresh: subscribeGuestAccessRefresh,
};

function copyReviewSource({
  boardId,
  sourceId,
  capturedBoardRevision,
  targetsBoardRevision,
  targets,
}: AttachedReviewSource & { readonly boardId: string }) {
  return copyShareLink(
    JSON.stringify({
      boardId,
      sourceId,
      capturedBoardRevision: capturedBoardRevision.toString(),
      targetsBoardRevision: targetsBoardRevision.toString(),
      targets: targets.map(({ objectId, kind, geometryVersion, payloadVersion, geometry }) => ({
        objectId,
        kind,
        geometryVersion: geometryVersion.toString(),
        payloadVersion: payloadVersion?.toString(),
        geometry,
      })),
    }),
  );
}

createRoot(container).render(
  <StudioApp
    catalog={catalog}
    catalogManagement={catalogManagement}
    service={service}
    exportBoard={exportBoard}
    downloadExport={downloadBoardFile}
    downloadObjectFile={downloadBoardFile}
    clipboard={{ writeText: copyShareLink, readText: readCanvasClipboard }}
    localDrafts={{ actorId: 'owner', storage: createBoardDraftStorage(createCommandId) }}
    readDocumentAsset={readArchivedDocumentAsset}
    readDocumentImageFile={readDocumentImageFile}
    editService={editService}
    historyService={historyService}
    feedbackService={feedbackService}
    suggestions={suggestions}
    onAttachReviewSource={copyReviewSource}
    reviewSourceMode="copy"
    createRoomSession={roomFactory(roomService)}
    prepareImage={prepareBoardImage}
    prepareVideo={prepareBoardVideo}
    readHtmlSource={readHtmlSource}
    archiveImport={archiveImport}
    sharingService={sharingService}
    copyShareLink={copyShareLink}
    guest={guest}
    createCommandId={createCommandId}
    navigation={{
      read: readStudioLocation,
      write: writeStudioLocation,
      subscribe: subscribeStudioLocation,
    }}
    preferences={{ ...readPreferences(), rememberLayout, rememberTheme, subscribeTheme }}
  />,
);
