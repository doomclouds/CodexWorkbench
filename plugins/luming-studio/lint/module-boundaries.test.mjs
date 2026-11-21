import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findModuleBoundaryProblems } from './module-boundaries.mjs';

const studioRoot = fileURLToPath(new URL('../', import.meta.url));

describe('Studio module boundaries', () => {
  const forbiddenImports = [
    [
      'shell imported by a feature',
      'src/app/features/whiteboard/canvas/probe.ts',
      "type Shell = import('../../../shell/StudioApp.js').StudioAppProps;",
    ],
    [
      'private page controls imported by the shell',
      'src/app/shell/probe.ts',
      "export { LibraryToolbar } from '../pages/library/LibraryToolbar.js';",
    ],
    [
      'a public feature imported by the shell',
      'src/app/shell/probe.ts',
      "import { whiteboardProduct } from '../features/whiteboard/whiteboard.js';",
    ],
    [
      'a client adapter imported outside the application entry',
      'src/app/shell/probe.ts',
      "import { studioRequest } from '../transport/client.js';",
    ],
    [
      'a page imported by a feature',
      'src/app/features/whiteboard/canvas/probe.ts',
      "import { StudioEditorView } from '../../../pages/editor/StudioEditorView.js';",
    ],
    [
      'another page’s internal module imported by a page',
      'src/app/pages/editor/probe.ts',
      "import { LibraryToolbar } from '../library/LibraryToolbar.js';",
    ],
    [
      'core service imported directly by the app',
      'src/app/shared/probe.ts',
      "import { StudioService } from '../../core/service.js';",
    ],
    [
      'feature internals imported by app shared code',
      'src/app/shared/probe.ts',
      "type Geometry = import('../features/whiteboard/canvas/scene/canvas-model.js').Rect;",
    ],
    [
      'a private feedback view imported by a page',
      'src/app/pages/editor/probe.ts',
      "import { SuggestionPanel } from '../../features/feedback/SuggestionPanel.js';",
    ],
    [
      'product registry imported by its own feature',
      'src/app/features/whiteboard/probe.ts',
      "import { getProduct } from '../../products.js';",
    ],
    [
      'a transport adapter imported by a page',
      'src/app/pages/editor/probe.ts',
      "import { studioRequest } from '../../transport/client.js';",
    ],
    [
      'host transport internals imported by a feature',
      'src/app/features/feedback/probe.ts',
      "export { createRpcTransport } from '../../transport/rpc-transport.js';",
    ],
    [
      'a host bridge imported outside the application entry',
      'src/app/shell/probe.ts',
      "import { createStudioBridge } from '../transport/bridge.js';",
    ],
    [
      'a public feature imported by a transport adapter',
      'src/app/transport/probe.ts',
      "import { whiteboardProduct } from '../features/whiteboard/whiteboard.js';",
    ],
    [
      'a concrete export adapter imported by business logic',
      'src/core/probe.ts',
      "import { FileExportCopyStore } from '../infrastructure/export-copy-store.js';",
    ],
    [
      'a concrete export adapter imported outside the composition',
      'src/server/probe.ts',
      "import { FileExportCopyStore } from '../infrastructure/export-copy-store.js';",
    ],
    [
      'business internals imported by a protocol adapter',
      'src/server/probe.ts',
      "import { requireRole } from '../core/shared/common.js';",
    ],
    [
      'business implementation types imported by infrastructure',
      'src/infrastructure/probe.ts',
      "type Service = import('../core/service.js').StudioService;",
    ],
    [
      'dynamic import of the server from the app',
      'src/app/shared/probe.ts',
      "const load = () => import('../../server/http.js');",
    ],
    [
      'inline server type imported from the app',
      'src/app/shared/probe.ts',
      "type Host = import('../../server/http.js').StudioHost;",
    ],
    [
      'CommonJS server import from the app',
      'src/app/shared/probe.cjs',
      "const host = require('../../server/http.js');",
    ],
    [
      'core service re-exported by contracts',
      'src/contracts/probe.ts',
      "export { StudioService } from '../core/service.js';",
    ],
    [
      'app view imported by the core',
      'src/core/probe.ts',
      "import { StudioApp } from '../app/shell/StudioApp.js';",
    ],
    [
      'app view imported by the server',
      'src/server/probe.ts',
      "import { StudioApp } from '../app/shell/StudioApp.js';",
    ],
    [
      'test imported by production code',
      'src/core/probe.ts',
      "import '../../tests/unit/canvas-gesture-placement.test.js';",
    ],
    [
      'a suite imported by a fixture',
      'tests/fixtures/probe.ts',
      "import '../unit/canvas-gesture-placement.test.js';",
    ],
    [
      'a real server imported by a component suite',
      'tests/component/probe.ts',
      "import { startStudioHost } from '../../src/server/http.js';",
    ],
    [
      'an infrastructure adapter imported by a unit suite',
      'tests/unit/probe.ts',
      "import { ArtifactStore } from '../../src/infrastructure/artifact-store.js';",
    ],
    [
      'private feature logic imported by a different unit suite',
      'tests/unit/canvas-model.test.ts',
      "import { diffHistoryText } from '../../src/app/features/history/history-diff.js';",
    ],
    [
      'private feature logic imported by a contract suite',
      'tests/contracts/probe.ts',
      "import { diffHistoryText } from '../../src/app/features/history/history-diff.js';",
    ],
    [
      'prefixed Node builtin imported by the app',
      'src/app/shared/probe.ts',
      "import { createServer } from 'node:http';",
    ],
    [
      'bare Node builtin imported by the app',
      'src/app/shared/probe.ts',
      "import { readFile } from 'fs/promises';",
    ],
    [
      'service imported by a shared module',
      'src/shared/probe.ts',
      "import { StudioService } from '../core/service.js';",
    ],
    [
      'Node builtin imported by a shared module',
      'src/shared/probe.ts',
      "import { readFile } from 'node:fs/promises';",
    ],
    [
      'Node builtin imported by a contract',
      'src/contracts/probe.ts',
      "import { readFile } from 'node:fs/promises';",
    ],
    [
      'store implementation imported by the business service',
      'src/core/service.ts',
      "import { ArtifactStore } from '../infrastructure/artifact-store.js';",
    ],
    [
      'store implementation types imported by a port',
      'src/core/ports/probe.ts',
      "type Store = import('../../infrastructure/artifact-store.js').ArtifactStore;",
    ],
    [
      'generated runtime imported by the app',
      'src/app/shared/probe.ts',
      "const load = () => import('../../../runtime/server.mjs');",
    ],
    [
      'lint tooling re-exported by shared code',
      'src/shared/probe.ts',
      "export * from '../../lint/module-boundaries.mjs';",
    ],
  ];

  for (const [label, filePath, statement] of forbiddenImports) {
    it(`rejects ${label}`, async () => {
      const source = `const ready = true;\n${statement}`;
      const problems = await findModuleBoundaryProblems([{ filePath, source }], studioRoot);

      assert.equal(problems.length, 1);
      const [problem] = problems;
      assert.equal(problem.rule, 'studio/module-boundary');
      assert.equal(problem.filePath, filePath);
      assert.equal(problem.line, 2);
      assert.ok(Number.isInteger(problem.column) && problem.column > 0);
    });
  }

  it('accepts a contract import, a same-layer import, and a locally bound require', async () => {
    const filePath = 'src/app/main.tsx';
    const source = [
      "import type { Artifact } from '../contracts/studio.js';",
      "import { arrowGeometry } from '../shared/whiteboard-geometry.js';",
      "import { StudioApp } from './shell/StudioApp.js';",
      "const load = (require: (name: string) => unknown) => require('../server/http.js');",
    ].join('\n');

    assert.deepEqual(await findModuleBoundaryProblems([{ filePath, source }], studioRoot), []);
  });

  it('reports a nonliteral dynamic import in production code', async () => {
    const filePath = 'src/core/probe.ts';
    const source = 'const load = (specifier: string) => import(specifier);';
    const problems = await findModuleBoundaryProblems([{ filePath, source }], studioRoot);

    assert.deepEqual(
      problems.map(({ rule }) => rule),
      ['studio/unresolved-module'],
    );
  });

  it('allows shell composition of public pages and page-local dependencies', async () => {
    const sources = [
      {
        filePath: 'src/app/shell/probe.ts',
        source: "import { StudioLibraryView } from '../pages/library/index.js';",
      },
      {
        filePath: 'src/app/pages/library/probe.ts',
        source: "import { LibraryToolbar } from './LibraryToolbar.js';",
      },
    ];

    assert.deepEqual(await findModuleBoundaryProblems(sources, studioRoot), []);
  });

  it('allows public feature composition and direct product contract imports', async () => {
    const sources = [
      {
        filePath: 'src/app/products.tsx',
        source: "import { whiteboardProduct } from './features/whiteboard/whiteboard';",
      },
      {
        filePath: 'src/app/features/whiteboard/probe.ts',
        source: "import type { ProductDescriptor } from '../../product-contract';",
      },
      {
        filePath: 'src/app/pages/editor/probe.ts',
        source: "import * as feedback from '../../features/feedback/index.js';",
      },
    ];
    assert.deepEqual(await findModuleBoundaryProblems(sources, studioRoot), []);
  });

  it('allows the client entry, host assembly, and injected export adapter', async () => {
    const sources = [
      {
        filePath: 'src/app/main.tsx',
        source:
          "import { createStudioBridge } from './transport/bridge.js';\nimport { studioRequest } from './transport/client.js';",
      },
      {
        filePath: 'src/app/features/whiteboard/probe.ts',
        source: "import { studioRequest } from '../../transport/client.js';",
      },
      {
        filePath: 'src/app/features/collaboration/useCollaboration.ts',
        source: "import * as channel from '../../transport/collaboration-channel.js';",
      },
      {
        filePath: 'src/server/studio-composition.ts',
        source: "import { FileExportCopyStore } from '../infrastructure/export-copy-store.js';",
      },
      {
        filePath: 'src/infrastructure/export-copy-store.ts',
        source: "import type { ExportCopyStore } from '../core/ports/export-copy-store.js';",
      },
      {
        filePath: 'src/server/probe.ts',
        source: "import { boundedModelRequest } from '../core/model-read.js';",
      },
    ];
    assert.deepEqual(await findModuleBoundaryProblems(sources, studioRoot), []);
  });

  it('allows a component fixture and a suite using the real HTTP service', async () => {
    const sources = [
      {
        filePath: 'tests/component/probe.tsx',
        source: "import { createAppMock } from '../fixtures/app-mock.js';",
      },
      {
        filePath: 'tests/integration/probe.ts',
        source: "import { startStudioHost } from '../../src/server/http.js';",
      },
    ];
    assert.deepEqual(await findModuleBoundaryProblems(sources, studioRoot), []);
  });

  it('reports the runtime cycle across static, dynamic, and CommonJS references', async () => {
    const sources = [
      {
        filePath: 'src/shared/serialization.ts',
        source: "import './whiteboard-geometry.js';",
      },
      {
        filePath: 'src/shared/whiteboard-geometry.ts',
        source: "export const read = () => import('./document-serialization.js');",
      },
      {
        filePath: 'src/shared/document-serialization.ts',
        source: "const dependency = require('./serialization.js');",
      },
    ];
    const problems = await findModuleBoundaryProblems(sources, studioRoot);

    assert.equal(problems.length, 1);
    assert.equal(problems[0].rule, 'studio/module-cycle');
    assert.equal(problems[0].filePath, sources[2].filePath);
    assert.deepEqual(problems[0].relatedFiles, [
      ...sources.map(({ filePath }) => filePath),
      sources[0].filePath,
    ]);
  });

  it('accepts explicit type references without a runtime cycle', async () => {
    const sources = [
      {
        filePath: 'src/shared/serialization.ts',
        source: "import { type Rect } from './whiteboard-geometry.js';",
      },
      {
        filePath: 'src/shared/whiteboard-geometry.ts',
        source: "export type { HtmlBlock } from './serialization.js';",
      },
    ];

    assert.deepEqual(await findModuleBoundaryProblems(sources, studioRoot), []);
  });

  it('rejects the unresolved set of module imports in a frontend glob', async () => {
    const filePath = 'src/app/shared/probe.ts';
    const source = "const loaders = import.meta.glob('../../core/*.ts');";
    const problems = await findModuleBoundaryProblems([{ filePath, source }], studioRoot);

    assert.deepEqual(
      problems.map(({ rule }) => rule),
      ['studio/unresolved-module'],
    );
  });

  it('requires frontend files to belong to a declared module or directory', async () => {
    const files = [
      { filePath: 'src/app/probe.ts', source: 'export const work = true;' },
      { filePath: 'src/app/unowned/probe.ts', source: 'export const work = true;' },
    ];
    const problems = await findModuleBoundaryProblems(files, studioRoot);

    assert.deepEqual(
      problems.map(({ filePath, rule }) => [filePath, rule]),
      files.map(({ filePath }) => [filePath, 'studio/module-boundary']),
    );
  });

  it('rejects direct and global-object browser capabilities in pure shared code', async () => {
    const filePath = 'src/shared/probe.ts';
    const source = "const request = fetch;\nconst storage = globalThis['localStorage'];\n";
    const problems = await findModuleBoundaryProblems([{ filePath, source }], studioRoot);

    assert.deepEqual(
      problems.map(({ rule, target }) => ({ rule, target })),
      [
        { rule: 'studio/runtime-capability-boundary', target: 'fetch' },
        { rule: 'studio/runtime-capability-boundary', target: 'localStorage' },
      ],
    );
  });

  it('accepts locally supplied collaborators named like browser capabilities', async () => {
    const filePath = 'src/shared/probe.ts';
    const source = 'const read = (fetch, window) => fetch(window.localStorage);';

    assert.deepEqual(await findModuleBoundaryProblems([{ filePath, source }], studioRoot), []);
  });

  it('recognizes aliased browser capabilities in destructuring', async () => {
    const filePath = 'src/shared/probe.ts';
    const source = "const { fetch: request, ['localStorage']: storage } = globalThis;";
    const problems = await findModuleBoundaryProblems([{ filePath, source }], studioRoot);

    assert.deepEqual(
      problems.map(({ rule, target }) => ({ rule, target })),
      [
        { rule: 'studio/runtime-capability-boundary', target: 'fetch' },
        { rule: 'studio/runtime-capability-boundary', target: 'localStorage' },
      ],
    );
  });

  it('limits raw frontend requests to network adapters', async () => {
    const source = 'const load = () => window.fetch("/api/example");';
    const problems = await findModuleBoundaryProblems(
      [
        { filePath: 'src/app/transport/client.ts', source },
        { filePath: 'src/app/features/whiteboard/canvas/probe.ts', source },
      ],
      studioRoot,
    );

    assert.deepEqual(
      problems.map(({ filePath, rule, target }) => ({ filePath, rule, target })),
      [
        {
          filePath: 'src/app/features/whiteboard/canvas/probe.ts',
          rule: 'studio/runtime-capability-boundary',
          target: 'fetch',
        },
      ],
    );
  });

  it('limits browser storage to the declared adapters', async () => {
    const source = "const draft = window['localStorage'].getItem('draft');";
    const problems = await findModuleBoundaryProblems(
      [
        { filePath: 'src/app/transport/draft-storage.ts', source },
        { filePath: 'src/app/features/whiteboard/probe.ts', source },
      ],
      studioRoot,
    );

    assert.deepEqual(
      problems.map(({ filePath, rule, target }) => ({ filePath, rule, target })),
      [
        {
          filePath: 'src/app/features/whiteboard/probe.ts',
          rule: 'studio/runtime-capability-boundary',
          target: 'localStorage',
        },
      ],
    );
  });

  it('restricts raw filesystem, SQLite, and host SDK dependencies', async () => {
    const problems = await findModuleBoundaryProblems(
      [
        { filePath: 'src/core/probe.ts', source: "import { readFile } from 'node:fs/promises';" },
        {
          filePath: 'src/infrastructure/probe.ts',
          source: "import { DatabaseSync } from 'node:sqlite';",
        },
        {
          filePath: 'src/app/features/whiteboard/probe.ts',
          source: "import { OpenAIExtensions } from '@openai/mcp-extensions/app';",
        },
      ],
      studioRoot,
    );

    assert.deepEqual(
      problems.map(({ rule, target }) => [rule, target]),
      [
        ['studio/runtime-capability-boundary', 'node:fs/promises'],
        ['studio/runtime-capability-boundary', 'node:sqlite'],
        ['studio/runtime-capability-boundary', '@openai/mcp-extensions/app'],
      ],
    );
  });

  it('enforces the boundary at the target of a TypeScript path alias', async (context) => {
    const tempRoot = await realpath(tmpdir());
    const directory = await realpath(await mkdtemp(join(tempRoot, 'studio-module-boundaries-')));
    assert.equal(dirname(directory), tempRoot);
    context.after(() => rm(directory, { recursive: true, force: true }));

    const server = join(directory, 'src', 'server');
    await mkdir(server, { recursive: true });
    await mkdir(join(directory, 'src', 'app', 'shared'), { recursive: true });
    await writeFile(join(server, 'http.ts'), 'export const host = 1;');
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@host/*': ['./src/server/*'] },
        },
      }),
    );

    const filePath = 'src/app/shared/probe.ts';
    const source = "import { host } from '@host/http';";
    const problems = await findModuleBoundaryProblems([{ filePath, source }], directory);

    assert.deepEqual(
      problems.map(({ rule, target }) => ({ rule, target })),
      [{ rule: 'studio/module-boundary', target: 'src/server/http.ts' }],
    );
  });
});
