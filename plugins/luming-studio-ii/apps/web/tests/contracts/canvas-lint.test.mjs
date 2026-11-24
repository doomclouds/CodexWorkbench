import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
const boundary = 'canvas/contract-boundary';
const canvas = 'src/ui/domain/canvas/';
const surface = 'src/surfaces/board.ts';
const component = 'tests/component/Canvas.test.tsx';
const parity = 'tests/component/CanvasParity.test.tsx';
const fixture = 'tests/fixtures/canvas/fixture.tsx';
const publicPackage = '@codexworkbench/luming-studio-ii-web/ui/domain/canvas';

const rejected = [
  [
    'private value',
    surface,
    "import { projectPoint } from '../ui/domain/canvas/viewport/math.js';",
  ],
  ['private type', surface, "import type { CanvasProps } from '../ui/domain/canvas/contracts.js';"],
  [
    'private type query',
    surface,
    "type Result = import('../ui/domain/canvas/contracts.js').CanvasProps;",
  ],
  ['private re-export', surface, "export * from '../ui/domain/canvas/scene/scene.js';"],
  ['private dynamic import', surface, "void import('../ui/domain/canvas/scene/scene.js');"],
  ['unresolvable dynamic import', surface, 'void import(moduleName);'],
  ['private package subpath', surface, `import { Canvas } from '${publicPackage}/Canvas.js';`],
  [
    'undocumented package path for the public entry',
    surface,
    `import { Canvas } from '${publicPackage}/index.js';`,
  ],
  ['raw public entry', surface, "import template from '../ui/domain/canvas/index.ts?raw';"],
  ['Vite absolute path', surface, "import Canvas from '/src/ui/domain/canvas/Canvas.tsx';"],
  [
    'unapproved dependency',
    canvas + 'viewport/math.ts',
    "import { read } from '../scene/scene.js';",
  ],
  [
    'reverse dependency',
    canvas + 'scene/scene.ts',
    "import { active } from '../selection/select.js';",
  ],
  [
    'rendering dependency inside scene geometry',
    canvas + 'scene/index.ts',
    "import { CanvasConnectorPath } from '../connectors/CanvasConnectorPath.js';",
  ],
  [
    'ink JSX imported from its own geometry',
    canvas + 'ink/geometry.ts',
    "import { CanvasInkPath } from './CanvasInkPath.js';",
  ],
  [
    'React inside connector geometry',
    canvas + 'connectors/geometry.ts',
    "import { useState } from 'react';",
  ],
  [
    'root through an inner module',
    canvas + 'scene/scene.ts',
    "import { Canvas } from '../Canvas.js';",
  ],
  [
    'private Base module',
    canvas + 'Canvas.tsx',
    "import { Button } from '../../base/Button/Button.js';",
  ],
  [
    'Surface dependency',
    canvas + 'Canvas.tsx',
    "import { save } from '../../../surfaces/board.js';",
  ],
  [
    'host dependency',
    canvas + 'adapters/host.ts',
    "import { connect } from '@modelcontextprotocol/sdk';",
  ],
  [
    'test depending on internal implementation',
    component,
    "import { Canvas } from '../../src/ui/domain/canvas/Canvas.js';",
  ],
  [
    'parity test reaching connector internals',
    parity,
    "import { resolveConnection } from '../../src/ui/domain/canvas/connectors/geometry.js';",
  ],
  [
    'fixture depending on Surface',
    fixture,
    "export { save } from '../../../src/surfaces/board.js';",
  ],
  [
    'test importing a business fixture',
    component,
    "import { board } from '../fixtures/boards.js';",
  ],
  [
    'math test importing another part',
    'tests/unit/canvas/viewport.test.ts',
    "import { all } from '../../../src/ui/domain/canvas/scene/scene.js';",
  ],
  [
    'math test importing the UI',
    'tests/unit/canvas/viewport.test.ts',
    `import { Canvas } from '${publicPackage}';`,
  ],
  [
    'ink unit test importing its JSX renderer',
    'tests/unit/canvas/ink.test.ts',
    "import { CanvasInkPath } from '../../../src/ui/domain/canvas/ink/CanvasInkPath.js';",
  ],
  [
    'parity test mocking the public Canvas',
    parity,
    `import { vi } from 'vitest';\nvi.mock('${publicPackage}', factory);`,
    'canvas/no-test-replacement',
  ],
  [
    'module mock through runner alias',
    component,
    `import { vi as runner } from 'vitest';\nrunner.mock('${publicPackage}', factory);`,
    'canvas/no-test-replacement',
  ],
  [
    'module mock with the module-promise form',
    fixture,
    `import * as runner from 'vitest';\nrunner.vi.doMock(import('${publicPackage}'), factory);`,
    'canvas/no-test-replacement',
  ],
  [
    'module namespace spy',
    component,
    `import * as surface from '${publicPackage}';\nvi.spyOn(surface, 'Canvas');`,
    'canvas/no-test-replacement',
  ],
  ['direct network', canvas + 'adapters/host.ts', 'window.fetch(path);', 'base/no-browser-io'],
  [
    'direct storage',
    canvas + 'Canvas.tsx',
    'localStorage.setItem(key, value);',
    'no-restricted-globals',
  ],
  ['wildcard exports', canvas + 'index.ts', "export * from './contracts.js';"],
  ['missing public contracts', canvas + 'index.ts', "export { Canvas } from './Canvas.js';"],
  [
    'arbitrary barrel exports',
    canvas + 'index.ts',
    "export type { CanvasInternal } from './viewport/math.js';",
  ],
  [
    'unprefixed public contract',
    canvas + 'index.ts',
    "export type { Rectangle } from './contracts.js';",
  ],
  [
    'renamed public contract',
    canvas + 'index.ts',
    "export type { CanvasProps as CanvasOptions } from './contracts.js';",
  ],
  [
    'raw DOM ref',
    canvas + 'contracts.ts',
    'export interface CanvasProps { ref: Ref<HTMLDivElement> }',
  ],
  [
    'raw native event',
    canvas + 'contracts.ts',
    'export interface CanvasProps { onClick: (event: React.PointerEvent) => void }',
  ],
  [
    'raw DOM imported under an alias',
    canvas + 'contracts.ts',
    "import type { PointerEvent as Click } from 'react';\nexport type CanvasEvent = Click;",
  ],
  [
    'raw DOM inferred from the browser',
    canvas + 'contracts.ts',
    'export type CanvasOptions = ReturnType<typeof document.createElement>;',
  ],
  [
    'extra handle method',
    canvas + 'contracts.ts',
    'export interface CanvasHandle { focus(): void; fitToObjects(ids: readonly string[]): void; save(): void }',
  ],
  [
    'extra runtime handle member',
    canvas + 'Canvas.tsx',
    "import { useImperativeHandle as expose } from 'react';\nexpose(ref, () => ({ focus, fitToObjects, save }));",
  ],
];

