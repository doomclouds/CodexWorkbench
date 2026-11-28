import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd });
const filePath = 'src/fixture.ts';

const moduleReferences = [
  "import { connect } from '../../apps/server/src/infrastructure/index.js';",
  "import { test } from '../tests/behavior.test.mjs';",
  "import config from '../eslint.config.mjs';",
  "import { missing } from './missing.ts';",
  "import type { Board } from '@web/data/whiteboard';",
  "import { PointSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';",
  "import runtime = require('node:fs');",
  "export type Source = import('#studio-platform').Host;",
  "export { createTransport } from '@web/platform/browser';",
  "export * from '../tests/architecture.test.mjs';",
  "export const load = () => import('./stickers.ts');",
  "export const load = () => import('node:fs');",
  'export const load = (name: string) => import(name);',
  'export const mode = import.meta.env.MODE;',
  '/// <reference types="node" />\nexport const example = 1;',
  'declare const window: { readonly name: string };\nexport const name = window.name;',
];

const hostReferences = [
  'export const example = () => localStorage.getItem("a");',
  'export const example = () => fetch("https://example.test");',
  'export const example = () => window.location.href;',
  'export const example = () => document.title;',
  'export const example = () => globalThis["fetch"]("https://example.test");',
  'export const example = () => require("node:fs");',
  'export const example = () => process.env;',
  'export const example = () => Deno.readTextFile("data");',
  'export const example = () => Date.now();',
  'export const example = () => Math.random();',
  'export const example = () => new Function("return 1")();',
];

async function ruleIds(source) {
  const [result] = await eslint.lintText(source, { filePath });
  assert.equal(result.fatalErrorCount, 0, source);
  return result.messages.map(({ ruleId }) => ruleId);
}

test('accepts local types and deterministic URL and JavaScript operations', async () => {
  assert.deepEqual(
    await ruleIds(`
      interface Address { href: string }
      export function normalized({ href }: Address): string {
        return new URL(href).href.padEnd(Math.max(4, 8), '-');
      }
    `),
    [],
  );
});

test('accepts static imports and re-exports of real shared source files', async () => {
  assert.deepEqual(
    await ruleIds(`
      import { connectionPathData } from './connector-route.ts';
      import type { ConnectorTarget } from './connector-route.ts';
      export type Segment = import('./connector-route.ts').ConnectorSegment;
      export { stickerDefinition } from './stickers.ts';
      export const path = (port: ConnectorTarget) => connectionPathData([port.fallback]);
    `),
    [],
  );
});

test('rejects module references and ambient host declarations in shared sources', async () => {
  for (const source of moduleReferences) {
    const ids = await ruleIds(source);
    assert.ok(
      ids.includes('shared/local-reference') ||
        ids.includes('no-restricted-syntax') ||
        ids.includes('no-warning-comments'),
      source,
    );
  }
});

test('rejects I/O, host globals, clocks, injected code and implicit entropy', async () => {
  for (const source of hostReferences) {
    assert.notDeepEqual(await ruleIds(source), [], source);
  }
});
