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
const media = 'src/surfaces/whiteboard-media/WhiteboardMediaSurface.tsx';
const feedbackData = 'src/data/feedback/client.ts';
const editsProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
const historyProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
const feedbackProtocol = '@codexworkbench/luming-studio-ii-contracts/feedback/service';
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
  [feedback, "import type { FeedbackClient } from '../../data/feedback/index.js';"],
  [feedback, "import type { CanvasPoint } from '../../ui/domain/canvas/index.js';"],
  [media, "import type { AttachBoardImage } from '../../data/whiteboard/index.js';"],
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

for (const [title, filePath, text, rule = boundary] of rejected) {
  test('rejects ' + title, async () => {
    const [result] = await eslint.lintText(text, { filePath });

    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === rule),
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