for (const [name, filePath, source, rule = boundary] of rejected) {
  test('rejects ' + name, async () => {
    const [result] = await eslint.lintText(source, { filePath });

    assert.ok(
      result.messages.some((message) => message.ruleId === rule),
      JSON.stringify(result.messages),
    );
  });
}

const accepted = [
  [surface, `export { Canvas } from '${publicPackage}';`],
  [surface, "void import('../ui/domain/canvas/index.js');"],
  [
    canvas + 'index.ts',
    "export { Canvas } from './Canvas.js';\nexport type { CanvasProps, CanvasHandle } from './contracts.js';",
  ],
  [
    canvas + 'Canvas.tsx',
    [
      "import { useImperativeHandle } from 'react';",
      '',
      'export function Canvas({ ref }: CanvasProps) {',
      '  useImperativeHandle(ref, () => ({ focus, fitToObjects }));',
      '',
      '  return null;',
      '}',
    ].join('\n'),
  ],
  [
    canvas + 'contracts.ts',
    [
      "import type { ReactNode, Ref } from 'react';",
      '',
      'export interface CanvasHandle { focus(): void; fitToObjects(ids: readonly string[]): void }',
      '',
      'export interface CanvasProps { content?: ReactNode; ref?: Ref<CanvasHandle> }',
    ].join('\n'),
  ],
  [canvas + 'viewport/math.ts', "import type { CanvasPoint } from '../contracts.js';"],
  [canvas + 'scene/scene.ts', "import { bounds } from '../viewport/math.js';"],
  [
    canvas + 'scene/index.ts',
    "import { resolveConnection } from '../connectors/geometry.js';\nimport { inkBounds } from '../ink/geometry.js';",
  ],
  [
    canvas + 'selection/select.ts',
    "import { bounds } from '../viewport/math.js';\nimport { query } from '../scene/scene.js';",
  ],
  [canvas + 'rendering/render.ts', "import { draw } from '../adapters/draw.js';"],
  [
    component,
    "import { setup } from '../fixtures/canvas/fixture.js';\nimport { Canvas } from '../../src/ui/domain/canvas/index.js';",
  ],
  [
    parity,
    "import { Canvas } from '../../src/ui/domain/canvas/index.js';\nimport { createControlFixture } from '../support/render-control.js';",
  ],
  [
    fixture,
    `import { Canvas } from '${publicPackage}';\nimport { Button } from '../../../src/ui/base/index.js';`,
  ],
  [
    'tests/unit/canvas/viewport.test.ts',
    "import { bounds } from '../../../src/ui/domain/canvas/viewport/math.js';\nimport type { CanvasPoint } from '../../../src/ui/domain/canvas/contracts.js';",
  ],
  [
    'tests/unit/canvas/connectors.test.ts',
    "import { findPort } from '../../../src/ui/domain/canvas/connectors/geometry.js';",
  ],
];

for (const [filePath, source] of accepted) {
  test('accepts approved dependencies in ' + filePath, async () => {
    const [result] = await eslint.lintText(source, { filePath });

    assert.deepEqual(result.messages, []);
  });
}
