import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
const boundary = 'frontend/contract-boundary';
const surface = 'src/surfaces/whiteboard-editor/Editor.tsx';
const surfaceEntry = 'src/surfaces/whiteboard-editor/index.ts';
const page = 'src/pages/whiteboard/WhiteboardPage.tsx';
const data = 'src/data/whiteboard/client.ts';
const platform = 'src/platform/transport/index.ts';
const integration = 'tests/integration/whiteboard-editor.test.tsx';
const support = 'tests/support/app-mock.tsx';
const protocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
const connectorRoute = '@codexworkbench/luming-studio-ii-contracts/whiteboard/connector-route';
const connectorGeometry = 'src/ui/domain/canvas/connectors/geometry.ts';
const connectorPath = 'src/ui/domain/canvas/connectors/path.ts';
const workbench = 'src/surfaces/workbench/Workbench.tsx';
const workbenchPage = 'src/pages/workbench/WorkbenchPage.tsx';
const workbenchMount = 'src/surfaces/workbench/WorkbenchSurface.tsx';
const workbenchCard = 'src/surfaces/workbench/WorkbenchCards.tsx';
const workbenchCopy = 'src/surfaces/workbench/useBoardCopy.ts';
const catalog = 'src/data/catalog/client.ts';
const catalogProtocol = '@codexworkbench/luming-studio-ii-contracts/catalog/service';
const archiveWorkflow = 'src/app/workflows/archive-import/useArchiveImport.ts';
const archiveData = 'src/data/archive-import/client.ts';
const archiveProtocol = '@codexworkbench/luming-studio-ii-contracts/archives/service';
const routes = 'src/app/routes.ts';
const appShell = 'src/app/shell/AppShell.tsx';
const operationNotice = 'src/app/shell/operation-notice/OperationNoticeSlot.tsx';
const recycleBin = 'src/surfaces/recycle-bin/RecycleBinSurface.tsx';
const viewer = 'src/surfaces/whiteboard-viewing/WhiteboardViewingSurface.tsx';
const exportPanel = 'src/surfaces/whiteboard-export/WhiteboardExportSurface.tsx';
const history = 'src/surfaces/whiteboard-history/WhiteboardHistorySurface.tsx';
const feedback = 'src/surfaces/whiteboard-feedback/WhiteboardFeedbackSurface.tsx';
const feedbackPinCluster = 'src/surfaces/whiteboard-feedback/FeedbackPinCluster.tsx';
const media = 'src/surfaces/whiteboard-media/WhiteboardMediaSurface.tsx';
const feedbackData = 'src/data/feedback/client.ts';
const editsProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
const historyProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
const feedbackProtocol = '@codexworkbench/luming-studio-ii-contracts/feedback/service';
const sharingProtocol = '@codexworkbench/luming-studio-ii-contracts/sharing/service';
const sharing = 'src/surfaces/board-sharing/BoardSharingSurface.tsx';
const guestJoin = 'src/surfaces/guest-join/GuestJoinSurface.tsx';
const sharingData = 'src/data/sharing/client.ts';
const roomProtocol = '@codexworkbench/luming-studio-ii-contracts/rooms/service';
const roomsData = 'src/data/rooms/client.ts';
const roomMessage = 'src/data/rooms/room-message.ts';
const roomStreamData = 'src/data/rooms/stream.ts';
const roomStreamBrowser = 'src/platform/browser/room-stream.ts';
const connect = '@connectrpc/connect';
const connectWeb = '@connectrpc/connect-web';
const roomPresence = 'src/surfaces/room-presence/RoomPresenceSurface.tsx';
const sharedTimer = 'src/surfaces/shared-timer/SharedTimerSurface.tsx';
const mcpMain = 'src/app/mcp-main.tsx';
const mcpAdapter = 'src/platform/mcp/bridge.ts';
const mcpEntry = 'src/platform/mcp/index.ts';
const browserEntry = 'src/platform/browser/index.ts';
const mcpSdk = '@modelcontextprotocol/ext-apps';
const hostSdk = '@openai/mcp-extensions/app';
const suggestionsProtocol = '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
const suggestions = 'src/surfaces/board-suggestions/BoardSuggestionsSurface.tsx';
const suggestionsData = 'src/data/suggestions/client.ts';
const suggestionContracts = 'src/data/suggestions/contracts.ts';
const suggestionPreview = 'src/surfaces/whiteboard-editor/suggestion-preview.tsx';
const editorContent = 'src/surfaces/whiteboard-editor/use-content-edits.ts';
const editorCommand = 'src/surfaces/whiteboard-editor/content-edit-command.ts';
const editorMount = 'src/surfaces/whiteboard-editor/WhiteboardEditorSurface.tsx';
const historyMount = 'src/surfaces/whiteboard-editor/HistoryCanvasView.tsx';
const actualPages = [
  "import { WhiteboardPage } from '../pages/whiteboard/index.js';",
  "import { WorkbenchPage } from '../pages/workbench/index.js';",
  '',
  'export const studioPages = { workbench: WorkbenchPage, whiteboard: WhiteboardPage };',
].join('\n');

