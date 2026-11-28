import { isBuiltin } from 'node:module';
import { extname } from 'node:path';
import { localResolver, projectPath, serverRoot } from './project-paths.mjs';

const whiteboard = 'src/modules/whiteboard/';
const catalog = 'src/modules/catalog/';
const archives = 'src/modules/archives/';
const feedback = 'src/modules/feedback/';
const sharing = 'src/modules/sharing/';
const rooms = 'src/modules/rooms/';
const catalogAdapters = 'src/infrastructure/adapters/catalog/';
const archivesAdapters = 'src/infrastructure/adapters/archives/';
const feedbackAdapters = 'src/infrastructure/adapters/feedback/';
const sharingAdapters = 'src/infrastructure/adapters/sharing/';
const roomsAdapters = 'src/infrastructure/adapters/rooms/';
const authorizationAdapters = 'src/infrastructure/adapters/authorization/';
const archivesPlatform = 'src/infrastructure/platform/archives/';
const layers = new Map([
  ['src/bootstrap/', 'bootstrap'],
  ['src/entrypoints/http/', 'http'],
  ['src/entrypoints/mcp/', 'mcp'],
  ['src/application/workflows/', 'workflows'],
  [whiteboard + 'application/', 'application'],
  [whiteboard + 'domain/', 'domain'],
  [whiteboard + 'ports/', 'ports'],
  [catalog + 'application/', 'catalog-application'],
  [catalog + 'domain/', 'catalog-domain'],
  [catalog + 'ports/', 'catalog-ports'],
  [archives + 'application/', 'archives-application'],
  [archives + 'domain/', 'archives-domain'],
  [archives + 'ports/', 'archives-ports'],
  [feedback + 'application/', 'feedback-application'],
  [feedback + 'domain/', 'feedback-domain'],
  [feedback + 'ports/', 'feedback-ports'],
  [sharing + 'application/', 'sharing-application'],
  [sharing + 'domain/', 'sharing-domain'],
  [sharing + 'ports/', 'sharing-ports'],
  [rooms + 'application/', 'rooms-application'],
  [rooms + 'domain/', 'rooms-domain'],
  [rooms + 'ports/', 'rooms-ports'],
  [catalogAdapters, 'catalog-adapters'],
  [archivesAdapters, 'archives-adapters'],
  [feedbackAdapters, 'feedback-adapters'],
  [sharingAdapters, 'sharing-adapters'],
  [roomsAdapters, 'rooms-adapters'],
  [authorizationAdapters, 'authorization-adapters'],
  ['src/infrastructure/adapters/', 'adapters'],
  [archivesPlatform, 'archives-platform'],
  ['src/infrastructure/platform/', 'platform'],
  ['tests/contracts/', 'contracts'],
  ['tests/unit/', 'unit'],
  ['tests/integration/archives-platform/', 'archives-platform-tests'],
  ['tests/integration/', 'integration'],
  ['tests/fixtures/', 'fixtures'],
  ['tests/support/', 'support'],
]);
const entries = new Map([
  ['bootstrap', 'src/bootstrap/index'],
  ['http', 'src/entrypoints/http/index'],
  ['mcp', 'src/entrypoints/mcp/index'],
  ['application', whiteboard + 'application/index'],
  ['domain', whiteboard + 'domain/index'],
  ['ports', whiteboard + 'ports/index'],
  ['catalog-application', catalog + 'application/index'],
  ['catalog-domain', catalog + 'domain/index'],
  ['catalog-ports', catalog + 'ports/index'],
  ['catalog-adapters', catalogAdapters + 'index'],
  ['archives-application', archives + 'application/index'],
  ['archives-domain', archives + 'domain/index'],
  ['archives-ports', archives + 'ports/index'],
  ['feedback-application', feedback + 'application/index'],
  ['feedback-domain', feedback + 'domain/index'],
  ['feedback-ports', feedback + 'ports/index'],
  ['sharing-application', sharing + 'application/index'],
  ['sharing-domain', sharing + 'domain/index'],
  ['sharing-ports', sharing + 'ports/index'],
  ['rooms-application', rooms + 'application/index'],
  ['rooms-domain', rooms + 'domain/index'],
  ['rooms-ports', rooms + 'ports/index'],
  ['archives-adapters', archivesAdapters + 'index'],
  ['feedback-adapters', feedbackAdapters + 'index'],
  ['sharing-adapters', sharingAdapters + 'index'],
  ['rooms-adapters', roomsAdapters + 'index'],
  ['authorization-adapters', authorizationAdapters + 'index'],
  ['archives-platform', archivesPlatform + 'index'],
  ['adapters', 'src/infrastructure/adapters/index'],
  ['platform', 'src/infrastructure/platform/index'],
]);
const dependencies = new Map([
  [
    'bootstrap',
    [
      'http',
      'mcp',
      'application',
      'catalog-application',
      'archives-application',
      'feedback-application',
      'sharing-application',
      'rooms-application',
      'adapters',
      'catalog-adapters',
      'archives-adapters',
      'feedback-adapters',
      'sharing-adapters',
      'rooms-adapters',
      'authorization-adapters',
      'platform',
    ],
  ],
  [
    'http',
    [
      'application',
      'catalog-application',
      'archives-application',
      'feedback-application',
      'sharing-application',
      'rooms-application',
    ],
  ],
  ['workflows', ['application']],
  ['application', ['domain', 'ports']],
  ['ports', ['domain']],
  ['adapters', ['ports', 'platform', 'authorization-adapters']],
  ['catalog-application', ['catalog-domain', 'catalog-ports']],
  ['catalog-ports', ['catalog-domain']],
  ['catalog-adapters', ['catalog-ports', 'platform']],
  ['archives-application', ['archives-domain', 'archives-ports']],
  ['archives-ports', ['archives-domain']],
  [
    'archives-adapters',
    ['archives-ports', 'platform', 'archives-platform', 'authorization-adapters'],
  ],
  ['feedback-application', ['feedback-domain', 'feedback-ports']],
  ['feedback-ports', ['feedback-domain']],
  ['feedback-adapters', ['feedback-ports', 'platform', 'authorization-adapters']],
  ['sharing-application', ['sharing-domain', 'sharing-ports']],
  ['sharing-ports', ['sharing-domain']],
  ['sharing-adapters', ['sharing-ports', 'platform', 'authorization-adapters']],
  ['rooms-application', ['rooms-domain', 'rooms-ports']],
  ['rooms-ports', ['rooms-domain']],
  ['rooms-adapters', ['rooms-ports', 'platform']],
  ['authorization-adapters', ['platform']],
  ['contracts', ['bootstrap', 'support', 'fixtures']],
  [
    'unit',
    [
      'application',
      'domain',
      'ports',
      'catalog-application',
      'catalog-domain',
      'catalog-ports',
      'archives-application',
      'archives-domain',
      'archives-ports',
      'feedback-application',
      'feedback-domain',
      'feedback-ports',
      'sharing-application',
      'sharing-domain',
      'sharing-ports',
      'rooms-application',
      'rooms-domain',
      'rooms-ports',
      'fixtures',
    ],
  ],
  ['archives-platform-tests', ['archives-platform']],
  ['integration', ['bootstrap', 'support', 'fixtures']],
  [
    'support',
    [
      'platform',
      'adapters',
      'catalog-adapters',
      'archives-adapters',
      'feedback-adapters',
      'sharing-adapters',
      'rooms-adapters',
      'fixtures',
    ],
  ],
]);
const portLayers = new Set([
  'ports',
  'catalog-ports',
  'archives-ports',
  'feedback-ports',
  'sharing-ports',
  'rooms-ports',
]);
const protocolPrefix = '@codexworkbench/luming-studio-ii-contracts/whiteboard/';
const connectorRoute = protocolPrefix + 'connector-route';
const connectorRouteSources = new Set([
  whiteboard + 'domain/export-geometry',
  whiteboard + 'domain/export-svg',
]);
const catalogProtocol = '@codexworkbench/luming-studio-ii-contracts/catalog/service';
const roomsProtocol = '@codexworkbench/luming-studio-ii-contracts/rooms/service';
const roomStreamRoute = 'src/entrypoints/http/room-event-stream';
const roomStreamTest = 'tests/integration/room-event-stream.test';
const mcpActivity = 'src/entrypoints/mcp/agent-activity';
const mcpActivityTest = 'tests/integration/mcp-agent-activity.test';
const mcpTestLibraries = new Set([
  '@modelcontextprotocol/sdk/client/index.js',
  '@modelcontextprotocol/sdk/inMemory.js',
]);
const mcpRuntime = 'src/infrastructure/platform/mcp-runtime';
const mcpRuntimeBuiltins = new Set(['child_process', 'readline', 'process']);
const protocols = new Set([
  protocolPrefix + 'scene',
  protocolPrefix + 'payload',
  protocolPrefix + 'service',
  '@bufbuild/protobuf',
]);
const protocolLayers = new Set(['http', 'mcp', 'contracts', 'integration', 'support']);
const httpProtocols = new Set([
  protocolPrefix + 'edits',
  protocolPrefix + 'history',
  catalogProtocol,
  '@codexworkbench/luming-studio-ii-contracts/archives/service',
  '@codexworkbench/luming-studio-ii-contracts/feedback/service',
  '@codexworkbench/luming-studio-ii-contracts/sharing/service',
  roomsProtocol,
  '@codexworkbench/luming-studio-ii-contracts/suggestions/service',
]);
const mcpLibraries = new Set([
  '@modelcontextprotocol/sdk/server/mcp.js',
  '@modelcontextprotocol/sdk/server/stdio.js',
  '@modelcontextprotocol/ext-apps/server',
  '@openai/mcp-extensions/server',
  'zod',
]);
const testLayers = new Set([
  'contracts',
  'unit',
  'integration',
  'archives-platform-tests',
  'fixtures',
  'support',
]);
const builtins = new Map([
  ['bootstrap', new Set(['crypto', 'os', 'path', 'process', 'url'])],
  ['http', new Set(['buffer', 'http', 'net', 'url'])],
  ['mcp', new Set(['buffer', 'stream', 'url'])],
  ['platform', new Set(['crypto', 'fs', 'fs/promises', 'os', 'path', 'sqlite', 'url'])],
  [
    'archives-platform',
    new Set([
      'buffer',
      'crypto',
      'fs',
      'fs/promises',
      'os',
      'path',
      'stream',
      'stream/promises',
      'zlib',
    ]),
  ],
]);
const testBuiltins = new Set([
  'assert',
  'assert/strict',
  'buffer',
  'child_process',
  'events',
  'fs',
  'fs/promises',
  'http',
  'net',
  'os',
  'path',
  'process',
  'test',
  'url',
  'util',
]);
const invalidSpecifier = /[?\\]|[^#]#|^(?:[/]|[a-z]:[/]|[a-z][a-z+.-]*:\/\/|file:)/iu;
const privateLibraries = new Map([
  ['@connectrpc/connect', new Set([roomStreamRoute, roomStreamTest])],
  ['@connectrpc/connect-node', new Set([roomStreamRoute, roomStreamTest])],
  ['proper-lockfile', new Set([mcpRuntime])],
  ['@resvg/resvg-wasm', new Set(['src/infrastructure/platform/png-renderer'])],
  ['parse5', new Set([feedbackAdapters + 'content-source', catalogAdapters + 'thumbnail-html'])],
  [protocolPrefix + 'stickers', new Set([catalog + 'domain/thumbnail-sticker'])],
  ['eslint', new Set(['tests/contracts/server-lint.test'])],
]);

function layerOf(path) {
  return [...layers].find(([prefix]) => path?.startsWith(prefix))?.[1];
}

function allowsLocal(sourceLayer, targetPath, typeOnly, from) {
  const targetLayer = layerOf(targetPath);
  if (!targetLayer) {
    return false;
  }
  if (sourceLayer === targetLayer) {
    return true;
  }
  if (from === mcpActivityTest && targetPath === entries.get('mcp')) {
    return true;
  }
  if (!dependencies.get(sourceLayer)?.includes(targetLayer)) {
    return false;
  }
  if (portLayers.has(sourceLayer) && !typeOnly) {
    return false;
  }

  return testLayers.has(targetLayer) || entries.get(targetLayer) === targetPath;
}

function allowsLibrary(layer, specifier, from) {
  if (mcpTestLibraries.has(specifier)) {
    return from === mcpActivityTest;
  }
  if (mcpLibraries.has(specifier)) {
    return layer === 'mcp';
  }
  if (httpProtocols.has(specifier)) {
    return layer === 'mcp'
      ? (specifier === catalogProtocol && from === entries.get('mcp')) ||
          (specifier === roomsProtocol && from === mcpActivity)
      : protocolLayers.has(layer);
  }
  if (protocols.has(specifier)) {
    return protocolLayers.has(layer);
  }

  if (isBuiltin(specifier)) {
    const name = specifier.replace(/^node:/u, '');
    if (from === mcpRuntime && mcpRuntimeBuiltins.has(name)) {
      return true;
    }

    return builtins.get(layer)?.has(name) || (testLayers.has(layer) && testBuiltins.has(name));
  }
  const sources = privateLibraries.get(specifier);
  if (sources) {
    return sources.has(from);
  }

  return specifier === 'vitest' && testLayers.has(layer);
}

function usesTypesOnly(node) {
  if (node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type') {
    return true;
  }

  const { specifiers } = node;

  return Boolean(
    specifiers?.length &&
    specifiers.every(
      (specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type',
    ),
  );
}

function allowsConnectorRoute(node, from, file) {
  const namedImport =
    node.type === 'ImportDeclaration' &&
    node.specifiers.length > 0 &&
    node.specifiers.every(({ type }) => type === 'ImportSpecifier');

  return connectorRouteSources.has(from) && extname(file) === '.ts' && namedImport;
}

function importBinding(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      return variable.defs.find(({ type }) => type === 'ImportBinding');
    }

    scope = scope.upper;
  }

  return undefined;
}

const contractBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      location: 'Place the file inside a declared server layer or test suite.',
      unresolved: 'Use a resolvable, literal module specifier.',
      dependency: 'This dependency crosses the server architecture or test boundary.',
      reexport:
        'Publish explicit local members through the server entry. Keep capabilities in their owner.',
    },
  },

  create(context) {
    const root = context.settings.studioServerRoot ?? serverRoot;
    const from = projectPath(root, context.physicalFilename);
    const layer = layerOf(from);
    if (!layer) {
      return { Program: (node) => context.report({ node, messageId: 'location' }) };
    }

    const resolveLocal = localResolver(root, context.physicalFilename);

    function inspect(node, reference, reexport = false) {
      const specifier = reference?.value;
      if (typeof specifier !== 'string' || invalidSpecifier.test(specifier)) {
        context.report({ node, messageId: 'unresolved' });
        return;
      }

      if (specifier === connectorRoute) {
        if (reexport || !allowsConnectorRoute(node, from, context.physicalFilename)) {
          context.report({ node, messageId: reexport ? 'reexport' : 'dependency' });
        }

        return;
      }
      const local = resolveLocal(specifier);
      if (local && !local.file) {
        context.report({ node, messageId: 'unresolved' });
        return;
      }

      const targetPath = local && projectPath(root, local.file);
      const typeOnly = usesTypesOnly(node);
      const approved = local
        ? allowsLocal(layer, targetPath, typeOnly, from)
        : allowsLibrary(layer, specifier, from);

      if (!approved) {
        context.report({ node, messageId: 'dependency' });
        return;
      }
      if (reexport && !typeOnly && layerOf(targetPath) !== layer) {
        context.report({ node, messageId: 'reexport' });
      }
    }

    function inspectExport(node) {
      if (node.source) {
        inspect(node, node.source, true);
        return;
      }
      const typeOnly = usesTypesOnly(node);
      for (const specifier of node.specifiers) {
        inspectExportedBinding(specifier, specifier.local, typeOnly);
      }
    }

    function inspectExportedBinding(node, identifier, typeOnly = false) {
      if (identifier?.type !== 'Identifier') {
        return;
      }

      const binding = importBinding(context.sourceCode, identifier);
      const source = binding?.parent?.source;
      if (source && (!typeOnly || source.value === connectorRoute)) {
        inspect(node, source, true);
      }
    }

    return {
      ImportDeclaration: (node) => inspect(node, node.source),
      ExportNamedDeclaration: inspectExport,
      ExportDefaultDeclaration: (node) => inspectExportedBinding(node, node.declaration),
      ExportAllDeclaration(node) {
        if (from === entries.get(layer)) {
          context.report({ node, messageId: 'reexport' });
          return;
        }

        inspect(node, node.source, true);
      },
      ImportExpression: (node) => inspect(node, node.source),
      TSImportType: (node) => inspect(node, node.argument?.literal ?? node.argument ?? node.source),
      CallExpression(node) {
        if (node.callee.type === 'Import') {
          inspect(node, node.arguments[0]);
        }
      },
    };
  },
};

export default { rules: { 'contract-boundary': contractBoundary } };
