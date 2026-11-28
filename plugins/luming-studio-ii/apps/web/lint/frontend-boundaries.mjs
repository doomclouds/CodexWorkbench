import { basename, dirname, relative, resolve, sep } from 'node:path';
import manifest from '../package.json' with { type: 'json' };
import { allowsConnectorRoute, connectorRoute } from './connector-route-boundary.mjs';
import { isObjectEntry, objectTargets } from './objects-boundaries.mjs';
import { isRegisteredPage, pageRegistryEntries, pageRegistryFile } from './page-registry.mjs';
import { aliasTargets, contains, sourceRoot, testsRoot } from './project-paths.mjs';
import { bindingOf } from './scope.mjs';

const webRoot = dirname(sourceRoot);
const scriptExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const moduleRoots = new Set(['pages', 'surfaces', 'data', 'platform']);
const applicationLayer = 'app';
const shellRoot = resolve(sourceRoot, 'app/shell');
const mcpPlatform = resolve(sourceRoot, 'platform/mcp');
const mcpSdkLibraries = new Set(['@modelcontextprotocol/ext-apps', '@openai/mcp-extensions/app']);
const uiDirectories = new Map([
  ['ui/base', 'base'],
  ['ui/domain/canvas', 'canvas'],
  ['ui/domain/objects', 'objects'],
]);
const dependencies = new Map([
  ['app', ['pages', 'shell', 'data', 'platform']],
  ['shell', ['base']],
  ['pages', ['surfaces', 'data', 'base']],
  ['surfaces', ['data', 'base', 'canvas', 'objects']],
  ['data', []],
  ['platform', ['platform']],
]);
const reactLibraries = new Set(['react', 'react/jsx-runtime']);
const appLibraries = new Set([...reactLibraries, 'react-dom', 'react-dom/client']);
const testLibraries = new Set([
  ...appLibraries,
  'vitest',
  'node:test',
  'node:assert',
  'node:assert/strict',
]);
const contractPackage = '@codexworkbench/luming-studio-ii-contracts';
const protocolRuntimes = new Set(['@bufbuild/protobuf', '@bufbuild/protobuf/wkt']);
const whiteboardData = resolve(sourceRoot, 'data/whiteboard');
const catalogData = resolve(sourceRoot, 'data/catalog');
const archiveImportData = resolve(sourceRoot, 'data/archive-import');
const feedbackData = resolve(sourceRoot, 'data/feedback');
const sharingData = resolve(sourceRoot, 'data/sharing');
const roomsData = resolve(sourceRoot, 'data/rooms');
const roomStreamImports = new Map([
  [
    '@connectrpc/connect',
    {
      file: resolve(roomsData, 'stream.ts'),
      types: new Set(['Transport']),
      values: new Set(['Code', 'ConnectError', 'createClient']),
    },
  ],
  [
    '@connectrpc/connect-web',
    {
      file: resolve(sourceRoot, 'platform/browser/room-stream.ts'),
      values: new Set(['createGrpcWebTransport']),
    },
  ],
]);
const suggestionsData = resolve(sourceRoot, 'data/suggestions');
const whiteboardPage = resolve(sourceRoot, 'pages/whiteboard');
const guestShell = resolve(shellRoot, 'AppShell.tsx');
const workbenchSurface = resolve(sourceRoot, 'surfaces/workbench');
const editorSurface = resolve(sourceRoot, 'surfaces/whiteboard-editor');
const viewingSurface = resolve(sourceRoot, 'surfaces/whiteboard-viewing');
const exportSurface = resolve(sourceRoot, 'surfaces/whiteboard-export');
const historySurface = resolve(sourceRoot, 'surfaces/whiteboard-history');
const feedbackSurface = resolve(sourceRoot, 'surfaces/whiteboard-feedback');
const mediaSurface = resolve(sourceRoot, 'surfaces/whiteboard-media');
const sharingSurface = resolve(sourceRoot, 'surfaces/board-sharing');
const suggestionsSurface = resolve(sourceRoot, 'surfaces/board-suggestions');
const guestJoinSurface = resolve(sourceRoot, 'surfaces/guest-join');
const roomPresenceSurface = resolve(sourceRoot, 'surfaces/room-presence');
const sharedTimerSurface = resolve(sourceRoot, 'surfaces/shared-timer');
const extraWhiteboardSurfaces = new Set([
  historySurface,
  feedbackSurface,
  mediaSurface,
  sharingSurface,
  suggestionsSurface,
  roomPresenceSurface,
  sharedTimerSurface,
]);
const iconSurfaces = new Set([
  workbenchSurface,
  viewingSurface,
  exportSurface,
  ...extraWhiteboardSurfaces,
  editorSurface,
  guestJoinSurface,
  resolve(sourceRoot, 'surfaces/recycle-bin'),
]);
const surfaceDataValues = new Map([
  [resolve(editorSurface, 'WhiteboardEditorSurface.tsx'), 'createWhiteboardSession'],
  [resolve(editorSurface, 'HistoryCanvasView.tsx'), 'createWhiteboardSession'],
  [resolve(editorSurface, 'suggestion-preview.tsx'), 'projectBoardChanges'],
  [resolve(workbenchSurface, 'WorkbenchSurface.tsx'), 'createCatalogDirectory'],
]);
const whiteboardDecoderImports = new Map([
  [
    resolve(roomsData, 'room-message.ts'),
    { types: new Set(['WhiteboardObject']), values: new Set(['readObjects']) },
  ],
  [
    resolve(suggestionsData, 'client.ts'),
    {
      types: new Set(['WhiteboardEditService', 'BoardEditReceipt']),
      values: new Set(['readBoardEditReceipt', 'readBoardEditChanges']),
    },
  ],
  [resolve(suggestionsData, 'contracts.ts'), { types: new Set(['BoardEditReceipt']) }],
]);
const injectedSurfacePorts = new Map([
  [workbenchSurface, catalogData],
  [editorSurface, whiteboardData],
  [viewingSurface, undefined],
  [exportSurface, whiteboardData],
  [historySurface, whiteboardData],
  [feedbackSurface, feedbackData],
  [mediaSurface, whiteboardData],
  [sharingSurface, sharingData],
  [suggestionsSurface, suggestionsData],
  [guestJoinSurface, sharingData],
  [roomPresenceSurface, roomsData],
  [sharedTimerSurface, roomsData],
]);
const protocolOwners = new Map([
  [contractPackage + '/whiteboard/scene', whiteboardData],
  [contractPackage + '/whiteboard/payload', whiteboardData],
  [contractPackage + '/whiteboard/service', whiteboardData],
  [contractPackage + '/whiteboard/edits', whiteboardData],
  [contractPackage + '/whiteboard/history', whiteboardData],
  [contractPackage + '/feedback/service', feedbackData],
  [contractPackage + '/sharing/service', sharingData],
  [contractPackage + '/suggestions/service', suggestionsData],
  [contractPackage + '/rooms/service', roomsData],
  [contractPackage + '/catalog/service', catalogData],
  [contractPackage + '/archives/service', archiveImportData],
]);
const protocolTestSuites = new Set(['contracts', 'fixtures', 'integration', 'support']);
const applicationTestSuites = new Set(['integration', 'support']);
const externalPath = /^(?:[\\/]|[a-z]:[\\/]|[a-z][a-z0-9+.-]*:\/\/|file:)/iu;

