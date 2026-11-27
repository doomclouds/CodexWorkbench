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
  createCommandId,
  downloadBoardFile,
  isGuestAccessDenied,
  postArchive,
  postGuestProtobuf,
  postProtobuf,
  prepareBoardImage,
  readHtmlSource,
  readPreferences,
  readStudioGuestEntry,
  readStudioLocation,
  rememberLayout,
  rememberTheme,
  replaceStudioGuestLocation,
  resolveArchiveAssetUrl,
  subscribeGuestAccessRefresh,
  subscribeGuestRoomEvents,
  subscribeRoomEvents,
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
const editService = createWhiteboardEditService(postProtobuf, resolveArchiveAssetUrl);
const historyService = createBoardHistoryService(postProtobuf, resolveArchiveAssetUrl);
const feedbackService = createBoardFeedbackService(postProtobuf);
const suggestions = createSuggestionService(postProtobuf, editService, resolveArchiveAssetUrl);
const catalog = createBoardCatalogService(postProtobuf);
const catalogManagement = createCatalogManagementService(postProtobuf);
const archiveImport = createArchiveImportService(postArchive, postProtobuf);
const sharingService = createBoardSharingService(postProtobuf);
const roomService = createBoardRoomService(postProtobuf, subscribeRoomEvents);
const guestRoomService = createBoardRoomService(postGuestProtobuf, subscribeGuestRoomEvents);

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
  exportBoard: createWhiteboardExportService(postGuestProtobuf),
  editService: createWhiteboardEditService(postGuestProtobuf, resolveArchiveAssetUrl),
  historyService: createBoardHistoryService(postGuestProtobuf, resolveArchiveAssetUrl),
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
    editService={editService}
    historyService={historyService}
    feedbackService={feedbackService}
    suggestions={suggestions}
    onAttachReviewSource={copyReviewSource}
    reviewSourceMode="copy"
    createRoomSession={roomFactory(roomService)}
    prepareImage={prepareBoardImage}
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
    preferences={{ ...readPreferences(), rememberLayout, rememberTheme }}
  />,
);
