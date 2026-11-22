import babelParser from '@babel/eslint-parser';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const nodeModules = new Set(builtinModules);
const forbiddenGroups = {
  app: new Set(['core', 'server']),
  contracts: new Set(['app', 'core', 'server']),
  core: new Set(['app', 'server']),
  infrastructure: new Set(['app', 'server']),
  server: new Set(['app']),
  shared: new Set(['app', 'core', 'server']),
};
const declarations = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'TSImportType',
]);
const networkCapabilities = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const browserCapabilities = new Set([
  ...networkCapabilities,
  'localStorage',
  'sessionStorage',
  'indexedDB',
]);
const browserGlobals = new Set(['globalThis', 'window', 'self']);
const shellDirectory = 'src/app/shell/';
const shellEntry = 'src/app/main.tsx';
const pageDirectory = 'src/app/pages/';
const pageEntries = new Map([
  ['editor', 'src/app/pages/editor/index.ts'],
  ['library', 'src/app/pages/library/index.ts'],
]);
const featureDirectory = 'src/app/features/';
const featureEntries = new Map([
  ['collaboration', 'src/app/features/collaboration/index.ts'],
  ['feedback', 'src/app/features/feedback/index.ts'],
  ['history', 'src/app/features/history/index.ts'],
  ['library', 'src/app/features/library/index.ts'],
  ['transfer', 'src/app/features/transfer/index.ts'],
  ['whiteboard', 'src/app/features/whiteboard/whiteboard.tsx'],
]);
const productRegistry = 'src/app/products.tsx';
const transportDirectory = 'src/app/transport/';
const applicationDirectories = new Set(['shell', 'pages', 'features', 'shared', 'transport']);
const applicationEntries = new Set([
  shellEntry,
  productRegistry,
  'src/app/product-contract.ts',
  'src/app/panel-view-state.ts',
  'src/app/library-preview.ts',
  'src/app/clipboard.ts',
]);
const transportBridge = transportDirectory + 'bridge.ts';
const transportClient = transportDirectory + 'client.ts';
const draftStorage = transportDirectory + 'draft-storage.ts';
const collaborationChannel = transportDirectory + 'collaboration-channel.ts';
const collaborationController = 'src/app/features/collaboration/useCollaboration.ts';
const networkAdapters = new Set([transportClient, collaborationChannel]);
const browserStorageAdapters = new Set([
  draftStorage,
  'src/app/panel-view-state.ts',
  'src/app/shell/preferences.ts',
]);
const infrastructureDirectory = 'src/infrastructure/';
const serverDirectory = 'src/server/';
const serverComposition = 'src/server/studio-composition.ts';
const coreDirectory = 'src/core/';
const businessEntries = new Set(['src/core/service.ts', 'src/core/model-read.ts']);
const backendFileAdapters = new Set(['src/server/client.ts', 'src/server/index.ts']);
const protocolSdkAdapters = new Set([
  transportBridge,
  'src/server/index.ts',
  'src/server/protocol.ts',
]);
const testDirectory = 'tests/';
const testGroups = new Set([
  'unit',
  'component',
  'contracts',
  'integration',
  'fixtures',
  'support',
]);
const testSuite = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const unitFeatureOwners = new Map([
  ['tests/unit/canvas-drafts.test.ts', 'whiteboard'],
  ['tests/unit/canvas-gesture-placement.test.ts', 'whiteboard'],
  ['tests/unit/canvas-model.test.ts', 'whiteboard'],
  ['tests/unit/canvas-presentation.test.ts', 'whiteboard'],
  ['tests/unit/native-geometry.test.ts', 'whiteboard'],
  ['tests/unit/history-diff.test.ts', 'history'],
]);

function specifierOf(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
}

function propertyName(node, computed) {
  return computed || node.type === 'Literal' ? specifierOf(node) : node.name;
}

