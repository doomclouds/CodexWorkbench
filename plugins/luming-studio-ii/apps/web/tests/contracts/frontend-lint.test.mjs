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

const accepted = [
  ['src/app/main.tsx', "import { createRoot } from 'react-dom/client';"],
  ['src/app/main.tsx', "import { WhiteboardPage } from '../pages/whiteboard/index.js';"],
  ['src/app/main.tsx', "import { createTransport } from '../platform/transport/index.js';"],
  [page, "import { WhiteboardEditor } from '../../surfaces/whiteboard-editor/index.js';"],
  [page, "import type { WhiteboardClient } from '../../data/whiteboard/index.js';"],
  [surface, "import { createProjection } from '../../data/whiteboard/index.js';"],
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
];

const rejected = [
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