const accepted = [
  ['src/data/catalog/preferences.ts', `import { BoardCatalogService } from '${catalogProtocol}';`],
  [connectorGeometry, `import { routeConnector } from '${connectorRoute}';`],
  [connectorPath, `import { routeConnector, type ConnectorRouteInput } from '${connectorRoute}';`],
  [
    suggestionsData,
    "import { readBoardEditChanges, readBoardEditReceipt, type WhiteboardEditService } from '../whiteboard/index.js';",
  ],
  [suggestionContracts, "import type { BoardEditReceipt } from '../whiteboard/index.js';"],
  [
    suggestionPreview,
    "import { projectBoardChanges, type WhiteboardPayloadResult, type WhiteboardReadyState } from '../../data/whiteboard/index.js';",
  ],
  [page, "import { BoardSuggestionsSurface } from '../../surfaces/board-suggestions/index.js';"],
  [suggestions, "import type { SuggestionService } from '../../data/suggestions/index.js';"],
  [suggestions, "import { createPortal } from 'react-dom';"],
  [suggestionsData, `import { BoardSuggestionsService } from '${suggestionsProtocol}';`],
  ['src/app/main.tsx', "import { createSuggestionService } from '../data/suggestions/index.js';"],
  [mcpMain, "import { createSuggestionService } from '../data/suggestions/index.js';"],
  [
    'tests/integration/board-suggestions.test.tsx',
    `import { BoardSuggestionsService } from '${suggestionsProtocol}';`,
  ],
  [roomMessage, "import { readObjects, type WhiteboardObject } from '../whiteboard/index.js';"],
  [roomMessage, "import type { WhiteboardObject } from '../whiteboard/index.js';"],
  [mcpAdapter, `import { App } from '${mcpSdk}';`],
  [mcpAdapter, `import { OpenAIExtensions } from '${hostSdk}';`],
  [mcpAdapter, 'const host = window.openai;'],
  [mcpEntry, "export { connectMcpApp } from './bridge.js';"],
  [mcpMain, "import { StudioApp } from './StudioApp.js';"],
  [mcpMain, "import { connectMcpApp } from '../platform/mcp/index.js';"],
  [mcpMain, "import { downloadBoardFile } from '../platform/browser/index.js';"],
  [mcpMain, "import { createBoardRoomService } from '../data/rooms/index.js';"],
  [mcpMain, "import { createBoardSharingService } from '../data/sharing/index.js';"],
  [page, "import { RoomPresenceSurface } from '../../surfaces/room-presence/index.js';"],
  [page, "import { SharedTimerSurface } from '../../surfaces/shared-timer/index.js';"],
  [roomPresence, "import type { BoardRoomService } from '../../data/rooms/index.js';"],
  [sharedTimer, "import type { RoomTimer } from '../../data/rooms/index.js';"],
  [roomsData, `import { BoardRoomService } from '${roomProtocol}';`],
  [roomsData, "import { fromJsonString } from '@bufbuild/protobuf';"],
  [
    roomStreamData,
    `import { Code, ConnectError, createClient, type Transport } from '${connect}';`,
  ],
  [roomStreamBrowser, `import { createGrpcWebTransport } from '${connectWeb}';`],
  ['src/app/main.tsx', "import { createBoardRoomService } from '../data/rooms/index.js';"],
  ['src/platform/browser/room-events.ts', 'const source = new EventSource(path);'],
  ['tests/integration/board-room.test.tsx', `import { BoardRoomService } from '${roomProtocol}';`],
  [page, "import { BoardSharingSurface } from '../../surfaces/board-sharing/index.js';"],
  [appShell, "import { GuestJoinSurface } from '../../surfaces/guest-join/index.js';"],
  [appShell, "import type { GuestAccess } from '../../data/sharing/index.js';"],
  [sharing, "import type { SharingService } from '../../data/sharing/index.js';"],
  [guestJoin, "import type { GuestAccess } from '../../data/sharing/index.js';"],
  [guestJoin, "import { ShieldAlert, WifiOff } from 'lucide-react';"],
  [guestJoin, 'const source = new URL(inviteUrl);'],
  [guestJoin, 'const location = new URL(inviteUrl);\n\nconst source = location.href;'],
  [
    'src/app/StudioApp.tsx',
    'interface StudioNavigation { readonly write: (location: StudioLocation) => void }',
  ],
  [sharingData, `import { BoardSharingService } from '${sharingProtocol}';`],
  ['src/app/main.tsx', "import { createBoardSharingService } from '../data/sharing/index.js';"],
  ['src/platform/browser/index.ts', 'const origin = window.location.origin;'],
  [support, "import { AppShell } from '../../src/app/shell/index.js';"],
  [
    'tests/integration/guest-join.test.tsx',
    "import { GuestJoinSurface } from '../../src/surfaces/guest-join/index.js';",
  ],
  [
    workbenchMount,
    "import { createCatalogDirectory, type BoardCatalogService } from '../../data/catalog/index.js';",
  ],
  [workbenchCopy, "import type { CatalogCopyService } from '../../data/catalog/index.js';"],
  [
    'src/data/catalog/copy-protocol.ts',
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [editorContent, "import type { WhiteboardEditService } from '../../data/whiteboard/index.js';"],
  [
    editorCommand,
    "import type { EditObjectContentOperation } from '../../data/whiteboard/index.js';",
  ],
  [page, "import { WhiteboardHistorySurface } from '../../surfaces/whiteboard-history/index.js';"],
  [
    page,
    "import { WhiteboardFeedbackSurface } from '../../surfaces/whiteboard-feedback/index.js';",
  ],
  [page, "import { WhiteboardMediaSurface } from '../../surfaces/whiteboard-media/index.js';"],
  [history, "import type { ReadBoardHistory } from '../../data/whiteboard/index.js';"],
  [history, "import { History } from 'lucide-react';"],
  [
    'src/surfaces/whiteboard-history/HistoryRecord.tsx',
    "import type { BoardHistoryVersion } from '../../data/whiteboard/index.js';",
  ],
  [feedback, "import type { FeedbackClient } from '../../data/feedback/index.js';"],
  [feedback, "import type { CanvasPoint } from '../../ui/domain/canvas/index.js';"],
  [feedbackPinCluster, "import type { FeedbackThread } from '../../data/feedback/index.js';"],
  [feedbackPinCluster, "import { FeedbackPopup } from './FeedbackPopup.js';"],
  [media, "import type { AttachBoardImage } from '../../data/whiteboard/index.js';"],
  [media, "import type { AttachBoardVideoCommand } from '../../data/whiteboard/index.js';"],
  [media, 'const video = await prepareVideo(file);'],
  [media, 'const image = event.currentTarget.files?.[0];'],
  [media, 'const image = await prepareImage(file);'],
  [media, 'const data = image.bytes;'],
  [data, `import { BoardEditService } from '${editsProtocol}';`],
  [data, `import { WhiteboardHistoryService } from '${historyProtocol}';`],
  [feedbackData, `import { FeedbackService } from '${feedbackProtocol}';`],
  ['src/app/main.tsx', "import { createFeedbackService } from '../data/feedback/index.js';"],
  ['src/platform/browser/index.ts', 'const bytes = await file.arrayBuffer();'],
  ['src/platform/browser/index.ts', 'const preview = URL.createObjectURL(image);'],
  [
    'tests/integration/whiteboard-history.test.tsx',
    `import { History } from '${historyProtocol}';`,
  ],
  [
    'tests/integration/whiteboard-feedback.test.tsx',
    `import { Feedback } from '${feedbackProtocol}';`,
  ],
  [page, "import { WhiteboardViewingSurface } from '../../surfaces/whiteboard-viewing/index.js';"],
  [page, "import { WhiteboardExportSurface } from '../../surfaces/whiteboard-export/index.js';"],
  [viewer, "import type { CanvasViewport } from '../../ui/domain/canvas/index.js';"],
  [exportPanel, "import type { ExportBoard } from '../../data/whiteboard/index.js';"],
  [
    'src/app/StudioApp.tsx',
    "import type { ArchiveClient } from '../data/archive-import/index.js';",
  ],
  ['src/app/main.tsx', "import { postArchive } from '../platform/browser/index.js';"],
  [workbench, 'const archive = event.currentTarget.files?.[0];'],
  [
    archiveWorkflow,
    "import type { ArchiveImportReceipt } from '../../../data/archive-import/index.js';",
  ],
  [archiveData, `import { ArchiveImportService } from '${archiveProtocol}';`],
  [archiveData, 'const receiptBytes = upload(file);'],
  ['src/platform/browser/index.ts', 'const request = fetch(path, { body: file });'],
  [
    'tests/integration/archive-import.test.tsx',
    `import { ArchiveImportService } from '${archiveProtocol}';`,
  ],
  ['src/app/main.tsx', "import { createRoot } from 'react-dom/client';"],
  [routes, actualPages],
  [
    routes,
    "import { RecycleBinPage } from '../pages/recycle-bin/index.js';\n" +
      actualPages.replace(
        'workbench: WorkbenchPage',
        "workbench: WorkbenchPage, 'recycle-bin': RecycleBinPage",
      ),
  ],
  ['src/app/StudioApp.tsx', "import { studioPages } from './routes.js';"],
  ['src/app/StudioApp.tsx', "import { AppShell } from './shell/index.js';"],
  [appShell, "import { OperationNoticeSlot } from './operation-notice/index.js';"],
  [operationNotice, "import { OperationNotice } from '../../../ui/base/index.js';"],
  [recycleBin, "import { Dialog, Checkbox } from '../../ui/base/index.js';"],
  [recycleBin, "import type { CatalogManagementService } from '../../data/catalog/index.js';"],
  [recycleBin, "import { Trash2 } from 'lucide-react';"],
  ['src/app/main.tsx', "import { createTransport } from '../platform/transport/index.js';"],
  [page, "import { WhiteboardEditor } from '../../surfaces/whiteboard-editor/index.js';"],
  [page, "import type { WhiteboardClient } from '../../data/whiteboard/index.js';"],
  [
    editorMount,
    "import { createWhiteboardSession, type WhiteboardService } from '../../data/whiteboard/index.js';",
  ],
  [historyMount, "import { createWhiteboardSession } from '../../data/whiteboard/index.js';"],
  [surface, "import { Canvas } from '@codexworkbench/luming-studio-ii-web/ui/domain/canvas';"],
  [surface, "import { Button } from '../../ui/base/index.js';"],
  [surfaceEntry, "export { WhiteboardEditor } from './Editor.js';"],
  [surface, 'const controller = new AbortController();'],
  [data, `import { WhiteboardService } from '${protocol}';`],
  [data, "import { fromBinary } from '@bufbuild/protobuf';"],
  [data, "import { ValueSchema } from '@bufbuild/protobuf/wkt';"],
  [platform, 'const request = window.fetch;'],
  [integration, "import { mountApp } from '../support/app-mock.js';"],
  [support, "import { WhiteboardPage } from '../../src/pages/whiteboard/index.js';"],
  [integration, `import { WhiteboardService } from '${protocol}';`],
  [integration, 'const request = async () => new Uint8Array();'],
  [workbenchPage, "import { Workbench } from '../../surfaces/workbench/index.js';"],
  [workbench, "import type { CatalogClient } from '../../data/catalog/index.js';"],
  [workbench, "import { createPortal } from 'react-dom';"],
  [workbench, "import { Search } from 'lucide-react';"],
  [surface, "import { ArrowLeft } from 'lucide-react';"],
  [catalog, `import { BoardCatalogService } from '${catalogProtocol}';`],
  [
    'tests/integration/workbench.test.tsx',
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
];

const rejected = [
  [
    'the workbench preference UI cannot call the generated protocol',
    workbench,
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    'a whiteboard surface consumes the shared connector geometry directly',
    surface,
    `import { routeConnector } from '${connectorRoute}';`,
  ],
  [
    'whiteboard data imports the shared connector geometry',
    data,
    `import type { ConnectorRouteInput } from '${connectorRoute}';`,
  ],
  [
    'a connector publishes an imported shared geometry alias',
    connectorGeometry,
    `import { routeConnector } from '${connectorRoute}';\nexport { routeConnector as constructPath };`,
  ],
  [
    'a connector publishes an imported shared geometry type',
    connectorPath,
    `import type { ConnectorRouteInput } from '${connectorRoute}';\nexport type { ConnectorRouteInput };`,
  ],
  [
    'a connector reads the raw shared geometry package',
    connectorPath,
    `import { routeConnector } from '${connectorRoute}?raw';`,
  ],
  [
    'room data constructs a browser transport',
    roomStreamData,
    `import { createGrpcWebTransport } from '${connectWeb}';`,
  ],
  [
    'the browser transport constructs a protocol client',
    roomStreamBrowser,
    `import { createClient } from '${connect}';`,
  ],
  [
    'a different browser module imports the streaming SDK',
    browserEntry,
    `import { createGrpcWebTransport } from '${connectWeb}';`,
  ],
  [
    'a different rooms module imports the client SDK',
    roomsData,
    `import type { Transport } from '${connect}';`,
  ],
  [
    'a canvas overlay imports the transport SDK',
    'src/ui/domain/canvas/overlays/CanvasOverlays.tsx',
    `import type { Transport } from '${connect}';`,
  ],
  [
    'the room client publishes a private SDK type',
    roomStreamData,
    `import type { Transport } from '${connect}';\nexport type { Transport };`,
  ],
  [
    'the browser transport dynamically loads the SDK',
    roomStreamBrowser,
    `const sdk = await import('${connectWeb}');`,
  ],
  [
    'the room client imports an unrelated SDK symbol',
    roomStreamData,
    `import type { Interceptor } from '${connect}';`,
  ],
  [
    'video placement reads the uploaded file outside the platform port',
    media,
    'const video = await file.arrayBuffer();',
    'no-restricted-syntax',
  ],
  [
    'video placement encodes its own generated protocol',
    media,
    `import type { AttachBoardVideoRequest } from '${editsProtocol}';`,
  ],
  [
    'the suggestions adapter also constructs the whiteboard writer',
    suggestionsData,
    "import { readBoardEditReceipt, createWhiteboardEditService } from '../whiteboard/index.js';",
  ],
  [
    'the suggestions adapter deep imports the edit decoder',
    suggestionsData,
    "import { readBoardEditChanges } from '../whiteboard/protocol/edit-receipt.js';",
  ],
  [
    'a different suggestions file accesses the edit decoder',
    'src/data/suggestions/review-source.ts',
    "import { readBoardEditReceipt } from '../whiteboard/index.js';",
  ],
  [
    'suggestion contracts import a runtime decoder',
    suggestionContracts,
    "import { readBoardEditReceipt } from '../whiteboard/index.js';",
  ],
  [
    'suggestion contracts consume a writer port',
    suggestionContracts,
    "import type { WhiteboardEditService } from '../whiteboard/index.js';",
  ],
  [
    'the suggestion preview also creates a board session',
    suggestionPreview,
    "import { projectBoardChanges, createWhiteboardSession } from '../../data/whiteboard/index.js';",
  ],
  [
    'another editor file accesses the preview projection',
    surface,
    "import { projectBoardChanges } from '../../data/whiteboard/index.js';",
  ],
  [
    'the workbench mounts whiteboard suggestion review',
    workbenchPage,
    "import { BoardSuggestionsSurface } from '../../surfaces/board-suggestions/index.js';",
  ],
  [
    'the editor mounts suggestion review instead of accepting a feature slot',
    surface,
    "import { BoardSuggestionsSurface } from '../board-suggestions/index.js';",
  ],
  [
    'the editor directly accesses the suggestion client',
    surface,
    "import type { SuggestionService } from '../../data/suggestions/index.js';",
  ],
  [
    'suggestion review constructs its own service',
    suggestions,
    "import { createSuggestionService } from '../../data/suggestions/index.js';",
  ],
  [
    'suggestion review reaches a private implementation of its port',
    suggestions,
    "import type { SuggestionService } from '../../data/suggestions/client.js';",
  ],
  [
    'suggestion review consumes another data module',
    suggestions,
    "import type { SharingService } from '../../data/sharing/index.js';",
  ],
  [
    'suggestion review decodes wire messages directly',
    suggestions,
    `import type { ResolveSuggestionRequest } from '${suggestionsProtocol}';`,
  ],
  [
    'room data consumes generated suggestion messages',
    roomsData,
    `import { BoardSuggestionsService } from '${suggestionsProtocol}';`,
  ],
  [
    'a model host adapter accesses the human decision port',
    mcpAdapter,
    "import { createSuggestionService } from '../../data/suggestions/index.js';",
  ],
  [
    'suggestion review uses the model host SDK',
    suggestions,
    `import { OpenAIExtensions } from '${hostSdk}';`,
  ],
  [
    'another room module reads the Whiteboard decoder',
    roomsData,
    "import { readObjects } from '../whiteboard/index.js';",
  ],
  [
    'the room message decoder also imports the board writer',
    roomMessage,
    "import { readObjects, createWhiteboardEditService } from '../whiteboard/index.js';",
  ],
  [
    'the room message decoder aliases a board client to the approved name',
    roomMessage,
    "import { createWhiteboardService as readObjects } from '../whiteboard/index.js';",
  ],
  [
    'the room message decoder depends on whiteboard commands',
    roomMessage,
    "import type { EditObjectContentCommand } from '../whiteboard/index.js';",
  ],
  [
    'the room message decoder imports the whiteboard decoder privately',
    roomMessage,
    "import { readObjects } from '../whiteboard/protocol/scene.js';",
  ],
  [
    'the room message decoder dynamically loads whiteboard data',
    roomMessage,
    "const data = import('../whiteboard/index.js');",
  ],
  [
    'the room message decoder re-exports the whiteboard decoder',
    roomMessage,
    "export { readObjects } from '../whiteboard/index.js';",
  ],
  [
    'the room message decoder depends on an unrelated data module',
    roomMessage,
    "import type { SharingService } from '../sharing/index.js';",
  ],
  [
    'the thread entry connects to the MCP App SDK directly',
    mcpMain,
    `import { App } from '${mcpSdk}';`,
  ],
  [
    'the thread entry uses a private platform bridge',
    mcpMain,
    "import { connectMcpApp } from '../platform/mcp/bridge.js';",
  ],
  [
    'the thread entry mounts a page outside the existing StudioApp routes',
    mcpMain,
    "import { WhiteboardPage } from '../pages/whiteboard/index.js';",
  ],
  [
    'thread composition decodes a sharing wire message',
    mcpMain,
    `import { BoardSharingService } from '${sharingProtocol}';`,
  ],
  [
    'room data reaches the host platform',
    roomsData,
    "import { connectMcpApp } from '../../platform/mcp/index.js';",
  ],
  [
    'the browser adapter imports the host SDK',
    browserEntry,
    `import { OpenAIExtensions } from '${hostSdk}';`,
  ],
  [
    'the browser adapter accesses the remote host directly',
    browserEntry,
    'const host = window.openai;',
    'base/no-browser-io',
  ],
  [
    'the browser adapter aliases the host from a document window',
    browserEntry,
    'const { openai: host } = element.ownerDocument.defaultView;',
    'base/no-browser-io',
  ],
  [
    'a whiteboard surface reads the host object through its document',
    surface,
    'const host = node.ownerDocument.defaultView.openai;',
    'base/no-browser-io',
  ],
  [
    'the MCP adapter creates a browser SSE connection',
    mcpAdapter,
    'const source = new EventSource(path);',
    'no-restricted-globals',
  ],
  [
    'the MCP adapter deep-imports an SDK implementation',
    mcpAdapter,
    `import { App } from '${mcpSdk}/dist/src/app.js';`,
  ],
  [
    'the MCP public entry re-exports a host SDK type',
    mcpEntry,
    `export type { OpenAIModelContextHostState } from '${hostSdk}';`,
    boundary,
    'reexport',
  ],
  [
    'the MCP public entry re-exports an aliased host SDK type',
    mcpEntry,
    `import type { OpenAIModelContextHostState as HostState } from '${hostSdk}';\n\nexport type { HostState };`,
    boundary,
    'reexport',
  ],
  [
    'a workbench page mounts room presence',
    workbenchPage,
    "import { RoomPresenceSurface } from '../../surfaces/room-presence/index.js';",
  ],
  [
    'a workbench page mounts a whiteboard room timer',
    workbenchPage,
    "import { SharedTimerSurface } from '../../surfaces/shared-timer/index.js';",
  ],
  [
    'the whiteboard page imports private room presence',
    page,
    "import { RoomPresenceSurface } from '../../surfaces/room-presence/RoomPresenceSurface.js';",
  ],
  [
    'the editor imports room presence instead of accepting a slot',
    surface,
    "import { RoomPresenceSurface } from '../room-presence/index.js';",
  ],
  [
    'the timer reaches a private peer component',
    sharedTimer,
    "import { PeerTable } from '../room-presence/PeerTable.js';",
  ],
  [
    'room presence constructs a room service',
    roomPresence,
    "import { createBoardRoomService } from '../../data/rooms/index.js';",
  ],
  [
    'the timer constructs a room service',
    sharedTimer,
    "import { createBoardRoomService } from '../../data/rooms/index.js';",
  ],
  [
    'room presence uses an unrelated data port',
    roomPresence,
    "import type { WhiteboardService } from '../../data/whiteboard/index.js';",
  ],
  [
    'the editor directly consumes room data',
    surface,
    "import type { BoardRoomService } from '../../data/rooms/index.js';",
  ],
  [
    'the timer decodes generated room messages directly',
    sharedTimer,
    `import { BoardRoomService } from '${roomProtocol}';`,
  ],
  [
    'sharing data decodes room messages instead of its own protocol',
    sharingData,
    `import { BoardRoomService } from '${roomProtocol}';`,
  ],
  [
    'room data imports the browser event connection',
    roomsData,
    "import { openRoomEvents } from '../../platform/browser/index.js';",
  ],
  [
    'a platform module outside the browser opens a browser event connection',
    'src/platform/transport/room-events.ts',
    'const source = new EventSource(path);',
    'no-restricted-globals',
  ],
  [
    'room data opens its own event connection',
    roomsData,
    'const source = new EventSource(path);',
    'no-restricted-globals',
  ],
  [
    'room presence opens its own event connection',
    roomPresence,
    'const source = new EventSource(path);',
    'no-restricted-globals',
  ],
  [
    'the timer aliases the browser event constructor',
    sharedTimer,
    'const { EventSource: Events } = element.ownerDocument.defaultView;',
    'base/no-browser-io',
  ],
  [
    'viewing opens a browser event connection',
    viewer,
    'const source = new window.EventSource(path);',
    'base/no-browser-io',
  ],
  [
    'editing reads the browser room URL',
    surface,
    'const room = node.ownerDocument.defaultView.location.href;',
    'base/no-browser-io',
  ],
  [
    'a workbench page mounts the board sharing surface',
    workbenchPage,
    "import { BoardSharingSurface } from '../../surfaces/board-sharing/index.js';",
  ],
  [
    'the whiteboard editor imports the sharing surface instead of accepting a slot',
    surface,
    "import { BoardSharingSurface } from '../board-sharing/index.js';",
  ],
  [
    'a whiteboard page mounts the guest access gate',
    page,
    "import { GuestJoinSurface } from '../../surfaces/guest-join/index.js';",
  ],
  [
    'the shell reaches a private guest access implementation',
    appShell,
    "import { GuestJoinSurface } from '../../surfaces/guest-join/GuestJoinSurface.js';",
  ],
  [
    'a shell notice mounts the guest access gate',
    operationNotice,
    "import { GuestJoinSurface } from '../../../surfaces/guest-join/index.js';",
  ],
  [
    'the shell constructs the sharing service',
    appShell,
    "import { createBoardSharingService } from '../../data/sharing/index.js';",
  ],
  [
    'sharing constructs its own service',
    sharing,
    "import { createBoardSharingService } from '../../data/sharing/index.js';",
  ],
  [
    'guest access constructs its own service',
    guestJoin,
    "import { createBoardSharingService } from '../../data/sharing/index.js';",
  ],
  [
    'sharing uses an unrelated data contract',
    sharing,
    "import type { BoardCatalogService } from '../../data/catalog/index.js';",
  ],
  [
    'a guest access surface reads the internal sharing client',
    guestJoin,
    "import type { GuestAccess } from '../../data/sharing/client.js';",
  ],
  [
    'sharing reaches the private guest access component',
    sharing,
    "import { GuestJoinSurface } from '../guest-join/GuestJoinSurface.js';",
  ],
  [
    'guest access reaches the private sharing component',
    guestJoin,
    "import { BoardSharingSurface } from '../board-sharing/BoardSharingSurface.js';",
  ],
  [
    'sharing imports the generated sharing protocol',
    sharing,
    `import type { SharingState } from '${sharingProtocol}';`,
  ],
  [
    'another data module decodes the sharing protocol',
    catalog,
    `import { BoardSharingService } from '${sharingProtocol}';`,
  ],
  [
    'guest access imports the browser platform',
    guestJoin,
    "import { readHostLocation } from '../../platform/browser/index.js';",
  ],
  [
    'sharing imports the Codex host',
    sharing,
    "import { App } from '@modelcontextprotocol/ext-apps';",
  ],
  [
    'sharing imports a private Canvas module',
    sharing,
    "import type { Bounds } from '../../ui/domain/canvas/scene/index.js';",
  ],
  [
    'guest access reads credentials from the document',
    guestJoin,
    'const credentials = document.cookie;',
    'base/no-browser-io',
  ],
  [
    'sharing reads the clipboard directly',
    sharing,
    'const copy = navigator.clipboard.writeText(url);',
    'base/no-browser-io',
  ],
  ...['location.href', 'URL', 'documentURI', 'baseURI', 'referrer'].map((field) => [
    'guest access obtains a browser URL from document.' + field,
    guestJoin,
    'const source = document.' + field + ';',
    'base/no-browser-io',
  ]),
  [
    'guest access obtains the navigation URL from a global',
    guestJoin,
    'const source = location.href;',
    'base/no-browser-io',
  ],
  [
    'guest access destructures a browser Location alias',
    guestJoin,
    'const current = location;\n\nconst { href } = current;',
    'base/no-browser-io',
  ],
  [
    'an AppMock bypasses the public guest access entry',
    support,
    "import { GuestJoinSurface } from '../../src/surfaces/guest-join/GuestJoinSurface.js';",
  ],
  [
    'the workbench card owns the copy protocol',
    workbenchCard,
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    'the workbench copy hook makes its own request',
    workbenchCopy,
    'const response = fetch(path);',
    'no-restricted-globals',
  ],
  [
    'the workbench card stores copy state directly',
    workbenchCard,
    'window.localStorage.setItem(key, value);',
    'base/no-browser-io',
  ],
  [
    'the workbench copy hook imports the private implementation of its port',
    workbenchCopy,
    "import type { CatalogCopyService } from '../../data/catalog/copy-protocol.js';",
  ],
  [
    'the workbench copy hook creates a catalog copy client',
    workbenchCopy,
    "import { createCatalogCopyService } from '../../data/catalog/index.js';",
  ],
  [
    'the workbench card loads the catalog client dynamically',
    workbenchCard,
    "const client = import('../../data/catalog/index.js');",
  ],
  [
    'the workbench mount constructs a copy client alongside its directory',
    workbenchMount,
    "import { createCatalogDirectory, createCatalogCopyService } from '../../data/catalog/index.js';",
  ],
  [
    'editor content constructs its own edit client',
    editorContent,
    "import { createWhiteboardEditService } from '../../data/whiteboard/index.js';",
  ],
  [
    'editor content dynamically loads edit data',
    editorContent,
    "const service = import('../../data/whiteboard/index.js');",
  ],
  [
    'editor content creates an independent board session',
    editorContent,
    "import { createWhiteboardSession } from '../../data/whiteboard/index.js';",
  ],
  [
    'editor mount imports an edit client alongside the session factory',
    editorMount,
    "import { createWhiteboardSession, createWhiteboardEditService } from '../../data/whiteboard/index.js';",
  ],
  [
    'history canvas mount imports an edit client instead of a read session',
    historyMount,
    "import { createWhiteboardEditService } from '../../data/whiteboard/index.js';",
  ],
  [
    'editor command imports a private edit data type',
    editorCommand,
    "import type { EditObjectContentOperation } from '../../data/whiteboard/edits-types.js';",
  ],
  [
    'editor command imports the generated edit request',
    editorCommand,
    `import type { EditObjectContentRequest } from '${editsProtocol}';`,
  ],
  [
    'a workbench page importing the whiteboard history surface',
    workbenchPage,
    "import { History } from '../../surfaces/whiteboard-history/index.js';",
  ],
  [
    'a workbench page importing the whiteboard feedback surface',
    workbenchPage,
    "import { Feedback } from '../../surfaces/whiteboard-feedback/index.js';",
  ],
  [
    'a workbench page importing the whiteboard media surface',
    workbenchPage,
    "import { Media } from '../../surfaces/whiteboard-media/index.js';",
  ],
  [
    'the whiteboard page reaches a private history component',
    page,
    "import { History } from '../../surfaces/whiteboard-history/HistoryPanel.js';",
  ],
  [
    'history constructs its own board service',
    history,
    "import { createBoardHistory } from '../../data/whiteboard/index.js';",
  ],
  [
    'history reads author fields from the public view data instead of the generated protocol',
    'src/surfaces/whiteboard-history/HistoryRecord.tsx',
    `import type { BoardVersionSummary } from '${historyProtocol}';`,
  ],
  [
    'feedback constructs its own service',
    feedback,
    "import { createFeedbackService } from '../../data/feedback/index.js';",
  ],
  [
    'media constructs its own edit service',
    media,
    "import { createBoardEditService } from '../../data/whiteboard/index.js';",
  ],
  [
    'feedback reaches an unrelated data port',
    feedback,
    "import type { BoardEditService } from '../../data/whiteboard/index.js';",
  ],
  [
    'history reaches a feedback data port',
    history,
    "import type { FeedbackClient } from '../../data/feedback/index.js';",
  ],
  [
    'media reaches a private transport type',
    media,
    "type Upload = import('../../data/whiteboard/media.js').Upload;",
  ],
  [
    'the whiteboard editor imports the feedback surface',
    surface,
    "import { Feedback } from '../whiteboard-feedback/index.js';",
  ],
  [
    'the whiteboard history uses the generated history protocol',
    history,
    `import type { ListVersionsRequest } from '${historyProtocol}';`,
  ],
  [
    'the feedback surface uses the generated feedback protocol',
    feedback,
    `import { FeedbackService } from '${feedbackProtocol}';`,
  ],
  [
    'the feedback pin cluster constructs its own service',
    feedbackPinCluster,
    "import { createFeedbackService } from '../../data/feedback/index.js';",
  ],
  [
    'the feedback pin cluster reads from the platform',
    feedbackPinCluster,
    "import { post } from '../../platform/browser/index.js';",
  ],
  [
    'the media surface uses the generated editing protocol',
    media,
    `import { BoardEditService } from '${editsProtocol}';`,
  ],
  [
    'the canvas uses the generated editing protocol',
    'src/ui/domain/canvas/Canvas.tsx',
    `import type { BoardEditReceipt } from '${editsProtocol}';`,
  ],
  [
    'the browser platform decodes the generated editing protocol',
    platform,
    `import { BoardEditService } from '${editsProtocol}';`,
  ],
  [
    'whiteboard data uses the generated feedback protocol',
    data,
    `import { FeedbackService } from '${feedbackProtocol}';`,
  ],
  [
    'feedback data uses the generated history protocol',
    feedbackData,
    `import { WhiteboardHistoryService } from '${historyProtocol}';`,
  ],
  [
    'an object component test imports the feedback wire schema',
    'tests/component/FeedbackPanel.test.tsx',
    `import { FeedbackService } from '${feedbackProtocol}';`,
  ],
  [
    'an integration test bypasses the feedback surface entry',
    integration,
    "import { FeedbackPanel } from '../../src/surfaces/whiteboard-feedback/FeedbackPanel.js';",
  ],
  [
    'media reads selected file bytes directly',
    media,
    'const bytes = await file.arrayBuffer();',
    'no-restricted-syntax',
  ],
  [
    'media aliases selected file reads',
    media,
    'const { text: read } = file;',
    'no-restricted-syntax',
  ],
  [
    'the canvas uses a browser file reader',
    'src/ui/domain/canvas/Canvas.tsx',
    'const reader = new FileReader();',
    'no-restricted-globals',
  ],
  [
    'media allocates a browser preview URL',
    media,
    'const url = URL.createObjectURL(image);',
    'base/no-browser-io',
  ],
  [
    'a canvas object aliases browser preview URL cleanup',
    'src/ui/domain/objects/media/MediaObject.tsx',
    'const { revokeObjectURL: revoke } = URL;',
    'base/no-browser-io',
  ],
  [
    'the viewing surface reaches the whiteboard write service',
    viewer,
    "import { createWhiteboardService } from '../../data/whiteboard/index.js';",
  ],
  [
    'the export surface constructs its own board service',
    exportPanel,
    "import { createWhiteboardExportService } from '../../data/whiteboard/index.js';",
  ],
  [
    'the export surface reaches browser download internals',
    exportPanel,
    "import { downloadBoardFile } from '../../platform/browser/index.js';",
  ],
  [
    'the viewing surface reaches a private canvas handler',
    viewer,
    "import { useCanvasInput } from '../../ui/domain/canvas/canvas-input.js';",
  ],
  [
    'the viewing surface reaches the export surface',
    viewer,
    "import { WhiteboardExportSurface } from '../whiteboard-export/index.js';",
  ],
  [
    'Recycle Bin decodes the generated catalogue protocol',
    recycleBin,
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    'Recycle Bin imports private parts of the catalogue transport',
    recycleBin,
    "import { purgeBoards } from '../../data/catalog/lifecycle-protocol.js';",
  ],
  [
    'Recycle Bin reaches the Workbench Surface',
    recycleBin,
    "import { WorkbenchSurface } from '../workbench/index.js';",
  ],
  [
    'Recycle Bin replaces confirmation with a host dialog',
    recycleBin,
    "window.confirm('Permanently delete this board?');",
    'no-restricted-globals',
  ],
  [
    'a Shell notice that reaches a business Surface',
    operationNotice,
    "import { WorkbenchSurface } from '../../../surfaces/workbench/index.js';",
  ],
  [
    'a Shell notice that reaches the archive data service',
    operationNotice,
    "import { createArchiveImportService } from '../../../data/archive-import/index.js';",
  ],
  [
    'a Shell notice that reaches the browser platform',
    operationNotice,
    "import { postArchive } from '../../../platform/browser/index.js';",
  ],
  [
    'a Shell notice that imports a private base file',
    operationNotice,
    "import { OperationNotice } from '../../../ui/base/OperationNotice/OperationNotice.js';",
  ],
  [
    'App code outside the Shell that imports a base control',
    'src/app/StudioApp.tsx',
    "import { OperationNotice } from '../ui/base/index.js';",
  ],
  [
    'App code that reaches inside the Shell',
    'src/app/StudioApp.tsx',
    "import { OperationNoticeSlot } from './shell/operation-notice/OperationNoticeSlot.js';",
  ],
  ['an unclassified archive file outside its module', 'src/data/archive-import.ts', 'export {};'],
  [
    'Workbench Surface reads a sibling whiteboard Surface',
    workbench,
    "import { WhiteboardEditorSurface } from '../whiteboard-editor/index.js';",
  ],
  [
    'archive workflow reads a private data type',
    archiveWorkflow,
    "type Archive = import('../../../data/archive-import/client.js').ArchiveClient;",
  ],
  [
    'Workbench bypasses the data port to upload',
    workbench,
    "import { postArchive } from '../../platform/browser/index.js';",
  ],
  [
    'archive workflow opens a network request',
    archiveWorkflow,
    'const sent = fetch(path);',
    'no-restricted-globals',
  ],
  [
    'Workbench opens a file reader',
    workbench,
    'const reader = new FileReader();',
    'no-restricted-globals',
  ],
  [
    'Workbench reads a ZIP into memory',
    workbench,
    'const bytes = file.arrayBuffer();',
    'no-restricted-syntax',
  ],
  [
    'archive workflow reads a ZIP into memory',
    archiveWorkflow,
    'const bytes = file.arrayBuffer();',
    'no-restricted-syntax',
  ],
  [
    'archive data extracts a file stream method',
    archiveData,
    'const { stream: read } = file;',
    'no-restricted-syntax',
  ],
  [
    'archive data reads ZIP bytes through a computed property',
    archiveData,
    "const pending = file['bytes']();",
    'no-restricted-syntax',
  ],
  [
    'archive workflow decodes generated receipts',
    archiveWorkflow,
    `import type { ImportReceipt } from '${archiveProtocol}';`,
  ],
  [
    'catalog imports an archive receipt codec',
    catalog,
    `import { ArchiveImportService } from '${archiveProtocol}';`,
  ],
  [
    'archive data imports a catalog codec',
    archiveData,
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    'platform decodes generated archive receipts',
    platform,
    `import { ArchiveImportService } from '${archiveProtocol}';`,
  ],
  [
    'archive data imports an internal generated archive module',
    archiveData,
    `import { ArchiveImportService } from '${archiveProtocol}/private';`,
  ],
  [
    'Shell notice mounts its own portal',
    operationNotice,
    "import { createPortal } from 'react-dom';",
  ],
  [
    'archive AppMock replaces the real application',
    'tests/integration/archive-import.test.tsx',
    "import { vi as runner } from 'vitest';\n\nrunner.mock('../../src/app/index.js');",
    'no-restricted-syntax',
  ],
  ['icons in catalog data', catalog, "import { Search } from 'lucide-react';"],
  ['icons in the browser platform', platform, "import { Search } from 'lucide-react';"],
  ['icons in the Workbench page', workbenchPage, "import { Search } from 'lucide-react';"],
  [
    'icon API in another Surface',
    'src/surfaces/archive/Archive.tsx',
    "import { Search } from 'lucide-react';",
  ],
  ['an unclassified workbench catalog leaf', 'src/data/catalog.ts', 'export {};'],
  [
    'workbench page reaches a private Surface',
    workbenchPage,
    "import { Workbench } from '../../surfaces/workbench/Workbench.js';",
  ],
  [
    'workbench Surface bypasses the catalog data entry',
    workbench,
    "type Catalog = import('../../data/catalog/client.js').CatalogClient;",
  ],
  [
    'workbench imports a generated catalog request',
    workbench,
    `import type { ListBoardsRequest } from '${catalogProtocol}';`,
  ],
  [
    'catalog data imports an internal generated module',
    catalog,
    `import { BoardCatalogService } from '${catalogProtocol}/index';`,
  ],
  [
    'catalog codec in the whiteboard module',
    data,
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  ['whiteboard codec in catalog data', catalog, `import { WhiteboardService } from '${protocol}';`],
  [
    'catalog codec in the browser platform',
    platform,
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    'direct catalog network call from Workbench',
    workbench,
    'const response = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'direct catalog network call from data',
    catalog,
    'const response = fetch(url);',
    'no-restricted-globals',
  ],
  ['a portal outside Workbench', surface, "import { createPortal } from 'react-dom';"],
  ['a portal in the Workbench page', workbenchPage, "import { createPortal } from 'react-dom';"],
  ['a portal in the note list owner', feedback, "import { createPortal } from 'react-dom';"],
  [
    'a portal outside the suggestions layout',
    'src/surfaces/board-suggestions/SuggestionCard.tsx',
    "import { createPortal } from 'react-dom';",
  ],
  [
    'an extra React DOM method in the suggestions layout',
    suggestions,
    "import { createPortal, flushSync } from 'react-dom';",
  ],
  ['a React DOM namespace in Workbench', workbench, "import * as renderer from 'react-dom';"],
  [
    'mixed portal and React DOM runtime imports',
    workbench,
    "import { createPortal, flushSync } from 'react-dom';",
  ],
  [
    'an independent React mount in Workbench',
    workbench,
    "import { createRoot } from 'react-dom/client';",
  ],
  ['unclassified source', 'src/other/module.ts', 'export const value = 1;'],
  ['file outside a Surface module', 'src/surfaces/Editor.tsx', 'export const value = 1;'],
  [
    'private Surface import from a page',
    page,
    "import { WhiteboardEditor } from '../../surfaces/whiteboard-editor/Editor.js';",
  ],
  [
    'private data type import',
    surface,
    "import type { WhiteboardClient } from '../../data/whiteboard/client.js';",
  ],
  [
    'private data type reference',
    surface,
    "type Client = import('../../data/whiteboard/client.js').WhiteboardClient;",
  ],
  [
    'dynamic private data import',
    surface,
    "const client = import('../../data/whiteboard/client.js');",
  ],
  ['computed import', surface, 'const client = import(moduleName);'],
  [
    'dynamic import with a resource query',
    surface,
    "const client = import('../../data/whiteboard/index.js?raw');",
  ],
  [
    'self-package deep import',
    surface,
    "import { createProjection } from '@codexworkbench/luming-studio-ii-web/src/data/whiteboard/client.js';",
  ],
  [
    'application skips the page',
    'src/app/main.tsx',
    "import { WhiteboardEditor } from '../surfaces/whiteboard-editor/index.js';",
  ],
  [
    'page creates the data client',
    page,
    "import { createClient } from '../../data/whiteboard/index.js';",
  ],
  ['Surface imports another Surface', surface, "import { Archive } from '../archive/index.js';"],
  [
    'Surface calls browser transport',
    surface,
    "import { createTransport } from '../../platform/transport/index.js';",
  ],
  ['Surface imports generated messages', surface, `import type { Board } from '${protocol}';`],
  ['platform imports a codec', platform, "import { fromBinary } from '@bufbuild/protobuf';"],
  [
    'data imports an internal protocol subpath',
    data,
    "import type { Board } from '@codexworkbench/luming-studio-ii-contracts/src/whiteboard.js';",
  ],
  ['data imports React', data, "import { useEffect } from 'react';"],
  [
    'data depends on Canvas',
    data,
    "import type { CanvasScene } from '../../ui/domain/canvas/index.js';",
  ],
  [
    'data constructs browser transport',
    data,
    "import { createTransport } from '../../platform/transport/index.js';",
  ],
  [
    'platform depends on data',
    platform,
    "import type { WhiteboardClient } from '../../data/whiteboard/index.js';",
  ],
  [
    'UI depends on a Surface',
    'src/ui/domain/canvas/Canvas.tsx',
    "import type { EditorProps } from '../../../surfaces/whiteboard-editor/index.js';",
  ],
  [
    'Surface re-exports a lower layer runtime API',
    surfaceEntry,
    "export { createClient } from '../../data/whiteboard/index.js';",
  ],
  [
    'private Surface module passes through a lower layer runtime API',
    surface,
    "export { createClient } from '../../data/whiteboard/index.js';",
  ],
  [
    'Surface republishes an imported runtime API under an alias',
    surfaceEntry,
    "import { createClient as client } from '../../data/whiteboard/index.js';\n\nexport { client as openBoard };",
  ],
  ['wildcard export from Surface entry', surfaceEntry, "export * from './Editor.js';"],
  ['direct fetch from Surface', surface, 'fetch(request);', 'no-restricted-globals'],
  [
    'destructured fetch from an owner document window',
    surface,
    'const { fetch: request } = element.ownerDocument.defaultView;',
    'base/no-browser-io',
  ],
  ['browser storage from data', data, 'localStorage.getItem(key);', 'no-restricted-globals'],
  ['command id generation from Surface', surface, 'crypto.randomUUID();', 'no-restricted-globals'],
  [
    'private application reference in AppMock',
    support,
    "import { mount } from '../../src/app/main.js';",
  ],
  [
    'private data reference in integration test',
    integration,
    "import { createClient } from '../../src/data/whiteboard/client.js';",
  ],
  [
    'integration uses a lower test runner as a double',
    integration,
    "import { editor } from '../unit/editor.js';",
  ],
  [
    'support renames the Vitest module replacement API',
    support,
    "import { vi as runner } from 'vitest';\n\nrunner.mock(source, factory);",
    'no-restricted-syntax',
  ],
  [
    'integration replaces a module through computed method syntax',
    integration,
    "runner['mock'](source, factory);",
    'no-restricted-syntax',
  ],
  [
    'integration skips an assertion case',
    integration,
    "import { test as verify } from 'vitest';\n\nverify.skip('missing acknowledgement', run);",
    'base/test-contract',
  ],
];

const rejectedPages = [
  [
    'guest access registered as its own page',
    routes,
    "import { GuestJoinPage } from '../pages/guest-join/index.js';\n" +
      actualPages.replace(
        'workbench: WorkbenchPage',
        "workbench: WorkbenchPage, 'guest-join': GuestJoinPage",
      ),
    'pageRegistry',
  ],
  [
    'an unregistered Page module without imports',
    'src/pages/archive-import/ArchiveImportNoticePage.tsx',
    'export const ArchiveImportNoticePage = () => null;',
    'pageRegistration',
  ],
  [
    'an App import targeting an unregistered Page',
    'src/app/StudioApp.tsx',
    "import { ArchiveImportNoticePage } from '../pages/archive-import/index.js';",
    'pageRegistration',
  ],
  [
    'a registered Page mounted outside the route registry',
    'src/app/WhiteboardApp.tsx',
    "import { WhiteboardPage } from '../pages/whiteboard/index.js';",
    'pageWiring',
  ],
  [
    'a page key referring to a different directory',
    routes,
    actualPages.replace('workbench: WorkbenchPage', "'recycle-bin': WorkbenchPage"),
    'pageRegistry',
  ],
  [
    'an imported component omitted from the route table',
    routes,
    actualPages.replace(/export const studioPages.*/u, 'export const studioPages = {};'),
    'pageRegistry',
  ],
];

for (const [title, filePath, text, messageId] of rejectedPages) {
  test('rejects ' + title, async () => {
    const [result] = await eslint.lintText(text, { filePath });

    assert.ok(
      result.messages.some(
        (message) => message.ruleId === boundary && message.messageId === messageId,
      ),
      JSON.stringify(result.messages),
    );
  });
}

for (const [title, filePath, text, rule = boundary, messageId] of rejected) {
  test('rejects ' + title, async () => {
    const [result] = await eslint.lintText(text, { filePath });

    assert.ok(
      result.messages.some(
        (report) => report.ruleId === rule && (!messageId || report.messageId === messageId),
      ),
      JSON.stringify(result.messages),
    );
  });
}

for (const [filePath, text] of accepted) {
  test('accepts declared frontend references in ' + filePath, async () => {
    const [result] = await eslint.lintText(text, { filePath });

    assert.deepEqual(result.messages, []);
  });
}
