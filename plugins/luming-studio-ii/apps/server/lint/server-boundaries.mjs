import { isBuiltin } from 'node:module';
import { localResolver, projectPath, serverRoot } from './project-paths.mjs';

const whiteboard = 'src/modules/whiteboard/';
const catalog = 'src/modules/catalog/';
const catalogAdapters = 'src/infrastructure/adapters/catalog/';
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
  [catalogAdapters, 'catalog-adapters'],
  ['src/infrastructure/adapters/', 'adapters'],
  ['src/infrastructure/platform/', 'platform'],
  ['tests/contracts/', 'contracts'],
  ['tests/unit/', 'unit'],
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
      'adapters',
      'catalog-adapters',
      'platform',
    ],
  ],
  ['http', ['application', 'catalog-application']],
  ['mcp', ['application']],
  ['workflows', ['application']],
  ['application', ['domain', 'ports']],
  ['ports', ['domain']],
  ['adapters', ['ports', 'platform']],
  ['catalog-application', ['catalog-domain', 'catalog-ports']],
  ['catalog-ports', ['catalog-domain']],
  ['catalog-adapters', ['catalog-ports', 'platform']],
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
      'fixtures',
    ],
  ],
  ['integration', ['bootstrap', 'support', 'fixtures']],
  ['support', ['platform', 'adapters', 'catalog-adapters', 'fixtures']],
]);
const portLayers = new Set(['ports', 'catalog-ports']);
const protocolPrefix = '@codexworkbench/luming-studio-ii-contracts/whiteboard/';
const protocols = new Set([
  protocolPrefix + 'scene',
  protocolPrefix + 'payload',
  protocolPrefix + 'service',
  '@bufbuild/protobuf',
]);
const protocolLayers = new Set(['http', 'mcp', 'contracts', 'integration', 'support']);
const catalogProtocol = '@codexworkbench/luming-studio-ii-contracts/catalog/service';
const testLayers = new Set(['contracts', 'unit', 'integration', 'fixtures', 'support']);
const builtins = new Map([
  ['bootstrap', new Set(['crypto', 'os', 'path', 'process', 'url'])],
  ['http', new Set(['buffer', 'http', 'net', 'url'])],
  ['mcp', new Set(['buffer', 'stream', 'url'])],
  ['platform', new Set(['crypto', 'fs', 'fs/promises', 'os', 'path', 'sqlite', 'url'])],
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

function layerOf(path) {
  return [...layers].find(([prefix]) => path?.startsWith(prefix))?.[1];
}

function allowsLocal(sourceLayer, targetPath, typeOnly) {
  const targetLayer = layerOf(targetPath);
  if (!targetLayer) {
    return false;
  }
  if (sourceLayer === targetLayer) {
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
  if (specifier === catalogProtocol) {
    return layer !== 'mcp' && protocolLayers.has(layer);
  }
  if (protocols.has(specifier)) {
    return protocolLayers.has(layer);
  }

  if (isBuiltin(specifier)) {
    const name = specifier.replace(/^node:/u, '');

    return builtins.get(layer)?.has(name) || (testLayers.has(layer) && testBuiltins.has(name));
  }
  if (specifier === 'eslint') {
    return from === 'tests/contracts/server-lint.test';
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

      const local = resolveLocal(specifier);
      if (local && !local.file) {
        context.report({ node, messageId: 'unresolved' });
        return;
      }

      const targetPath = local && projectPath(root, local.file);
      const typeOnly = usesTypesOnly(node);
      const approved = local
        ? allowsLocal(layer, targetPath, typeOnly)
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
      if (!usesTypesOnly(node)) {
        for (const specifier of node.specifiers) {
          inspectExportedBinding(specifier, specifier.local);
        }
      }
    }

    function inspectExportedBinding(node, identifier) {
      if (identifier?.type !== 'Identifier') {
        return;
      }

      const binding = importBinding(context.sourceCode, identifier);
      if (binding?.parent?.source) {
        inspect(node, binding.parent.source, true);
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