function isImportGlob(callee) {
  if (callee.type !== 'MemberExpression' || callee.object.type !== 'MetaProperty') return false;

  const name = propertyName(callee.property, callee.computed);
  return callee.object.meta.name === 'import' && (name === 'glob' || name === 'globEager');
}

function runtimeDeclaration(node) {
  if (node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type') {
    return false;
  }

  return (
    !node.specifiers?.length ||
    node.specifiers.some(
      ({ importKind, exportKind }) => importKind !== 'type' && exportKind !== 'type',
    )
  );
}

function moduleReference(node, requires) {
  if (declarations.has(node.type) && node.source) {
    return {
      specifier: specifierOf(node.source),
      kind: 'import-statement',
      runtime: runtimeDeclaration(node),
    };
  }
  if (node.type === 'ImportExpression') {
    return { specifier: specifierOf(node.source), kind: 'dynamic-import' };
  }
  if (
    node.type === 'TSImportEqualsDeclaration' &&
    node.moduleReference.type === 'TSExternalModuleReference'
  ) {
    return {
      specifier: specifierOf(node.moduleReference.expression),
      kind: 'require-call',
      runtime: node.importKind !== 'type',
    };
  }
  if (node.type === 'CallExpression' && requires.has(node.callee)) {
    return { specifier: specifierOf(node.arguments[0]), kind: 'require-call' };
  }
  if (node.type === 'CallExpression' && isImportGlob(node.callee)) {
    return { kind: 'dynamic-import' };
  }
}

function onBrowserGlobal(node, globals) {
  return globals.has(node) && browserGlobals.has(node.name);
}

function destructuredCapabilities(pattern, source, globals) {
  if (pattern.type !== 'ObjectPattern' || !onBrowserGlobal(source, globals)) return;

  return pattern.properties
    .filter((property) => property.type === 'Property')
    .map(({ key, computed }) => propertyName(key, computed))
    .filter((name) => browserCapabilities.has(name));
}

function browserCapabilityUses(node, globals) {
  if (globals.has(node) && browserCapabilities.has(node.name)) return [node.name];
  if (node.type === 'MemberExpression' && onBrowserGlobal(node.object, globals)) {
    const name = propertyName(node.property, node.computed);
    if (browserCapabilities.has(name)) return [name];
  }
  if (node.type === 'VariableDeclarator') {
    return destructuredCapabilities(node.id, node.init, globals);
  }
  if (node.type === 'AssignmentExpression') {
    return destructuredCapabilities(node.left, node.right, globals);
  }
}

function inspectSource(filePath, source) {
  const plugins = /\.[jt]sx$/u.test(filePath) ? ['typescript', 'jsx'] : ['typescript'];
  const { ast, scopeManager, visitorKeys } = babelParser.parseForESLint(source, {
    requireConfigFile: false,
    babelOptions: {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins, createImportExpressions: true },
    },
  });
  const globals = new Set(scopeManager.globalScope.through.map(({ identifier }) => identifier));
  const requires = new Set([...globals].filter((identifier) => identifier.name === 'require'));
  const references = [];
  const problems = [];
  const shared = filePath.startsWith('src/shared/');
  const frontend = filePath.startsWith('src/app/');
  function visit(node) {
    if (!node) return;

    const dependency = moduleReference(node, requires);
    const capabilities = shared || frontend ? browserCapabilityUses(node, globals) : undefined;
    if (dependency || capabilities?.length) {
      const position = { filePath, line: node.loc.start.line, column: node.loc.start.column + 1 };
      if (dependency) references.push({ ...dependency, ...position });
      for (const capability of capabilities ?? []) {
        const network = networkCapabilities.has(capability);
        const adapters = network ? networkAdapters : browserStorageAdapters;
        if (!shared && adapters.has(filePath)) continue;

        problems.push(
          problem(
            position,
            'studio/runtime-capability-boundary',
            capability,
            shared
              ? 'Keep shared code independent of network and storage capabilities.'
              : 'Use a declared Studio adapter for this browser capability.',
          ),
        );
      }
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }

  visit(ast);
  return { references, problems };
}

