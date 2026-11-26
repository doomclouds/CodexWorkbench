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
const catalogAdapter = 'src/infrastructure/adapters/catalog/';
const archivesAdapter = 'src/infrastructure/adapters/archives/';
const archivesPlatform = 'src/infrastructure/platform/archives/';
const protocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
const catalogProtocol = '@codexworkbench/luming-studio-ii-contracts/catalog/service';
const archivesProtocol = '@codexworkbench/luming-studio-ii-contracts/archives/service';
const boundaryRule = 'server/contract-boundary';

const fixtureFiles = [
  'src/bootstrap/index.ts',
  'src/entrypoints/http/index.ts',
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
  catalogAdapter + 'index.ts',
  catalogAdapter + 'private.ts',
  archives + 'application/index.ts',
  archives + 'application/private.ts',
  archives + 'domain/index.ts',
  archives + 'ports/index.ts',
  archivesAdapter + 'index.ts',
  archivesAdapter + 'private.ts',
  archivesPlatform + 'index.ts',
  archivesPlatform + 'private.ts',
  'src/infrastructure/adapters/index.ts',
  'src/infrastructure/adapters/private.ts',
  'src/infrastructure/platform/index.ts',
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
];

for (const [file, code] of permitted) {
  test('accepts approved imports in ' + file, async () => {
    deepEqual(await inspect(file, code), []);
  });
}

const rejected = [
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
