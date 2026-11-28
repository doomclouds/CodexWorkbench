import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dependencyCycles,
  moduleReferences,
  readDependencyGraph,
} from './check-luming-studio-ii-dependencies.mjs';

test('recognizes imports, re-exports, and literal dynamic imports', () => {
  const references = moduleReferences(
    [
      "import type { A } from './a.js';",
      "import { type B } from './b.js';",
      "export type { C } from './c.js';",
      "export { d } from './d.js';",
      "export * from './e.js';",
      "type F = import('./f.js').F;",
      "const load = () => import('./g.js');",
      'const loadTemplate = () => import(`./h.js`);',
      'const unresolvable = (path: string) => import(path);',
    ].join('\n'),
    'references.ts',
  );

  assert.deepEqual(
    references.map(({ specifier, typeOnly, line }) => [specifier, typeOnly, line]),
    [
      ['./a.js', true, 1],
      ['./b.js', false, 2],
      ['./c.js', true, 3],
      ['./d.js', false, 4],
      ['./e.js', false, 5],
      ['./f.js', true, 6],
      ['./g.js', false, 7],
      ['./h.js', false, 8],
    ],
  );
});

function reference(from, to, line, typeOnly = false) {
  return { from, to, line, typeOnly };
}

test('reports runtime and type cycles separately with their actual edges', () => {
  const fromA = reference('a.ts', 'b.ts', 2);
  const fromB = reference('b.ts', 'a.ts', 3);
  const fromC = reference('c.ts', 'd.ts', 1);
  const fromD = reference('d.ts', 'c.ts', 4, true);
  const fromE = reference('e.ts', 'e.ts', 1, true);
  const graph = new Map([
    ['a.ts', [fromA]],
    ['b.ts', [fromB]],
    ['c.ts', [fromC]],
    ['d.ts', [fromD]],
    ['e.ts', [fromE]],
    ['f.ts', [reference('f.ts', 'd.ts', 1)]],
  ]);

  assert.deepEqual(dependencyCycles(graph), {
    runtime: [[fromA, fromB]],
    types: [[fromC, fromD], [fromE]],
  });
});

test('scans app and shared source and resolves exported workspace modules', () => {
  const graph = readDependencyGraph();
  const edges = [...graph.values()].flat();
  const hasEdge = (from, to) =>
    edges.some(
      (edge) =>
        edge.from.replaceAll('\\', '/').endsWith(from) &&
        edge.to.replaceAll('\\', '/').endsWith(to),
    );

  assert.ok(hasEdge('/platform/browser/index.ts', '/platform/navigation/index.ts'));
  assert.ok(
    hasEdge(
      '/apps/web/src/ui/domain/canvas/connectors/geometry.ts',
      '/whiteboard-shared/src/connector-route.ts',
    ),
  );
  assert.ok(
    hasEdge(
      '/apps/server/src/modules/whiteboard/domain/export-geometry.ts',
      '/whiteboard-shared/src/connector-route.ts',
    ),
  );
});