function stem(file) {
  return file.replace(scriptExtension, '');
}

function sourceOwner(file) {
  if (!contains(sourceRoot, file)) {
    return undefined;
  }

  for (const [directory, layer] of uiDirectories) {
    const root = resolve(sourceRoot, directory);
    if (contains(root, file)) {
      return { layer, root };
    }
  }

  const [layer, module, child] = relative(sourceRoot, file).split(sep);
  if (layer === applicationLayer) {
    if (contains(shellRoot, file)) {
      return { layer: 'shell', root: shellRoot };
    }

    return { layer, root: resolve(sourceRoot, layer) };
  }
  if (moduleRoots.has(layer) && child) {
    return { layer, root: resolve(sourceRoot, layer, module) };
  }
}

function testSuite(file) {
  if (contains(testsRoot, file)) {
    return relative(testsRoot, file).split(sep)[0];
  }
}

function isProtocol(specifier) {
  const family = specifier.split('/').slice(0, 2).join('/');

  return family === contractPackage || family === '@bufbuild/protobuf';
}

function allowedProtocol(specifier, owner, suite) {
  const test = protocolTestSuites.has(suite);
  if (protocolRuntimes.has(specifier)) {
    return owner?.layer === 'data' || test;
  }

  const protocolOwner = protocolOwners.get(specifier);

  return protocolOwner !== undefined && (protocolOwner === owner?.root || test);
}