function nodeModule(specifier) {
  return specifier.startsWith('node:') || nodeModules.has(specifier);
}

async function resolveReferences(references, directory) {
  const local = references.filter(({ specifier }) => specifier && !nodeModule(specifier));
  const resolved = new Map();
  if (local.length === 0) return resolved;

  await build({
    absWorkingDir: directory,
    stdin: { contents: '' },
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'studio-module-references',
        setup(api) {
          api.onStart(async () => {
            await Promise.all(
              local.map(async (reference) => {
                const importer = resolve(directory, reference.filePath);
                const result = await api.resolve(reference.specifier, {
                  importer,
                  resolveDir: dirname(importer),
                  kind: reference.kind,
                });
                resolved.set(reference, result);
              }),
            );
          });
        },
      },
    ],
  });

  return resolved;
}

function problem(reference, rule, target, message) {
  const { filePath, line, column } = reference;
  return { filePath, line, column, rule, target, message };
}

function runtimeCycles(files, references, resolved, directory) {
  const graph = new Map(files.map(({ filePath }) => [filePath.replaceAll('\\', '/'), []]));
  for (const reference of references) {
    const resolution = resolved.get(reference);
    if (reference.runtime === false || !resolution?.path || resolution.external) continue;

    const target = relative(directory, resolution.path).replaceAll('\\', '/');
    if (graph.has(target)) graph.get(reference.filePath).push({ reference, target });
  }

  const complete = new Set();
  const active = new Map();
  const path = [];
  const cycles = [];
  function visit(file) {
    active.set(file, path.length);
    path.push(file);
    for (const { reference, target } of graph.get(file)) {
      if (active.has(target)) {
        const relatedFiles = [...path.slice(active.get(target)), target];
        cycles.push({
          ...problem(
            reference,
            'studio/module-cycle',
            '',
            'Runtime imports form a cycle: ' + relatedFiles.join(' → '),
          ),
          relatedFiles,
        });
      } else if (!complete.has(target)) {
        visit(target);
      }
    }
    path.pop();
    active.delete(file);
    complete.add(file);
  }
  for (const file of graph.keys()) {
    if (!complete.has(file)) visit(file);
  }

  return cycles;
}

function pageOf(filePath) {
  if (filePath.startsWith(pageDirectory)) return filePath.split('/')[3];
}

function featureOf(filePath) {
  if (filePath.startsWith(featureDirectory)) return filePath.split('/')[3];
}

function isShellModule(filePath) {
  return filePath === shellEntry || filePath.startsWith(shellDirectory);
}

function isOwnedSource(filePath, group) {
  if (!Object.hasOwn(forbiddenGroups, group)) return false;
  if (group !== 'app') return true;

  return applicationEntries.has(filePath) || applicationDirectories.has(filePath.split('/')[2]);
}

function viewBoundary(source, target) {
  const shell = isShellModule(source);
  if (isShellModule(target) && !shell) {
    return 'Keep the application shell private to startup. Pass shell state through page props.';
  }

  const page = pageOf(target);
  if (page && pageOf(source) !== page && (!shell || target !== pageEntries.get(page))) {
    return 'Compose pages through their public entries in the shell. Keep page details within the page.';
  }

  const feature = featureOf(target);
  if (shell && (feature || target === productRegistry)) {
    return 'Compose user features in the owning page instead of importing them from the shell.';
  }
  if (feature && featureOf(source) !== feature && target !== featureEntries.get(feature)) {
    return 'Use the public feature entry or a shared module rather than importing feature internals.';
  }
  if (target === productRegistry && featureOf(source)) {
    return 'Import product contracts directly. Let the product registry compose features.';
  }
}

