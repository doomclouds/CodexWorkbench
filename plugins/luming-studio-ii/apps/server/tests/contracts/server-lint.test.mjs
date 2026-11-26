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
const protocol = '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
const boundaryRule = 'server/contract-boundary';

const fixtureFiles = [
  'src/bootstrap/index.ts',
  'src/entrypoints/http/index.ts',
  whiteboard + 'application/index.ts',
  whiteboard + 'application/private.ts',
  whiteboard + 'domain/index.ts',
  whiteboard + 'domain/private.ts',
  whiteboard + 'ports/index.ts',
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
];

for (const [file, code] of permitted) {
  test('accepts approved imports in ' + file, async () => {
    deepEqual(await inspect(file, code), []);
  });
}

const rejected = [
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