function publicEntry(file, owner) {
  return owner.layer === 'objects'
    ? isObjectEntry(file)
    : stem(file) === resolve(owner.root, 'index');
}

function isTypeOnly(node) {
  if (node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type') {
    return true;
  }

  return Boolean(
    node.specifiers?.length &&
    node.specifiers.every((member) => member.importKind === 'type' || member.exportKind === 'type'),
  );
}

function isSurfaceDataValueImport(file, node) {
  const value = surfaceDataValues.get(file);
  if (!value || node.type !== 'ImportDeclaration' || !node.specifiers.length) {
    return false;
  }

  return node.specifiers.every(
    (member) =>
      member.type === 'ImportSpecifier' &&
      (member.importKind === 'type' || member.imported.name === value),
  );
}

function guestShellImport(file, target, targetOwner, typeOnly) {
  if (targetOwner.root === guestJoinSurface) {
    return file === guestShell && publicEntry(target, targetOwner);
  }
  if (file === guestShell && targetOwner.root === sharingData) {
    return typeOnly && publicEntry(target, targetOwner);
  }
}

function isNamedImportAllowed(node, imports) {
  if (node.type !== 'ImportDeclaration' || node.specifiers.length === 0) {
    return false;
  }

  return node.specifiers.every((member) => {
    if (member.type !== 'ImportSpecifier') {
      return false;
    }

    const typeOnly = node.importKind === 'type' || member.importKind === 'type';
    const allowed = typeOnly ? imports.types : imports.values;

    return allowed?.has(member.imported.name);
  });
}

function allowedLocal(owner, target, targetOwner, file, node) {
  if (!targetOwner) {
    return false;
  }
  if (targetOwner.root === owner.root) {
    return true;
  }

  const decoderImports = whiteboardDecoderImports.get(file);
  if (decoderImports && targetOwner.root === whiteboardData) {
    return publicEntry(target, targetOwner) && isNamedImportAllowed(node, decoderImports);
  }

  const typeOnly = isTypeOnly(node);
  const guestImport = guestShellImport(file, target, targetOwner, typeOnly);
  if (guestImport !== undefined) {
    return guestImport;
  }
  if (!dependencies.get(owner.layer)?.includes(targetOwner.layer)) {
    return false;
  }
  if (extraWhiteboardSurfaces.has(targetOwner.root) && owner.root !== whiteboardPage) {
    return false;
  }
  if (owner.layer === 'pages' && targetOwner.layer === 'data') {
    return typeOnly && publicEntry(target, targetOwner);
  }

  if (targetOwner.layer === 'data' && injectedSurfacePorts.has(owner.root)) {
    const publicPort =
      targetOwner.root === injectedSurfacePorts.get(owner.root) && publicEntry(target, targetOwner);

    return publicPort && (typeOnly || isSurfaceDataValueImport(file, node));
  }

  return publicEntry(target, targetOwner);
}

function allowedTest(suite, target, owner) {
  if (owner) {
    return publicEntry(target, owner);
  }

  const dependent = testSuite(target);

  return dependent === suite || dependent === 'fixtures' || dependent === 'support';
}

function isPortalImport(node) {
  const member = node.specifiers?.[0];

  return (
    node.type === 'ImportDeclaration' &&
    node.specifiers.length === 1 &&
    member?.imported?.name === 'createPortal'
  );
}