function transportBoundary(source, target) {
  if (source.startsWith(transportDirectory)) {
    if (target === shellEntry || target === productRegistry || featureOf(target)) {
      return 'Keep transport adapters independent of application composition and user features.';
    }
    return;
  }
  if (!target.startsWith(transportDirectory)) return;
  if (pageOf(source)) {
    return 'Give pages data and actions from their features instead of transport adapters.';
  }
  if (
    (source === shellEntry && (target === transportBridge || target === transportClient)) ||
    (featureOf(source) && target === transportClient) ||
    (featureOf(source) === 'whiteboard' && target === draftStorage)
  ) {
    return;
  }
  if (
    source === collaborationController &&
    (target === collaborationChannel || target === transportDirectory + 'tool-response.ts')
  ) {
    return;
  }

  return 'Use the public Studio client. Keep host transport details within their owning adapters.';
}

function infrastructureBoundary(source, target) {
  if (source.startsWith(infrastructureDirectory)) {
    if (target.startsWith(coreDirectory) && !target.startsWith(coreDirectory + 'ports/')) {
      return 'Implement business ports without depending on business service internals.';
    }
    return;
  }
  if (!target.startsWith(infrastructureDirectory)) return;
  if (source === serverComposition) return;

  return 'Use the injected port. Bind infrastructure implementations in the server composition.';
}

function serverBusinessBoundary(source, target) {
  if (
    source.startsWith(serverDirectory) &&
    source !== serverComposition &&
    target.startsWith(coreDirectory) &&
    !businessEntries.has(target)
  ) {
    return 'Invoke business services through their public entry points.';
  }
}

function testBoundary(source, target) {
  const role = source.split('/')[1];
  if (target.startsWith(testDirectory) && testSuite.test(target)) {
    return 'Reuse fixtures and support modules instead of importing another test suite.';
  }
  if (
    (role === 'unit' || role === 'component') &&
    (target.startsWith(serverDirectory) || target.startsWith(infrastructureDirectory))
  ) {
    return 'Use an integration suite for real services and infrastructure adapters.';
  }
  const feature = featureOf(target);
  if (feature && target !== featureEntries.get(feature)) {
    if (role === 'unit' && unitFeatureOwners.get(source) !== feature) {
      return 'Use a feature public entry or place this unit suite in its owning feature scope.';
    }
    if (role === 'contracts') {
      return 'Verify contracts through the feature public entry.';
    }
  }
}

function runtimeDependencyBoundary(filePath, specifier) {
  const name = specifier.replace(/^node:/u, '');
  if (name === 'sqlite' && filePath !== infrastructureDirectory + 'sqlite-artifact.ts') {
    return 'Access SQLite through the Studio repository and archive adapters.';
  }
  if (
    (name === 'fs' || name.startsWith('fs/')) &&
    !filePath.startsWith(infrastructureDirectory) &&
    !backendFileAdapters.has(filePath)
  ) {
    return 'Read and write files through the owned storage adapter.';
  }
  if (
    /^(?:@modelcontextprotocol\/|@openai\/mcp-extensions(?:\/|$))/u.test(specifier) &&
    !protocolSdkAdapters.has(filePath)
  ) {
    return 'Use the Studio transport or protocol entry to access a host SDK.';
  }
  if (
    specifier === '@resvg/resvg-wasm' &&
    filePath !== infrastructureDirectory + 'png-renderer.ts'
  ) {
    return 'Rasterize through the injected PNG renderer.';
  }
}

