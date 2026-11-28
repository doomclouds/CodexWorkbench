import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import babelParser from '@babel/eslint-parser';
import {
  localResolver,
  resolveFile,
} from '../plugins/luming-studio-ii/apps/server/lint/project-paths.mjs';
import { referenceTargets } from '../plugins/luming-studio-ii/apps/web/lint/frontend-boundaries.mjs';
import { isErasedModuleReference } from './studio-lint/module-reference.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const plugin = join(repository, 'plugins', 'luming-studio-ii');
const projects = ['apps/web', 'apps/server', 'packages/whiteboard-shared'].map((directory) =>
  join(plugin, directory),
);
const script = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const references = new Set([
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ImportExpression',
  'TSImportType',
]);

function writtenSpecifier(source) {
  if (source?.type === 'Literal' && typeof source.value === 'string') {
    return source.value;
  }
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0) {
    return source.quasis[0]?.value.cooked;
  }
}

export function moduleReferences(source, file) {
  const { ast, visitorKeys } = babelParser.parseForESLint(source, {
    filePath: file,
    requireConfigFile: false,
    babelOptions: {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: file.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'] },
    },
  });
  const imports = [];

  function visit(node) {
    if (!node) {
      return;
    }

    const specifier = references.has(node.type) && writtenSpecifier(node.source);
    if (specifier) {
      imports.push({
        specifier,
        typeOnly: isErasedModuleReference(node),
        line: node.loc.start.line,
      });
    }

    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  }

  visit(ast);
  return imports;
}

function workspaceExports() {
  const exported = new Map();
  for (const root of projects) {
    const { name, exports } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const [key, path] of Object.entries(exports ?? {})) {
      if (typeof path === 'string') {
        exported.set(name + key.slice(1), resolveFile(resolve(root, path)));
      }
    }
  }

  return exported;
}

function sources() {
  const files = new Map();
  for (const root of projects) {
    for (const entry of readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && script.test(entry.name)) {
        files.set(realpathSync(join(entry.parentPath, entry.name)), root);
      }
    }
  }

  return files;
}

export function readDependencyGraph() {
  const files = sources();
  const exported = workspaceExports();
  const graph = new Map();
  for (const from of [...files.keys()].sort()) {
    const root = files.get(from);
    const resolveLocal = localResolver(root, from);
    const imports = moduleReferences(readFileSync(from, 'utf8'), from);
    const edges = [];
    for (const { specifier, typeOnly, line } of imports) {
      const webTargets = root === projects[0] ? referenceTargets(from, specifier) : [];
      const to =
        webTargets.map(resolveFile).find(Boolean) ??
        resolveLocal(specifier)?.file ??
        exported.get(specifier);

      if (files.has(to)) {
        edges.push({ from, to, typeOnly, line });
      }
    }
    graph.set(from, edges);
  }

  return graph;
}

function findCycles(graph, includeTypes) {
  const active = new Map();
  const visited = new Set();
  const path = [];
  const cycles = [];

  function visit(file) {
    if (visited.has(file)) {
      return;
    }

    visited.add(file);
    active.set(file, path.length);
    for (const edge of graph.get(file) ?? []) {
      if (edge.typeOnly && !includeTypes) {
        continue;
      }

      const targetIndex = active.get(edge.to);
      if (targetIndex !== undefined) {
        cycles.push([...path.slice(targetIndex), edge]);
      } else {
        path.push(edge);
        visit(edge.to);
        path.pop();
      }
    }
    active.delete(file);
  }

  for (const file of graph.keys()) {
    visit(file);
  }

  return cycles;
}

export function dependencyCycles(graph) {
  return {
    runtime: findCycles(graph, false),
    types: findCycles(graph, true).filter((cycle) => cycle.some(({ typeOnly }) => typeOnly)),
  };
}

function display(file) {
  return relative(repository, file).split(sep).join('/');
}

function main() {
  const graph = readDependencyGraph();
  const { runtime, types } = dependencyCycles(graph);
  for (const [kind, cycles] of [
    ['Runtime dependency cycle', runtime],
    ['Type dependency cycle', types],
  ]) {
    for (const cycle of cycles) {
      console.error(kind);
      for (const { from, to, typeOnly, line } of cycle) {
        console.error(
          '  ' + display(from) + ':' + line + (typeOnly ? ' -type-> ' : ' -> ') + display(to),
        );
      }
    }
  }

  if (runtime.length || types.length) {
    process.exitCode = 1;
  } else {
    console.log('Studio II source dependency graph is acyclic (' + graph.size + ' files).');
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