function allowedLibrary(owner, specifier, node, file) {
  if (mcpSdkLibraries.has(specifier)) {
    return owner.root === mcpPlatform;
  }
  if (specifier === 'lucide-react') {
    return iconSurfaces.has(owner.root);
  }

  if (specifier === 'react-dom' && owner.layer !== 'app') {
    const portalsAllowed =
      owner.root === workbenchSurface ||
      file === resolve(suggestionsSurface, 'BoardSuggestionsSurface.tsx');

    return portalsAllowed && isPortalImport(node);
  }

  switch (owner.layer) {
    case 'app':
      return appLibraries.has(specifier);
    case 'shell':
    case 'pages':
    case 'surfaces':
      return reactLibraries.has(specifier);
    default:
      return false;
  }
}

function referenceTargets(file, specifier) {
  const aliases = aliasTargets(specifier);
  if (aliases.length > 0) {
    return aliases;
  }

  if (specifier.startsWith(manifest.name + '/')) {
    const key = specifier.slice(manifest.name.length);
    const entry = Object.hasOwn(manifest.exports, '.' + key) && manifest.exports['.' + key];

    return typeof entry === 'string' ? [resolve(webRoot, entry)] : [];
  }

  return objectTargets(file, specifier);
}

const stickerArtwork = contractPackage + '/whiteboard/stickers';
const stickerCatalog = resolve(sourceRoot, 'ui/domain/objects/sticker/sticker-catalog.ts');
const richTextFormat = contractPackage + '/whiteboard/rich-text';
const richTextBridge = resolve(sourceRoot, 'ui/domain/objects/text/rich-text.ts');

const contractBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      location: 'Place this source in a declared frontend layer and module.',
      pageRegistration: 'Register this navigation page in app/routes.ts.',
      pageRegistry: 'Declare studioPages with explicit named imports from matching page entries.',
      pageWiring: 'Use the application route registry to mount pages.',
      dependency: 'Use a declared frontend dependency through its public index.',
      literal: 'Use a literal frontend module reference without resource modifiers.',
      protocol: 'Keep generated Protobuf and codecs in the data layer.',
      reexport: 'Publish explicit local members through the frontend public index.',
      test: 'Exercise the real application through public entries and injected test ports.',
    },
  },

  create(context) {
    const file = context.physicalFilename;
    const owner = sourceOwner(file);
    const suite = testSuite(file);
    const governed = dependencies.has(owner?.layer);
    const applicationTest = applicationTestSuites.has(suite);
    const isSource = contains(sourceRoot, file);
    const isEntry = owner && governed && publicEntry(file, owner);
    const isRegistry = file === pageRegistryFile;
    const declaredPages = isRegistry ? pageRegistryEntries(context.sourceCode.ast) : undefined;

    function pageIsRegistered(targetOwner) {
      return isRegistry
        ? declaredPages?.has(basename(targetOwner.root))
        : isRegisteredPage(targetOwner.root);
    }

    function boundaryProblem(node, target) {
      const targetOwner = sourceOwner(target);
      if (targetOwner?.layer === 'pages' && !pageIsRegistered(targetOwner)) {
        return 'pageRegistration';
      }
      if (targetOwner?.layer === 'pages' && owner?.layer === 'app' && !isRegistry) {
        return 'pageWiring';
      }
      if (applicationTest) {
        return allowedTest(suite, target, targetOwner) ? undefined : 'test';
      }
      if (governed) {
        return allowedLocal(owner, target, targetOwner, file, node) ? undefined : 'dependency';
      }
      if (isSource && dependencies.has(targetOwner?.layer)) {
        return 'dependency';
      }
      if (suite && dependencies.has(targetOwner?.layer) && !publicEntry(target, targetOwner)) {
        return 'test';
      }
    }

    function packageProblem(node, specifier, reexport) {
      if (specifier.startsWith('@connectrpc/')) {
        const imports = roomStreamImports.get(specifier);
        if (reexport) {
          return 'reexport';
        }
        if (imports?.file !== file || !isNamedImportAllowed(node, imports)) {
          return 'dependency';
        }

        return;
      }

      if (governed && !allowedLibrary(owner, specifier, node, file)) {
        return 'dependency';
      }

      const privateExport = !isTypeOnly(node) || mcpSdkLibraries.has(specifier);
      if (governed && reexport && privateExport) {
        return 'reexport';
      }
      if (applicationTest && !testLibraries.has(specifier)) {
        return 'test';
      }
    }

    function localProblem(node, targets, reexport) {
      const publishesRuntime = reexport && !isTypeOnly(node);

      for (const target of targets) {
        const problem = boundaryProblem(node, target);
        if (problem) {
          return problem;
        }
        if (governed && publishesRuntime && !contains(owner.root, target)) {
          return 'reexport';
        }
      }
    }

    function referenceProblem(node, written, reexport) {
      const explicitReference = governed || applicationTest;
      if (typeof written !== 'string' || externalPath.test(written)) {
        return explicitReference ? 'literal' : undefined;
      }

      const [specifier] = written.split(/[?#]/u, 1);
      if (specifier === connectorRoute) {
        if (reexport) {
          return 'reexport';
        }

        return written === specifier && allowsConnectorRoute(file, node) ? undefined : 'dependency';
      }
      if (file === stickerCatalog && written === stickerArtwork) {
        return;
      }
      if (file === richTextBridge && written === richTextFormat) {
        return;
      }

      const targets = referenceTargets(file, specifier);
      if (targets.length === 0 && isProtocol(specifier)) {
        return allowedProtocol(written, owner, suite) && !reexport ? undefined : 'protocol';
      }
      if (explicitReference && specifier !== written) {
        return 'literal';
      }

      return targets.length > 0
        ? localProblem(node, targets, reexport)
        : packageProblem(node, written, reexport);
    }

    function checkReference(node, ref, reexport = false) {
      const messageId = referenceProblem(node, ref?.value, reexport);
      if (messageId) {
        context.report({ node, messageId });
      }
    }

    function checkExportedBinding(node, identifier, typeOnly = false) {
      if (identifier?.type !== 'Identifier') {
        return;
      }

      const definition = bindingOf(context.sourceCode, identifier)?.defs[0];
      if (definition?.type === 'ImportBinding') {
        const source = definition.parent.source;
        const privatePackage =
          !typeOnly || mcpSdkLibraries.has(source.value) || source.value.startsWith('@connectrpc/');

        if (source.value === connectorRoute || (governed && privatePackage)) {
          checkReference(node, source, true);
        }
      }
    }

    return {
      Program(node) {
        if (isSource && !owner) {
          context.report({ node, messageId: 'location' });
        }
        if (owner?.layer === 'pages' && !isRegisteredPage(owner.root)) {
          context.report({ node, messageId: 'pageRegistration' });
        }
        if (isRegistry && !declaredPages) {
          context.report({ node, messageId: 'pageRegistry' });
        }
      },
      ImportDeclaration: (node) => checkReference(node, node.source),
      ImportExpression: (node) => checkReference(node, node.source),
      CallExpression(node) {
        if (node.callee.type === 'Import') {
          checkReference(node, node.arguments[0]);
        }
      },
      TSImportType: (node) =>
        checkReference(node, node.argument?.literal ?? node.argument ?? node.source),
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkReference(node, node.source, true);
          return;
        }
        const typeOnly = isTypeOnly(node);
        for (const member of node.specifiers) {
          checkExportedBinding(member, member.local, typeOnly);
        }
      },
      ExportDefaultDeclaration: (node) => checkExportedBinding(node, node.declaration),
      ExportAllDeclaration(node) {
        if (isEntry) {
          context.report({ node, messageId: 'reexport' });
          return;
        }

        checkReference(node, node.source, true);
      },
    };
  },
};

export default {
  meta: { name: 'luming-frontend' },
  rules: { 'contract-boundary': contractBoundary },
};