function checkReference(reference, resolved, directory) {
  const { filePath, specifier } = reference;
  const from = filePath.split('/')[1];
  const test = filePath.startsWith(testDirectory);
  if (!specifier) {
    if (test) return;
    return problem(
      reference,
      'studio/unresolved-module',
      '',
      'Use an explicit module import so its boundary can be checked.',
    );
  }
  const builtin = nodeModule(specifier);
  if (builtin) {
    if (!test && (from === 'shared' || from === 'contracts')) {
      return problem(
        reference,
        'studio/module-boundary',
        specifier,
        'Keep shared code and contracts independent of Node built-in modules.',
      );
    }
    if (from === 'app') {
      return problem(
        reference,
        'studio/module-boundary',
        specifier,
        'Use the frontend client and shared contracts to access Studio services.',
      );
    }
  }
  if (!test && reference.runtime !== false) {
    const capability = runtimeDependencyBoundary(filePath, specifier);
    if (capability)
      return problem(reference, 'studio/runtime-capability-boundary', specifier, capability);
  }
  if (builtin) return;
  if (!resolved?.path) {
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
      return problem(
        reference,
        'studio/unresolved-module',
        specifier,
        'Resolve this local module to an existing file.',
      );
    }

    return;
  }
  if (resolved.external) return;

  const target = relative(directory, resolved.path).replaceAll('\\', '/');
  const [root, group] = target.split('/');
  if (root === 'tests' && !test) {
    return problem(
      reference,
      'studio/module-boundary',
      target,
      'Keep production code independent of test code and fixtures.',
    );
  }
  if (root === 'runtime' || root === 'lint') {
    return problem(
      reference,
      'studio/module-boundary',
      target,
      'Import product source rather than its generated runtime or lint tooling.',
    );
  }
  if (test) {
    const testProblem = testBoundary(filePath, target);
    if (testProblem) return problem(reference, 'studio/module-boundary', target, testProblem);
    return;
  }
  const boundaryProblem =
    viewBoundary(filePath, target) ??
    transportBoundary(filePath, target) ??
    infrastructureBoundary(filePath, target) ??
    serverBusinessBoundary(filePath, target);
  if (boundaryProblem) {
    return problem(reference, 'studio/module-boundary', target, boundaryProblem);
  }
  if (root === 'src' && forbiddenGroups[from]?.has(group)) {
    return problem(
      reference,
      'studio/module-boundary',
      target,
      `Keep ${from} independent of ${group}. Use its public contract or the appropriate adapter.`,
    );
  }
}

export async function findModuleBoundaryProblems(files, directory) {
  const references = [];
  const problems = [];
  for (const { filePath, source } of files) {
    const normalized = filePath.replaceAll('\\', '/');
    const production = normalized.startsWith('src/');
    const test = normalized.startsWith(testDirectory);
    if (!production && !test) continue;

    const group = normalized.split('/')[1];
    if (test && !testGroups.has(group)) {
      problems.push(
        problem(
          { filePath: normalized, line: 1, column: 1 },
          'studio/module-boundary',
          '',
          'Place test suites, fixtures, and support code under their test group.',
        ),
      );
      continue;
    }

    if (production && !isOwnedSource(normalized, group)) {
      problems.push(
        problem(
          { filePath: normalized, line: 1, column: 1 },
          'studio/module-boundary',
          '',
          'Place this file under its owning Studio source group.',
        ),
      );
      continue;
    }

    const page = pageOf(normalized);
    if (page && !pageEntries.has(page)) {
      problems.push(
        problem(
          { filePath: normalized, line: 1, column: 1 },
          'studio/module-boundary',
          '',
          'Register the public page entry before adding page modules.',
        ),
      );
      continue;
    }

    const feature = featureOf(normalized);
    if (feature && !featureEntries.has(feature)) {
      problems.push(
        problem(
          { filePath: normalized, line: 1, column: 1 },
          'studio/module-boundary',
          '',
          'Register the public feature entry before adding feature modules.',
        ),
      );
      continue;
    }

    const inspected = inspectSource(normalized, source);
    references.push(...inspected.references);
    problems.push(...inspected.problems);
  }

  const resolved = await resolveReferences(references, directory);
  for (const reference of references) {
    const issue = checkReference(reference, resolved.get(reference), directory);
    if (issue) problems.push(issue);
  }

  return [...problems, ...runtimeCycles(files, references, resolved, directory)];
}
