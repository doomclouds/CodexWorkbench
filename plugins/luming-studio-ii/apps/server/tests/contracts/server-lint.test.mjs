import { deepEqual, equal } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'luming-server-boundary-'));
const whiteboard = 'src/modules/whiteboard/';
const catalog = 'src/modules/catalog/';
const archives = 'src/modules/archives/';
const feedback = 'src/modules/feedback/';
const sharing = 'src/modules/sharing/';
const rooms = 'src/modules/rooms/';
const catalogAdapter = 'src/infrastructure/adapters/catalog/';
const archivesAdapter = 'src/infrastructure/adapters/archives/';
const feedbackAdapter = 'src/infrastructure/adapters/feedback/';
const sharingAdapter = 'src/infrastructure/adapters/sharing/';
const roomsAdapter = 'src/infrastructure/adapters/rooms/';
const authorizationAdapter = 'src/infrastructure/adapters/authorization/';
const archivesPlatform = 'src/infrastructure/platform/archives/';
const protocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
const catalogProtocol = '@codexworkbench/luming-studio-ii-contracts/catalog/service';
const archivesProtocol = '@codexworkbench/luming-studio-ii-contracts/archives/service';
const editingProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
const historyProtocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
const feedbackProtocol = '@codexworkbench/luming-studio-ii-contracts/feedback/service';
const sharingProtocol = '@codexworkbench/luming-studio-ii-contracts/sharing/service';
const roomsProtocol = '@codexworkbench/luming-studio-ii-contracts/rooms/service';
const suggestionsProtocol = '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
const mcpServerSdk = '@modelcontextprotocol/sdk/server/mcp.js';
const mcpStdioSdk = '@modelcontextprotocol/sdk/server/stdio.js';
const mcpAppServerSdk = '@modelcontextprotocol/ext-apps/server';
const openAiMcpServerSdk = '@openai/mcp-extensions/server';
const mcpClientSdk = '@modelcontextprotocol/sdk/client/index.js';
const mcpTestTransport = '@modelcontextprotocol/sdk/inMemory.js';
const boundaryRule = 'server/contract-boundary';

const fixtureFiles = [
  'src/bootstrap/index.ts',
  'src/entrypoints/http/index.ts',
  'src/entrypoints/http/guest-sharing.ts',
  'src/entrypoints/http/unary-route.ts',
  'src/entrypoints/mcp/index.ts',
  'src/entrypoints/mcp/private.ts',
  whiteboard + 'application/index.ts',
  whiteboard + 'application/private.ts',
  whiteboard + 'domain/index.ts',
  whiteboard + 'domain/private.ts',
  whiteboard + 'ports/index.ts',
  catalog + 'application/index.ts',
  catalog + 'application/private.ts',
  catalog + 'domain/index.ts',
  catalog + 'domain/private.ts',
  catalog + 'ports/index.ts',
  catalog + 'ports/private.ts',
  catalogAdapter + 'index.ts',
  catalogAdapter + 'duplicate-board.ts',
  catalogAdapter + 'lifecycle.ts',
  catalogAdapter + 'private.ts',
  archives + 'application/index.ts',
  archives + 'application/private.ts',
  archives + 'domain/index.ts',
  archives + 'ports/index.ts',
  archivesAdapter + 'index.ts',
  archivesAdapter + 'private.ts',
  archivesPlatform + 'index.ts',
  archivesPlatform + 'private.ts',
  feedback + 'application/index.ts',
  feedback + 'application/private.ts',
  feedback + 'domain/index.ts',
  feedback + 'ports/index.ts',
  feedbackAdapter + 'index.ts',
  feedbackAdapter + 'private.ts',
  sharing + 'application/index.ts',
  sharing + 'application/private.ts',
  sharing + 'domain/index.ts',
  sharing + 'ports/index.ts',
  sharingAdapter + 'index.ts',
  sharingAdapter + 'private.ts',
  rooms + 'application/index.ts',
  rooms + 'application/private.ts',
  rooms + 'domain/index.ts',
  rooms + 'ports/index.ts',
  roomsAdapter + 'index.ts',
  roomsAdapter + 'private.ts',
  authorizationAdapter + 'index.ts',
  authorizationAdapter + 'private.ts',
  'src/infrastructure/adapters/index.ts',
  'src/infrastructure/adapters/board-edit-storage.ts',
  'src/infrastructure/adapters/board-custom-colors.ts',
  'src/infrastructure/adapters/private.ts',
  'src/infrastructure/platform/index.ts',
  'src/infrastructure/platform/png-renderer.ts',
  'tests/fixtures/board.ts',
  'tests/support/server.ts',
  'tests/unit/double.ts',
];

after(() => rmSync(fixture, { recursive: true, force: true }));

for (const file of fixtureFiles) {
  const path = join(fixture, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'export {};\n');
}

writeFileSync(
  join(fixture, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@board-app': [whiteboard + 'application/index.ts'],
        '@board/*': [whiteboard + '*'],
        '@catalog/*': [catalog + '*'],
        '@archives/*': [archives + '*'],
        '@platform/*': ['src/infrastructure/platform/*'],
      },
    },
  }),
);

const eslint = new ESLint({
  cwd: fixture,
  overrideConfigFile: join(serverRoot, 'eslint.config.mjs'),
  overrideConfig: { settings: { studioServerRoot: fixture } },
});

async function inspect(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });

  return result.messages.map(({ ruleId, messageId }) => ({ ruleId, messageId }));
}

