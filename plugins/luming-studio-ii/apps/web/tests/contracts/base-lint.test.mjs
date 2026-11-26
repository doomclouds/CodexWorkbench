import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
const boundary = 'base/contract-boundary';

const rejected = [
  [
    'consumer deep import',
    'src/pages/board.ts',
    "import { Button } from '../ui/base/Button/Button.js';",
    boundary,
  ],
  [
    'consumer deep type import',
    'src/pages/board.ts',
    "import type { ButtonProps } from '../ui/base/Button/Button.js';",
    boundary,
  ],
  [
    'type query',
    'src/pages/board.ts',
    "type Implementation = typeof import('../ui/base/Button/Button.js');",
    boundary,
  ],
  [
    'consumer re-export',
    'src/pages/board.ts',
    "export { Button } from '../ui/base/Button/Button.js';",
    boundary,
  ],
  [
    'deep import from a test',
    'tests/component/board.test.ts',
    "import { Button } from '../../src/ui/base/Button/Button.js';",
    boundary,
  ],
  [
    'base contract suite imports application state',
    'tests/component/Button.test.tsx',
    "import { save } from '../../src/data/save.js';",
    boundary,
  ],
  [
    'base contract suite imports server infrastructure',
    'tests/component/Button.test.tsx',
    "import { store } from '../../../server/src/infrastructure/adapters/sqlite.js';",
    boundary,
  ],
  [
    'base fixture re-exports a Surface',
    'tests/support/render-control.ts',
    "export { save } from '../../src/surfaces/board/index.js';",
    boundary,
  ],
  [
    'base suite uses an unrelated fixture to load a Surface',
    'tests/component/Button.test.tsx',
    "import { save } from '../support/board.js';",
    boundary,
  ],
  [
    'replacement of the tested controls',
    'tests/component/board.test.tsx',
    "vi.mock('../../src/ui/base/index.js', createMock);",
    'base/test-contract',
  ],
  [
    'mock called through an alias',
    'tests/component/Button.test.tsx',
    "import { vi as mocker } from 'vitest';\n\nmocker.mock('../../src/ui/base/index.js', makeMock);",
    'base/test-contract',
  ],
  [
    'spy replacing a control export',
    'tests/component/Button.test.tsx',
    "import * as controls from '../../src/ui/base/index.js';\n\nvi.spyOn(controls, 'Button');",
    'base/test-contract',
  ],
  [
    'skipped contract test',
    'tests/component/board.test.tsx',
    "it.skip('uses the control', check);",
    'base/test-contract',
  ],
  [
    'skip called through an alias',
    'tests/component/Button.test.tsx',
    "import { it as scenario } from 'vitest';\n\nscenario.skip('checks behavior', check);",
    'base/test-contract',
  ],
  [
    'conditionally skipped control test',
    'tests/component/Button.test.tsx',
    "import { it } from 'vitest';\n\nit.skipIf(true)('checks behavior', check);",
    'base/test-contract',
  ],
  [
    'conditionally excluded control test',
    'tests/component/Button.test.tsx',
    "import { it } from 'vitest';\n\nit.runIf(false)('checks behavior', check);",
    'base/test-contract',
  ],
  [
    'lazy deep import',
    'src/pages/board.ts',
    "const screen = import('../ui/base/Button/Button.js');",
    boundary,
  ],
  [
    'Vite absolute path',
    'src/pages/board.ts',
    "import { Button } from '/src/ui/base/Button/Button.tsx';",
    boundary,
  ],
  [
    'sibling private import',
    'src/ui/base/Dialog/Dialog.tsx',
    "import { pressed } from '../Button/internal.js';",
    boundary,
  ],
  [
    'application imports a base internal utility',
    'src/pages/board.ts',
    "import { useAnchoredLayer } from '../ui/base/internal/anchored-layer.js';",
    boundary,
  ],
  [
    'base internal utility imports a public control',
    'src/ui/base/internal/anchored-layer.ts',
    "import { Button } from '../Button/Button.js';",
    boundary,
  ],
  [
    'dependency on a Surface',
    'src/ui/base/Button/Button.tsx',
    "import { save } from '../../../surfaces/board/index.js';",
    boundary,
  ],
  [
    'direct network',
    'src/ui/base/Button/Button.tsx',
    "window.fetch('/save');",
    'base/no-browser-io',
  ],
  [
    'destructured network capability',
    'src/ui/base/Button/Button.tsx',
    "const { fetch: readResource } = window; readResource('/save');",
    'base/no-browser-io',
  ],
  [
    'aliased browser global',
    'src/ui/base/Button/Button.tsx',
    "const browser = globalThis; browser.fetch('/save');",
    'base/no-browser-io',
  ],
  [
    'nested clipboard capability',
    'src/ui/base/Button/Button.tsx',
    "globalThis.navigator.clipboard.writeText('example');",
    'base/no-browser-io',
  ],
  [
    'nested host capability',
    'src/ui/base/Button/Button.tsx',
    'globalThis.window.parent.postMessage(message);',
    'base/no-browser-io',
  ],
  [
    'network through an element realm',
    'src/ui/base/Button/Button.tsx',
    "function load(element) { element.ownerDocument.defaultView?.fetch('/save'); }",
    'base/no-browser-io',
  ],
  [
    'direct host bridge',
    'src/ui/base/Dialog/Dialog.tsx',
    'window.parent.postMessage(message);',
    'base/no-browser-io',
  ],
  [
    'private barrel export',
    'src/ui/base/index.ts',
    "export { activatePrivate } from './Button/Button.js';",
    boundary,
  ],
  [
    'wildcard barrel export',
    'src/ui/base/index.ts',
    "export * from './Button/Button.js';",
    boundary,
  ],
  [
    'missing public props',
    'src/ui/base/index.ts',
    "export { Button } from './Button/Button.js';",
    boundary,
  ],
  [
    'component without a public contract test',
    'src/ui/base/index.ts',
    [
      "export { Unverified } from './Unverified/Unverified.js';",
      "export type { UnverifiedProps } from './Unverified/Unverified.js';",
    ].join('\n'),
    boundary,
  ],
  [
    'raw DOM ref',
    'src/ui/base/Button/Button.tsx',
    'export interface ButtonProps { ref: Ref<HTMLButtonElement> }',
    boundary,
  ],
  [
    'control signature bypasses its declared Props',
    'src/ui/base/Button/Button.tsx',
    [
      "import type { ComponentPropsWithRef } from 'react';",
      '',
      'export interface ButtonProps { label: string }',
      '',
      "export function Button(props: ComponentPropsWithRef<'button'>) { return <button>{props.children}</button>; }",
    ].join('\n'),
    boundary,
  ],
  [
    'prop spreading onto a native element',
    'src/ui/base/Button/Button.tsx',
    'export function Button(props: ButtonProps) { return <button {...props} />; }',
    'no-restricted-syntax',
  ],
  [
    'extra runtime handle',
    'src/ui/base/Button/Button.tsx',
    [
      "import { useImperativeHandle } from 'react';",
      'export interface ButtonHandle { focus(): void }',
      'useImperativeHandle(ref, () => ({ focus, activatePrivate }));',
    ].join('\n'),
    boundary,
  ],
  [
    'lint suppression',
    'src/ui/base/Button/Button.tsx',
    '/* eslint-disable */',
    'studio/no-source-comments',
  ],
];