const permitted = [
  [
    'src/infrastructure/adapters/board-custom-colors.ts',
    "import type { SqliteConnection } from '../platform/index.js';",
  ],
  [
    'src/entrypoints/http/room-event-stream.ts',
    "import { ConnectError } from '@connectrpc/connect';\nimport { connectNodeAdapter } from '@connectrpc/connect-node';",
  ],
  [
    'tests/integration/room-event-stream.test.ts',
    "import { createClient } from '@connectrpc/connect';\nimport { createGrpcWebTransport } from '@connectrpc/connect-node';",
  ],
  [
    'src/entrypoints/http/suggestion-routes.ts',
    `import { BoardSuggestionService } from '${suggestionsProtocol}';\nimport type { BoardSuggestionsApplication } from '@board-app';`,
  ],
  [
    whiteboard + 'application/board-suggestions.ts',
    "import { planSuggestion } from '../domain/index.js';\nimport type { BoardEditWriter } from '../ports/index.js';",
  ],
  [
    'src/infrastructure/adapters/board-suggestions.ts',
    "import type { BoardEditWriter } from '@board/ports/index.js';\nimport type { SqliteDatabase } from '../platform/index.js';",
  ],
  [
    'tests/integration/board-suggestions.test.ts',
    `import { BoardSuggestionService } from '${suggestionsProtocol}';\nimport { createWhiteboardServer } from '../../src/bootstrap/index.js';`,
  ],
  [
    'src/entrypoints/mcp/index.ts',
    `import { BoardCatalogService, BoardSortOrder } from '${catalogProtocol}';`,
  ],
  ['src/entrypoints/mcp/agent-activity.ts', `import { BoardRoomService } from '${roomsProtocol}';`],
  [
    'tests/integration/mcp-agent-activity.test.ts',
    `import { createStudioMcpServer } from '../../src/entrypoints/mcp/index.js';\nimport { Client } from '${mcpClientSdk}';\nimport { InMemoryTransport } from '${mcpTestTransport}';`,
  ],
  [
    'src/infrastructure/platform/mcp-runtime.ts',
    "import { spawn } from 'node:child_process';\nimport { createInterface } from 'node:readline';\nimport process from 'node:process';\nimport lockfile from 'proper-lockfile';",
  ],
  ['src/infrastructure/platform/png-renderer.ts', "import { Resvg } from '@resvg/resvg-wasm';"],
  ['src/infrastructure/adapters/feedback/content-source.ts', "import { parse } from 'parse5';"],
  [catalogAdapter + 'thumbnail-html.ts', "import { parse } from 'parse5';"],
  [
    catalog + 'domain/thumbnail-sticker.ts',
    "import { stickerDefinition } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/stickers';",
  ],
  [
    'src/entrypoints/mcp/index.ts',
    `import { McpServer } from '${mcpServerSdk}';\nimport { StdioServerTransport } from '${mcpStdioSdk}';`,
  ],
  [
    'src/entrypoints/mcp/thread-resource.ts',
    `import { registerAppResource } from '${mcpAppServerSdk}';\nimport '${openAiMcpServerSdk}';`,
  ],
  [
    'src/entrypoints/mcp/thread-operations.ts',
    `import { fromBinary, toBinary } from '@bufbuild/protobuf';\nimport type { GetBoardSceneRequest } from '${protocol}';\nimport { z } from 'zod';`,
  ],
  [
    'src/bootstrap/index.ts',
    "import { startThreadMcp } from '../entrypoints/mcp/index.js';\nimport process from 'node:process';\nimport { openThreadResource } from '../infrastructure/platform/index.js';",
  ],
  [
    archivesAdapter + 'publication.ts',
    "import { readBoardAccess } from '../authorization/index.js';",
  ],
  [
    'src/bootstrap/index.ts',
    "import { readBoardAccess } from '../infrastructure/adapters/authorization/index.js';",
  ],
  [
    'src/entrypoints/http/room-routes.ts',
    `import { BoardRoomsService } from '${roomsProtocol}';\nimport type { RoomsApplication } from '../../modules/rooms/application/index.js';`,
  ],
  [
    'src/bootstrap/index.ts',
    "import { createRoomsApplication } from '../modules/rooms/application/index.js';\nimport { createRoomsRuntime } from '../infrastructure/adapters/rooms/index.js';",
  ],
  [
    rooms + 'application/index.ts',
    "import { deriveTimer } from '../domain/index.js';\nimport type { RoomBoardAccess } from '../ports/index.js';",
  ],
  [rooms + 'ports/index.ts', "import type { Participant } from '../domain/index.js';"],
  [
    roomsAdapter + 'index.ts',
    "import type { RoomClock } from '../../../modules/rooms/ports/index.js';\nimport { createClock } from '../../platform/index.js';",
  ],
  [
    'tests/integration/rooms-http.test.ts',
    `import { BoardRoomsService } from '${roomsProtocol}';\nimport { createWhiteboardServer } from '../../src/bootstrap/index.js';`,
  ],
  [
    'tests/unit/rooms.test.ts',
    "import { deriveTimer } from '../../src/modules/rooms/domain/index.js';",
  ],
  [
    'src/entrypoints/http/share-routes.ts',
    `import { BoardSharingService } from '${sharingProtocol}';\nimport type { SharingApplication } from '../../modules/sharing/application/index.js';`,
  ],
  [
    'src/bootstrap/index.ts',
    "import { createSharingApplication } from '../modules/sharing/application/index.js';\nimport { createSharingRepository } from '../infrastructure/adapters/sharing/index.js';\nimport { randomBytes } from 'node:crypto';",
  ],
  [
    sharing + 'application/index.ts',
    "import { normalizeGuestName } from '../domain/index.js';\nimport type { SharingRepository } from '../ports/index.js';",
  ],
  [sharing + 'ports/index.ts', "import type { GuestRole } from '../domain/index.js';"],
  [
    sharingAdapter + 'index.ts',
    "import type { SharingRepository } from '../../../modules/sharing/ports/index.js';\nimport type { SqliteConnection } from '../../platform/index.js';\nimport { readBoardAccess } from '../authorization/index.js';",
  ],
  [
    'tests/integration/sharing-http.test.ts',
    `import { BoardSharingService } from '${sharingProtocol}';\nimport { createWhiteboardServer } from '../../src/bootstrap/index.js';`,
  ],
  [
    'tests/unit/sharing.test.ts',
    "import { normalizeGuestName } from '../../src/modules/sharing/domain/index.js';",
  ],
  [
    'src/entrypoints/http/catalog-routes.ts',
    `import { BoardCatalogService } from '${catalogProtocol}';\nimport type { CatalogApplication } from '@catalog/application/index.js';`,
  ],
  [
    catalog + 'application/duplicate-board.ts',
    "import { normalizeTitle } from '../domain/index.js';\nimport type { CatalogWriter } from '../ports/index.js';",
  ],
  [catalogAdapter + 'index.ts', "import { duplicateBoard } from './duplicate-board.js';"],
  [
    catalogAdapter + 'duplicate-board.ts',
    "import type { CatalogWriter } from '@catalog/ports/index.js';\nimport type { SqliteConnection } from '../../platform/index.js';",
  ],
  [
    whiteboard + 'domain/object-content-edits-table.ts',
    "import type { JsonObject } from './index.js';",
  ],
  [
    whiteboard + 'application/edit-content.ts',
    "import { editTableContent, editEmbedContent } from '../domain/index.js';\nimport type { BoardEditWriter } from '../ports/index.js';",
  ],
  [
    'src/entrypoints/http/content-edits.ts',
    `import type { EditObjectContentRequest } from '${editingProtocol}';\nimport type { BoardEditorApplication } from '@board-app';`,
  ],
  [
    'tests/integration/whiteboard-content-edit.test.ts',
    `import { createWhiteboardServer } from '../../src/bootstrap/index.js';\nimport { BoardEditService } from '${editingProtocol}';`,
  ],
  [
    catalog + 'application/lifecycle.ts',
    "import type { CatalogRepository } from '../ports/index.js';",
  ],
  [
    'src/entrypoints/http/handler.ts',
    `import { open } from '@board-app';\nimport type { MoveObjectsRequest } from '${protocol}';`,
  ],
  [
    whiteboard + 'application/index.ts',
    "import { move } from '../domain/index.js';\nimport type { Ports } from '../ports/index.js';",
  ],
  [whiteboard + 'ports/index.ts', "import { type Scene } from '../domain/index.js';"],
  [whiteboard + 'domain/index.ts', "export { move } from './private.js';"],
  [
    'src/infrastructure/adapters/index.ts',
    "import type { Ports } from '@board/ports/index.js';\nimport { open } from '@platform/index.js';",
  ],
  ['src/infrastructure/platform/index.ts', "import { DatabaseSync } from 'node:sqlite';"],
  [
    'src/bootstrap/index.ts',
    "import { create } from '../entrypoints/http/index.js';\nimport { open } from '../infrastructure/platform/index.js';\nimport process from 'node:process';",
  ],
  [
    'tests/integration/whiteboard.test.ts',
    `import { create } from '../../src/bootstrap/index.js';\nimport { setup } from '../support/server.js';\nimport { MoveObjectsRequestSchema } from '${protocol}';\nimport { expect } from 'vitest';`,
  ],
  [
    'tests/support/server.ts',
    "import { open } from '../../src/infrastructure/platform/index.js';\nimport { board } from '../fixtures/board.js';",
  ],
  [
    'tests/unit/move.test.ts',
    "import { move } from '../../src/modules/whiteboard/domain/index.js';\nimport type { Ports } from '../../src/modules/whiteboard/ports/index.js';\nimport { vi } from 'vitest';",
  ],
  [
    'src/entrypoints/http/catalog.ts',
    `import { list } from '@catalog/application/index.js';\nimport { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    catalog + 'application/index.ts',
    "import { title } from '../domain/index.js';\nimport type { Repository } from '../ports/index.js';",
  ],
  [catalog + 'ports/index.ts', "import type { Board } from '../domain/index.js';"],
  [
    catalogAdapter + 'index.ts',
    "import type { Repository } from '@catalog/ports/index.js';\nimport { open } from '../../platform/index.js';",
  ],
  [
    'src/bootstrap/index.ts',
    "import { list } from '@catalog/application/index.js';\nimport { repository } from '../infrastructure/adapters/catalog/index.js';",
  ],
  [
    'tests/support/catalog.ts',
    "import { repository } from '../../src/infrastructure/adapters/catalog/index.js';",
  ],
  [
    'tests/integration/catalog.test.ts',
    `import { create } from '../../src/bootstrap/index.js';\nimport { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  ['tests/unit/catalog.test.ts', "import { title } from '@catalog/domain/index.js';"],
  [
    'src/entrypoints/http/archives.ts',
    `import { intake } from '@archives/application/index.js';\nimport { ArchiveImportService } from '${archivesProtocol}';`,
  ],
  [
    archives + 'application/index.ts',
    "import { inspect } from '../domain/index.js';\nimport type { ArchiveStore } from '../ports/index.js';",
  ],
  [archives + 'ports/index.ts', "import type { Archive } from '../domain/index.js';"],
  [
    archivesAdapter + 'index.ts',
    "import type { ArchiveStore } from '@archives/ports/index.js';\nimport { open } from '../../platform/index.js';\nimport { stageArchive } from '../../platform/archives/index.js';",
  ],
  [
    archivesPlatform + 'index.ts',
    "import { createHash } from 'node:crypto';\nimport { createReadStream } from 'node:fs';\nimport { mkdtemp } from 'node:fs/promises';\nimport { Readable } from 'node:stream';\nimport { pipeline } from 'node:stream/promises';\nimport { createInflateRaw } from 'node:zlib';",
  ],
  [
    'src/bootstrap/index.ts',
    "import { intake } from '@archives/application/index.js';\nimport { repository } from '../infrastructure/adapters/archives/index.js';",
  ],
  [
    'tests/support/archives.ts',
    "import { repository } from '../../src/infrastructure/adapters/archives/index.js';",
  ],
  [
    'tests/integration/archives.test.ts',
    `import { create } from '../../src/bootstrap/index.js';\nimport { ArchiveImportService } from '${archivesProtocol}';`,
  ],
  [
    'tests/integration/archives-platform/zip-reader.test.ts',
    "import { extractZip } from '../../../src/infrastructure/platform/archives/index.js';",
  ],
  ['tests/unit/archives.test.ts', "import { inspect } from '@archives/domain/index.js';"],
  [
    'src/entrypoints/http/whiteboard-edits.ts',
    `import type { MutateGeometryRequest } from '${editingProtocol}';\nimport type { ListVersionsRequest } from '${historyProtocol}';\nimport { edit } from '@board-app';`,
  ],
  [
    'src/entrypoints/http/feedback.ts',
    `import { createFeedback } from '../../modules/feedback/application/index.js';\nimport type { ApplyFeedbackRequest } from '${feedbackProtocol}';`,
  ],
  [
    feedback + 'application/index.ts',
    "import { createThread } from '../domain/index.js';\nimport type { FeedbackRepository } from '../ports/index.js';",
  ],
  [feedback + 'ports/index.ts', "import type { Thread } from '../domain/index.js';"],
  [
    feedbackAdapter + 'index.ts',
    "import type { FeedbackRepository } from '../../../modules/feedback/ports/index.js';\nimport type { SqliteDatabase } from '../../platform/index.js';\nimport { readBoardAccess } from '../authorization/index.js';",
  ],
  [
    authorizationAdapter + 'index.ts',
    "import type { SqliteConnection } from '../../platform/index.js';",
  ],
  [
    'src/infrastructure/adapters/index.ts',
    "import { readBoardAccess } from './authorization/index.js';",
  ],
  [
    'src/bootstrap/index.ts',
    "import { createFeedback } from '../modules/feedback/application/index.js';\nimport { createRepository } from '../infrastructure/adapters/feedback/index.js';",
  ],
  [
    'tests/integration/feedback.test.ts',
    `import { create } from '../../src/bootstrap/index.js';\nimport type { ListThreadsRequest } from '${feedbackProtocol}';`,
  ],
  [
    'tests/support/edit-protocol.ts',
    `import type { ExportVersionRequest } from '${historyProtocol}';\nimport type { AttachBoardImageRequest } from '${editingProtocol}';`,
  ],
  [
    'src/entrypoints/http/video-edits.ts',
    `import type { AttachBoardVideoRequest } from '${editingProtocol}';\nimport type { VideoOperation } from '../../modules/whiteboard/application/index.js';`,
  ],
  [
    'tests/unit/feedback.test.ts',
    "import { createThread } from '../../src/modules/feedback/domain/index.js';\nimport type { FeedbackRepository } from '../../src/modules/feedback/ports/index.js';",
  ],
];

for (const [file, code] of permitted) {
  test('accepts approved imports in ' + file, async () => {
    deepEqual(await inspect(file, code), []);
  });
}

const rejected = [
  [
    'whiteboard HTTP reaches palette persistence directly',
    'src/entrypoints/http/geometry-edits.ts',
    "import { writeBoardCustomColors } from '../../infrastructure/adapters/board-custom-colors.js';",
  ],
  [
    'whiteboard ports re-export palette domain runtime values',
    whiteboard + 'ports/index.ts',
    "export { normalizeBoardCustomColor } from '../domain/index.js';",
  ],
  [
    'room business logic reaches the HTTP streaming SDK',
    rooms + 'application/private.ts',
    "import { connectNodeAdapter } from '@connectrpc/connect-node';",
  ],
  [
    'an unrelated HTTP route mounts the room streaming SDK',
    'src/entrypoints/http/guest-sharing.ts',
    "import { createContextValues } from '@connectrpc/connect';",
  ],
  [
    'suggestion application consumes the wire request instead of domain input',
    whiteboard + 'application/board-suggestions.ts',
    `import type { SubmitSuggestionRequest } from '${suggestionsProtocol}';`,
  ],
  [
    'suggestion persistence imports wire messages',
    'src/infrastructure/adapters/board-suggestions.ts',
    `import type { Suggestion } from '${suggestionsProtocol}';`,
  ],
  [
    'suggestion application derives authority from the HTTP entrypoint',
    whiteboard + 'application/board-suggestions.ts',
    "import type { HttpActor } from '../../../entrypoints/http/unary-route.js';",
  ],
  [
    'suggestion HTTP bypasses the whiteboard application public entry',
    'src/entrypoints/http/suggestion-routes.ts',
    "import { acceptSuggestion } from '@board/application/private.js';",
  ],
  [
    'MCP cannot use the human suggestion acceptance protocol directly',
    'src/entrypoints/mcp/thread-suggestions.ts',
    `import { AcceptSuggestionRequestSchema } from '${suggestionsProtocol}';`,
  ],
  [
    'MCP general entry cannot use the room protocol directly',
    'src/entrypoints/mcp/index.ts',
    `import { BoardRoomService } from '${roomsProtocol}';`,
  ],
  [
    'Agent activity adapter cannot use the board edit wire',
    'src/entrypoints/mcp/agent-activity.ts',
    `import { BoardEditService } from '${editingProtocol}';`,
  ],
  [
    'the Agent activity test cannot reach private MCP files',
    'tests/integration/mcp-agent-activity.test.ts',
    "import { privateTools } from '../../src/entrypoints/mcp/private.js';",
  ],
  [
    'other integration tests cannot reach the MCP server directly',
    'tests/integration/rooms-http.test.ts',
    "import { createStudioMcpServer } from '../../src/entrypoints/mcp/index.js';",
  ],
  [
    'the production MCP adapter cannot use the in-memory test transport',
    'src/entrypoints/mcp/agent-activity.ts',
    `import { InMemoryTransport } from '${mcpTestTransport}';`,
  ],
  [
    'MCP cannot use the board edit wire to apply a proposal directly',
    'src/entrypoints/mcp/thread-suggestions.ts',
    `import { BoardEditService } from '${editingProtocol}';`,
  ],
  [
    'MCP cannot invoke the private suggestion application directly',
    'src/entrypoints/mcp/thread-suggestions.ts',
    "import { acceptSuggestion } from '@board/application/private.js';",
  ],
  [
    'MCP entrypoint cannot open the runtime process or filesystem directly',
    'src/entrypoints/mcp/index.ts',
    "import { spawn } from 'node:child_process';",
  ],
  [
    'other platform files cannot start an MCP process',
    'src/infrastructure/platform/guest-web.ts',
    "import { spawn } from 'node:child_process';",
  ],
  [
    'other platform files cannot read host input streams',
    'src/infrastructure/platform/index.ts',
    "import { createInterface } from 'node:readline';",
  ],
  [
    'bootstrap cannot create an MCP runtime filesystem lock directly',
    'src/bootstrap/index.ts',
    "import lockfile from 'proper-lockfile';",
  ],
  [
    'other platform files cannot create runtime locks',
    'src/infrastructure/platform/mcp-spool.ts',
    "import lockfile from 'proper-lockfile';",
  ],
  [
    'the application cannot import the platform PNG renderer dependency',
    whiteboard + 'application/export-board.ts',
    "import { Resvg } from '@resvg/resvg-wasm';",
  ],
  [
    'feedback domain cannot import the HTML content parser',
    'src/modules/feedback/domain/anchor.ts',
    "import { parse } from 'parse5';",
  ],
  [
    'the catalogue application cannot import the thumbnail HTML parser dependency',
    catalog + 'application/catalog-thumbnail.ts',
    "import { parse } from 'parse5';",
  ],
  [
    'the catalogue application cannot import sticker artwork',
    catalog + 'application/catalog-thumbnail.ts',
    "import { stickerDefinition } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/stickers';",
  ],
  [
    'MCP entrypoint calls the whiteboard application instead of injected operations',
    'src/entrypoints/mcp/thread-operations.ts',
    "import { createWhiteboardApplication } from '@board-app';",
  ],
  [
    'MCP entrypoint loads catalogue protocol instead of an injected catalogue operation',
    'src/entrypoints/mcp/thread-operations.ts',
    `import { BoardCatalogService } from '${catalogProtocol}';`,
  ],
  [
    'HTTP entrypoint imports a Thread tool schema library',
    'src/entrypoints/http/index.ts',
    "import { z } from 'zod';",
  ],
  [
    'MCP entrypoint reads a thread HTML file directly',
    'src/entrypoints/mcp/thread-resource.ts',
    "import { readFile } from 'node:fs/promises';",
  ],
  [
    'MCP entrypoint uses a platform resource reader without injection',
    'src/entrypoints/mcp/thread-resource.ts',
    "import { openThreadResource } from '../../infrastructure/platform/index.js';",
  ],
  [
    'MCP entrypoint opens SQLite directly',
    'src/entrypoints/mcp/thread-operations.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'MCP entrypoint bypasses injected operations and reads object persistence',
    'src/entrypoints/mcp/thread-operations.ts',
    "import { createWhiteboardRepository } from '../../infrastructure/adapters/index.js';",
  ],
  [
    'MCP entrypoint reuses visitor cookie resolution',
    'src/entrypoints/mcp/thread-operations.ts',
    "import { resolveGuestActor } from '../http/guest-sharing.js';",
  ],
  [
    'MCP entrypoint issues outbound HTTP requests',
    'src/entrypoints/mcp/thread-operations.ts',
    'const result = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'MCP entrypoint reads host configuration directly',
    'src/entrypoints/mcp/index.ts',
    'const location = process.env.STUDIO_ROOT;',
    'no-restricted-globals',
  ],
  [
    'MCP entrypoint reaches host configuration via the global object',
    'src/entrypoints/mcp/index.ts',
    'const location = globalThis.process.env.STUDIO_ROOT;',
    'no-restricted-globals',
  ],
  [
    'MCP entrypoint loads the SDK client surface',
    'src/entrypoints/mcp/index.ts',
    "import { Client } from '@modelcontextprotocol/sdk/client/index.js';",
  ],
  [
    'bootstrap reaches the private Thread entrypoint',
    'src/bootstrap/index.ts',
    "import { startThreadMcp } from '../entrypoints/mcp/private.js';",
  ],
  [
    'bootstrap uses the MCP transport SDK directly',
    'src/bootstrap/index.ts',
    `import { StdioServerTransport } from '${mcpStdioSdk}';`,
  ],
  [
    'whiteboard application imports the MCP SDK',
    whiteboard + 'application/index.ts',
    `import { McpServer } from '${mcpServerSdk}';`,
  ],
  [
    'HTTP entrypoint imports MCP app resource registration',
    'src/entrypoints/http/index.ts',
    `import { registerAppResource } from '${mcpAppServerSdk}';`,
  ],
  [
    'HTTP entrypoint imports OpenAI MCP host capabilities',
    'src/entrypoints/http/index.ts',
    `import '${openAiMcpServerSdk}';`,
  ],
  [
    'archived asset authorization bypasses the public adapter entry',
    archivesAdapter + 'publication.ts',
    "import { readBoardAccess } from '../authorization/private.js';",
  ],
  [
    'bootstrap bypasses the public authorization adapter entry',
    'src/bootstrap/index.ts',
    "import { readBoardAccess } from '../infrastructure/adapters/authorization/private.js';",
  ],
  [
    'authorization adapter imports archive publication machinery',
    authorizationAdapter + 'index.ts',
    "import { createArchiveImportRepository } from '../archives/index.js';",
  ],
  [
    'room HTTP inspects domain room states directly',
    'src/entrypoints/http/room-routes.ts',
    "import { deriveTimer } from '../../modules/rooms/domain/index.js';",
  ],
  [
    'room HTTP bypasses the application entry',
    'src/entrypoints/http/room-routes.ts',
    "import { followViewport } from '../../modules/rooms/application/private.js';",
  ],
  [
    'room HTTP reaches the real-time state adapter',
    'src/entrypoints/http/room-routes.ts',
    "import { createRoomsRuntime } from '../../infrastructure/adapters/rooms/index.js';",
  ],
  [
    'room application reads sharing services instead of its scoped authorization port',
    rooms + 'application/index.ts',
    "import type { SharingApplication } from '../../sharing/application/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'room application consumes a generated motion frame',
    rooms + 'application/index.ts',
    `import type { UpdateRoomPresenceRequest } from '${roomsProtocol}';`,
    boundaryRule,
    'dependency',
  ],
  [
    'room domain reads the host timer directly',
    rooms + 'domain/index.ts',
    'const elapsed = Date.now();',
    'no-restricted-globals',
  ],
  [
    'room domain fetches peer presence directly',
    rooms + 'domain/index.ts',
    'const response = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'room domain imports SQLite',
    rooms + 'domain/index.ts',
    "import { DatabaseSync } from 'node:sqlite';",
    boundaryRule,
    'dependency',
  ],
  [
    'room ports import mutable domain implementation',
    rooms + 'ports/index.ts',
    "import { deriveTimer } from '../domain/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'room adapter wires authorization directly instead of using composition',
    roomsAdapter + 'index.ts',
    "import { readBoardAccess } from '../authorization/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'room adapter takes a whiteboard storage port for movement frames',
    roomsAdapter + 'index.ts',
    "import type { WhiteboardRepository } from '@board/ports/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'room adapter enters sharing persistence internals',
    roomsAdapter + 'index.ts',
    "import { resolveGuest } from '../sharing/private.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'MCP imports room HTTP wire contracts',
    'src/entrypoints/mcp/runtime.ts',
    `import { BoardRoomsService } from '${roomsProtocol}';`,
  ],
  [
    'room integration tests bypass server composition',
    'tests/integration/rooms-http.test.ts',
    "import { createRoomsRuntime } from '../../src/infrastructure/adapters/rooms/index.js';",
  ],
  [
    'sharing HTTP bypasses the application to infer authorization in the domain',
    'src/entrypoints/http/share-routes.ts',
    "import { resolveGuestRole } from '../../modules/sharing/domain/index.js';",
  ],
  [
    'sharing HTTP reaches the private guest credential implementation',
    'src/entrypoints/http/share-routes.ts',
    "import { resolveGuest } from '../../modules/sharing/application/private.js';",
  ],
  [
    'sharing HTTP accesses persisted guest sessions directly',
    'src/entrypoints/http/share-routes.ts',
    "import { createSharingRepository } from '../../infrastructure/adapters/sharing/index.js';",
  ],
  [
    'sharing HTTP opens SQLite directly',
    'src/entrypoints/http/share-routes.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'sharing application reads caller identity from transport internals',
    sharing + 'application/index.ts',
    "import type { HttpActor } from '../../../entrypoints/http/unary-route.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'sharing application uses wire identity data as a domain principal',
    sharing + 'application/index.ts',
    `import type { JoinBoardRequest } from '${sharingProtocol}';`,
    boundaryRule,
    'dependency',
  ],
  [
    'sharing application generates session credentials outside an injected capability',
    sharing + 'application/index.ts',
    "import { randomBytes } from 'node:crypto';",
    boundaryRule,
    'dependency',
  ],
  [
    'sharing domain generates unpredictable session identity directly',
    sharing + 'domain/index.ts',
    'const session = crypto.randomUUID();',
    'no-restricted-globals',
  ],
  [
    'sharing domain uses weak host randomness for invite codes',
    sharing + 'domain/index.ts',
    'const candidate = Math.random();',
    'no-restricted-properties',
  ],
  [
    'sharing ports import domain values',
    sharing + 'ports/index.ts',
    "import { normalizeGuestName } from '../domain/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'sharing application calls the private whiteboard entry to elevate a guest',
    sharing + 'application/index.ts',
    "import { open } from '@board/application/private.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'sharing adapter reaches catalogue persistence internals',
    sharingAdapter + 'index.ts',
    "import { update } from '../catalog/private.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'sharing adapter bypasses the public authorization entry',
    sharingAdapter + 'index.ts',
    "import { readBoardAccess } from '../authorization/private.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'MCP imports guest HTTP wire contracts',
    'src/entrypoints/mcp/runtime.ts',
    `import { BoardSharingService } from '${sharingProtocol}';`,
  ],
  [
    'sharing integration tests skip server composition and use a session adapter',
    'tests/integration/sharing-http.test.ts',
    "import { createSharingRepository } from '../../src/infrastructure/adapters/sharing/index.js';",
  ],
  [
    'copy HTTP reaches the catalogue duplication adapter',
    'src/entrypoints/http/catalog-routes.ts',
    "import { duplicateBoard } from '../../infrastructure/adapters/catalog/duplicate-board.js';",
  ],
  [
    'copy HTTP opens SQLite directly',
    'src/entrypoints/http/catalog-routes.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'copy application reads generated requests rather than domain inputs',
    catalog + 'application/duplicate-board.ts',
    `import type { DuplicateBoardRequest } from '${catalogProtocol}';`,
  ],
  [
    'copy application enters a catalogue port implementation detail',
    catalog + 'application/duplicate-board.ts',
    "import type { CatalogWriter } from '../ports/private.js';",
  ],
  [
    'copy application bypasses ports and enters the duplicate adapter',
    catalog + 'application/duplicate-board.ts',
    "import { duplicateBoard } from '../../../infrastructure/adapters/catalog/duplicate-board.js';",
  ],
  [
    'copy adapter imports a private whiteboard application',
    catalogAdapter + 'duplicate-board.ts',
    "import { copyScene } from '@board/application/private.js';",
  ],
  [
    'copy adapter imports the private whiteboard persistence implementation',
    catalogAdapter + 'duplicate-board.ts',
    "import { applyBoardChanges } from '../board-edit-storage.js';",
  ],
  [
    'copy adapter opens the host database outside platform',
    catalogAdapter + 'duplicate-board.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'table content domain consumes a generated payload schema',
    whiteboard + 'domain/object-content-edits-table.ts',
    "import { TablePayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';",
  ],
  [
    'embed content domain fetches remote content directly',
    whiteboard + 'domain/object-content-edits-embed.ts',
    'const content = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'sticker content domain reads a host file directly',
    whiteboard + 'domain/object-content-edits-sticker.ts',
    "import { readFile } from 'node:fs/promises';",
  ],
  [
    'crop content domain takes SQLite access',
    whiteboard + 'domain/object-content-edits-crop.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'video content domain reads files directly',
    whiteboard + 'domain/video-edits.ts',
    "import { readFile } from 'node:fs/promises';",
  ],
  [
    'video attachment domain imports its generated wire contract',
    whiteboard + 'domain/video-edits.ts',
    `import type { AttachBoardVideoRequest } from '${editingProtocol}';`,
  ],
  [
    'video HTTP bypasses application and accesses asset storage',
    'src/entrypoints/http/video-edits.ts',
    "import { applyBoardChanges } from '../../infrastructure/adapters/board-edit-storage.js';",
  ],
  [
    'embed content domain uses a generated codec',
    whiteboard + 'domain/object-content-edits-embed.ts',
    "import { fromBinary } from '@bufbuild/protobuf';",
  ],
  [
    'sticker application bypasses the public domain entry',
    whiteboard + 'application/edit-content.ts',
    "import { editStickerContent } from '../domain/private.js';",
  ],
  [
    'content application takes the object table adapter',
    whiteboard + 'application/edit-content.ts',
    "import { applyBoardChanges } from '../../../infrastructure/adapters/board-edit-storage.js';",
  ],
  [
    'content HTTP bypasses the application and accesses the object table adapter',
    'src/entrypoints/http/content-edits.ts',
    "import { applyBoardChanges } from '../../infrastructure/adapters/board-edit-storage.js';",
  ],
  [
    'content HTTP opens SQLite directly',
    'src/entrypoints/http/content-edits.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'feedback domain uses SQLite outside a declared port',
    feedback + 'domain/index.ts',
    "import { DatabaseSync } from 'node:sqlite';",
    boundaryRule,
    'dependency',
  ],
  [
    'feedback domain uses host networking',
    feedback + 'domain/index.ts',
    'const payload = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'feedback application uses the host clock',
    feedback + 'application/index.ts',
    'const time = Date.now();',
    'no-restricted-globals',
  ],
  [
    'feedback consumes generated messages in a domain',
    feedback + 'domain/index.ts',
    `import type { ApplyFeedbackRequest } from '${feedbackProtocol}';`,
    boundaryRule,
    'dependency',
  ],
  [
    'feedback application takes a dependency on whiteboard writes',
    feedback + 'application/index.ts',
    "import { move } from '@board-app';",
    boundaryRule,
    'dependency',
  ],
  [
    'feedback application reaches an owning adapter',
    feedback + 'application/index.ts',
    "import { readBoardAccess } from '../../../infrastructure/adapters/authorization/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'feedback ports take domain runtime values',
    feedback + 'ports/index.ts',
    "import { createThread } from '../domain/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'feedback adapter takes whiteboard ports',
    feedbackAdapter + 'index.ts',
    "import type { WhiteboardRepository } from '@board/ports/index.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'feedback adapter bypasses the public authorization boundary',
    feedbackAdapter + 'index.ts',
    "import { readBoardAccess } from '../authorization/private.js';",
    boundaryRule,
    'dependency',
  ],
  [
    'authorization adapter accesses Node SQLite rather than platform',
    authorizationAdapter + 'index.ts',
    "import { DatabaseSync } from 'node:sqlite';",
    boundaryRule,
    'dependency',
  ],
  [
    'HTTP bypasses the feedback public application',
    'src/entrypoints/http/feedback.ts',
    "import { createFeedback } from '../../modules/feedback/application/private.js';",
  ],
  [
    'HTTP accesses the feedback adapter',
    'src/entrypoints/http/feedback.ts',
    "import { createRepository } from '../../infrastructure/adapters/feedback/index.js';",
  ],
  [
    'bootstrap bypasses the feedback adapter boundary',
    'src/bootstrap/index.ts',
    "import { createRepository } from '../infrastructure/adapters/feedback/private.js';",
  ],
  [
    'geometry application imports a generated write request',
    whiteboard + 'application/edit-geometry.ts',
    `import type { MutateGeometryRequest } from '${editingProtocol}';`,
  ],
  [
    'history ports consume generated payloads',
    whiteboard + 'ports/history.ts',
    `import type { GetVersionPayloadsRequest } from '${historyProtocol}';`,
  ],
  [
    'MCP imports an HTTP feedback wire contract',
    'src/entrypoints/mcp/runtime.ts',
    `import type { ApplyFeedbackRequest } from '${feedbackProtocol}';`,
  ],
  [
    'media adapters access the file system directly',
    'src/infrastructure/adapters/media.ts',
    "import { readFile } from 'node:fs/promises';",
  ],
  [
    'feedback integration tests bypass bootstrap and construct the application',
    'tests/integration/feedback.test.ts',
    "import { createFeedback } from '../../src/modules/feedback/application/index.js';",
  ],
  [
    'feedback unit tests consume generated requests',
    'tests/unit/feedback.test.ts',
    `import type { ApplyFeedbackRequest } from '${feedbackProtocol}';`,
  ],
  [
    'whiteboard export reaches the filesystem instead of the repository port',
    whiteboard + 'application/export-board.ts',
    "import { readFile } from 'node:fs/promises';",
  ],
  [
    'whiteboard export imports the generated response',
    whiteboard + 'application/export-board.ts',
    `import { ExportBoardResponseSchema } from '${protocol}';`,
  ],
  [
    'catalogue lifecycle uses the SQLite host directly',
    catalog + 'application/lifecycle.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'catalogue lifecycle uses a generated purge request',
    catalog + 'application/lifecycle.ts',
    `import type { PurgeBoardsRequest } from '${catalogProtocol}';`,
  ],
  [
    'an archive adapter bypasses the catalogue lifecycle through its private repository',
    archivesAdapter + 'publication.ts',
    "import { purgeBoards } from '../catalog/lifecycle.js';",
  ],
  [
    'HTTP reaches private archive application code',
    'src/entrypoints/http/archives.ts',
    "import { intake } from '@archives/application/private.js';",
  ],
  [
    'HTTP calls archive domain directly',
    'src/entrypoints/http/archives.ts',
    "import { inspect } from '@archives/domain/index.js';",
  ],
  [
    'HTTP calls the archive filesystem platform',
    'src/entrypoints/http/archives.ts',
    "import { stageArchive } from '../../infrastructure/platform/archives/index.js';",
  ],
  [
    'HTTP imports an internal archive protocol',
    'src/entrypoints/http/archives.ts',
    `import { ArchiveImportService } from '${archivesProtocol}/private';`,
  ],
  [
    'MCP imports the archive HTTP protocol',
    'src/entrypoints/mcp/archives.ts',
    `import { ArchiveImportService } from '${archivesProtocol}';`,
  ],
  [
    'archive application imports a catalog application',
    archives + 'application/index.ts',
    "import { list } from '@catalog/application/index.js';",
  ],
  [
    'catalog application imports an archive application',
    catalog + 'application/index.ts',
    "import { intake } from '@archives/application/index.js';",
  ],
  [
    'archive application uses generated receipts',
    archives + 'application/index.ts',
    `import type { ImportReceipt } from '${archivesProtocol}';`,
  ],
  [
    'archive application accesses the host directly',
    archives + 'application/index.ts',
    'const response = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'archive domain imports Node streams',
    archives + 'domain/index.ts',
    "import type { Readable } from 'node:stream';",
  ],
  [
    'archive ports import runtime domain code',
    archives + 'ports/index.ts',
    "import { inspect } from '../domain/index.js';",
  ],
  [
    'an unclassified archive module leaf',
    archives + 'index.ts',
    'export {};',
    boundaryRule,
    'location',
  ],
  [
    'archive adapter reaches a private platform file',
    archivesAdapter + 'index.ts',
    "import { stageArchive } from '../../platform/archives/private.js';",
  ],
  [
    'archive adapter bypasses the platform ZIP capability',
    archivesAdapter + 'index.ts',
    "import { createInflateRaw } from 'node:zlib';",
  ],
  [
    'archive adapter bypasses the platform digest capability',
    archivesAdapter + 'index.ts',
    "import { createHash } from 'node:crypto';",
  ],
  [
    'legacy platform pulls the archive platform in through its own namespace',
    'src/infrastructure/platform/index.ts',
    "import { stageArchive } from './archives/index.js';",
  ],
  [
    'archive platform opens a database directly',
    archivesPlatform + 'index.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'catalog adapter imports the archives adapter',
    catalogAdapter + 'index.ts',
    "import { repository } from '../archives/index.js';",
  ],
  [
    'archive adapter imports a whiteboard port',
    archivesAdapter + 'index.ts',
    "import type { Ports } from '@board/ports/index.js';",
  ],
  [
    'bootstrap bypasses the archive adapter public entry',
    'src/bootstrap/index.ts',
    "import { repository } from '../infrastructure/adapters/archives/private.js';",
  ],
  [
    'test support bypasses the archive adapter',
    'tests/support/archives.ts',
    "import { stageArchive } from '../../src/infrastructure/platform/archives/index.js';",
  ],
  [
    'a business integration test bypasses the archive application',
    'tests/integration/archives.test.ts',
    "import { extractZip } from '../../src/infrastructure/platform/archives/index.js';",
  ],
  [
    'a platform regression test reaches a private archive file',
    'tests/integration/archives-platform/zip-reader.test.ts',
    "import { extractZip } from '../../../src/infrastructure/platform/archives/private.js';",
  ],
  [
    'a platform regression test reaches an archive application',
    'tests/integration/archives-platform/zip-reader.test.ts',
    "import { intake } from '@archives/application/index.js';",
  ],
  [
    'HTTP reaches the private application',
    'src/entrypoints/http/handler.ts',
    "import { open } from '@board/application/private.js';",
  ],
  [
    'HTTP bypasses the application',
    'src/entrypoints/http/handler.ts',
    "import { move } from '../../modules/whiteboard/domain/index.js';",
  ],
  [
    'a re-export bypasses the application',
    'src/entrypoints/http/index.ts',
    "export * from '../../infrastructure/adapters/index.js';",
  ],
  [
    'a public entry publishes all private exports',
    whiteboard + 'application/index.ts',
    "export * from './private.js';",
    boundaryRule,
    'reexport',
  ],
  [
    'the application republishes a domain function',
    whiteboard + 'application/index.ts',
    "export { move } from '../domain/index.js';",
    boundaryRule,
    'reexport',
  ],
  [
    'the application republishes an imported capability under an alias',
    whiteboard + 'application/index.ts',
    "import { move as perform } from '../domain/index.js';\n\nexport { perform as handleMove };",
    boundaryRule,
    'reexport',
  ],
  [
    'the platform republishes the SQLite driver',
    'src/infrastructure/platform/index.ts',
    "export { DatabaseSync } from 'node:sqlite';",
    boundaryRule,
    'reexport',
  ],
  [
    'the platform publishes the SQLite driver as its default export',
    'src/infrastructure/platform/index.ts',
    "import { DatabaseSync } from 'node:sqlite';\n\nexport default DatabaseSync;",
    boundaryRule,
    'reexport',
  ],
  [
    'a type alias reaches the private application',
    'src/entrypoints/http/handler.ts',
    "type Command = import('@board/application/private.js').Command;",
  ],
  [
    'a dynamic import bypasses the application',
    'src/entrypoints/http/handler.ts',
    "const storage = import('../../infrastructure/platform/index.js');",
  ],
  [
    'an unknown local import',
    'src/entrypoints/http/handler.ts',
    "import { open } from './missing.js';",
    boundaryRule,
    'unresolved',
  ],
  [
    'a nonliteral dynamic reference',
    'src/entrypoints/http/handler.ts',
    'const storage = import(process.env.HANDLER);',
    boundaryRule,
    'unresolved',
  ],
  [
    'bootstrap resolves a builtin through the process object',
    'src/bootstrap/index.ts',
    "const sqlite = process.getBuiltinModule('node:sqlite');",
    'no-restricted-syntax',
  ],
  [
    'an unclassified source directory',
    'src/misc/server.ts',
    'export {};',
    boundaryRule,
    'location',
  ],
  [
    'application depends on the generated protocol',
    whiteboard + 'application/index.ts',
    `import type { MoveObjectsRequest } from '${protocol}';`,
  ],
  [
    'domain imports a host library',
    whiteboard + 'domain/index.ts',
    "import { existsSync } from 'node:fs';",
  ],
  [
    'domain invokes a host global',
    whiteboard + 'domain/index.ts',
    'const response = fetch(url);',
    'no-restricted-globals',
  ],
  [
    'domain reaches a host clock',
    whiteboard + 'domain/index.ts',
    'const time = Date.now();',
    'no-restricted-globals',
  ],
  [
    'domain accesses an aliased host through globalThis',
    whiteboard + 'domain/index.ts',
    'const host = globalThis;\nconst process = host.process;',
    'no-restricted-globals',
  ],
  [
    'ports import domain implementation values',
    whiteboard + 'ports/index.ts',
    "import { move } from '../domain/index.js';",
  ],
  [
    'SQLite driver in an adapter',
    'src/infrastructure/adapters/index.ts',
    "import { DatabaseSync } from 'node:sqlite';",
  ],
  [
    'adapter calls the application backwards',
    'src/infrastructure/adapters/index.ts',
    "import { open } from '@board-app';",
  ],
  [
    'platform imports a module concept',
    'src/infrastructure/platform/index.ts',
    "import type { Scene } from '../../modules/whiteboard/domain/index.js';",
  ],
  [
    'bootstrap bypasses an adapter public entry',
    'src/bootstrap/index.ts',
    "import { repository } from '../infrastructure/adapters/private.js';",
  ],
  [
    'an internal protocol package subpath',
    'src/entrypoints/http/handler.ts',
    "import { SceneSchema } from '@codexworkbench/luming-studio-ii-contracts/private/scene';",
  ],
  [
    'integration bypasses public bootstrap',
    'tests/integration/whiteboard.test.ts',
    "import { open } from '../../src/infrastructure/adapters/index.js';",
  ],
  [
    'integration imports a unit double',
    'tests/integration/whiteboard.test.ts',
    "import { repository } from '../unit/double.js';",
  ],
  [
    'integration imports a renamed Vitest mocking runner',
    'tests/integration/whiteboard.test.ts',
    "import { vi as runner } from 'vitest';",
    'no-restricted-syntax',
  ],
  [
    'integration invokes a Node test context mock',
    'tests/integration/whiteboard.test.ts',
    "function replace(testContext) {\n  testContext['mock'].method(repository, 'move', substitute);\n}",
    'no-restricted-syntax',
  ],
  [
    'integration destructures and renames the Node test mock',
    'tests/integration/whiteboard.test.ts',
    "import test from 'node:test';\n\nconst { mock: substitute } = test;",
    'no-restricted-syntax',
  ],
  [
    'fixtures import a service directly',
    'tests/fixtures/board.ts',
    "import { open } from '../../src/modules/whiteboard/application/index.js';",
  ],
  [
    'the common no-source-comments rule',
    whiteboard + 'domain/index.ts',
    '// explanation\nexport {};',
    'studio/no-source-comments',
  ],
  [
    'the common nesting limit',
    whiteboard + 'domain/index.ts',
    'function deep(a, b, c, d) {\n if (a) {\n  if (b) {\n   if (c) {\n    if (d) {\n     result();\n    }\n   }\n  }\n }\n}',
    'max-depth',
  ],
  [
    'HTTP reaches a private catalog application file',
    'src/entrypoints/http/catalog.ts',
    "import { list } from '@catalog/application/private.js';",
  ],
  [
    'HTTP bypasses the catalog application',
    'src/entrypoints/http/catalog.ts',
    "import type { Board } from '@catalog/domain/index.js';",
  ],
  [
    'catalog imports whiteboard application APIs',
    catalog + 'application/index.ts',
    "import { open } from '@board-app';",
  ],
  [
    'whiteboard reaches catalog internals',
    whiteboard + 'domain/index.ts',
    "import type { Board } from '@catalog/domain/private.js';",
  ],
  [
    'catalog ports import domain runtime values',
    catalog + 'ports/index.ts',
    "import { title } from '../domain/index.js';",
  ],
  [
    'catalog reads generated requests in its application',
    catalog + 'application/index.ts',
    `import type { ListBoardsRequest } from '${catalogProtocol}';`,
  ],
  [
    'catalog reads the host clock in its domain',
    catalog + 'domain/index.ts',
    'const time = Date.now();',
    'no-restricted-globals',
  ],
  [
    'catalog performs host I/O in its port',
    catalog + 'ports/index.ts',
    'const response = fetch(url);',
    'no-restricted-globals',
  ],
  ['an unclassified catalog leaf', catalog + 'index.ts', 'export {};', boundaryRule, 'location'],
  [
    'catalog adapter reaches whiteboard adapter internals',
    catalogAdapter + 'index.ts',
    "import { sql } from '../private.js';",
  ],
  [
    'whiteboard adapters import catalog adapters',
    'src/infrastructure/adapters/index.ts',
    "import { repository } from './catalog/index.js';",
  ],
  [
    'catalog adapter imports another context port',
    catalogAdapter + 'index.ts',
    "import type { Ports } from '@board/ports/index.js';",
  ],
  [
    'bootstrap bypasses the catalog adapter public entry',
    'src/bootstrap/index.ts',
    "import { repository } from '../infrastructure/adapters/catalog/private.js';",
  ],
  [
    'integration bypasses bootstrap and imports a catalog adapter',
    'tests/integration/catalog.test.ts',
    "import { repository } from '../../src/infrastructure/adapters/catalog/index.js';",
  ],
];

for (const [name, file, code, rule = boundaryRule, message] of rejected) {
  test('rejects ' + name, async () => {
    const reports = await inspect(file, code);
    const matched = reports.some(
      ({ ruleId, messageId }) => ruleId === rule && (!message || message === messageId),
    );

    equal(matched, true, JSON.stringify(reports));
  });
}