for (const [name, filePath, source, rule] of rejected) {
  test(name, async () => {
    const [result] = await eslint.lintText(source, { filePath });
    const errors = result.messages.map((message) => message.ruleId);

    assert.ok(errors.includes(rule), JSON.stringify(result.messages));
  });
}

test('accepts explicit public exports and a consumer using the entry', async () => {
  const entry = [
    "export { Button } from './Button/Button.js';",
    "export type { ButtonProps, ButtonHandle } from './Button/Button.js';",
  ].join('\n');
  const consumer = "import { Button } from '../../ui/base/index.js';";
  const results = await Promise.all([
    eslint.lintText(entry, { filePath: 'src/ui/base/index.ts' }),
    eslint.lintText(consumer, { filePath: 'src/pages/whiteboard/screen.ts' }),
  ]);

  assert.deepEqual(
    results.flat().flatMap((result) => result.messages),
    [],
  );
});

test('accepts a local collaborator with a browser-like name', async () => {
  const source = "function notify(window) { window.postMessage('notice'); }";
  const [result] = await eslint.lintText(source, {
    filePath: 'src/ui/base/Button/Button.tsx',
  });

  assert.deepEqual(result.messages, []);
});

test('allows a control to use base internal utilities', async () => {
  const [result] = await eslint.lintText(
    "import { useAnchoredLayer } from '../internal/anchored-layer.js';",
    { filePath: 'src/ui/base/AnchoredPopover/AnchoredPopover.tsx' },
  );

  assert.deepEqual(result.messages, []);
});

test('accepts the package public entry and unrelated local metadata', async () => {
  const source = [
    "import { Button } from '@codexworkbench/luming-studio-ii-web/ui/base';",
    '',
    "const test = { todo: 'local metadata' };",
    'Object.keys(test.todo);',
    'Object.keys(Button);',
  ].join('\n');
  const [result] = await eslint.lintText(source, { filePath: 'tests/component/Button.test.tsx' });

  assert.deepEqual(result.messages, []);
});
