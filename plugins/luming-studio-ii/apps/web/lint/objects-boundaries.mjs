import { basename, dirname, relative, resolve, sep } from 'node:path';
import manifest from '../package.json' with { type: 'json' };
import {
  aliasTargets,
  baseRoot,
  contains,
  publicSpecifier,
  sourceRoot,
  testsRoot,
} from './project-paths.mjs';

export const objectsRoot = resolve(sourceRoot, 'ui/domain/objects');
const assemblyEntry = resolve(objectsRoot, 'index');
const objectTests = resolve(testsRoot, 'component/objects');
const objectUnitTests = resolve(testsRoot, 'unit/objects');
const testSupport = resolve(testsRoot, 'support/render-control');
const baseEntry = resolve(baseRoot, 'index');
const canvasEntry = resolve(sourceRoot, 'ui/domain/canvas/index');
const packagePath = manifest.name + '/ui/domain/objects/';
const assemblySpecifier = manifest.name + '/ui/domain/objects';
const packageSource = manifest.name + '/src/';
const canvasExtensionTypes = new Set([
  'CanvasObjectExtension',
  'CanvasObjectViewProps',
  'CanvasObjectNavigation',
  'CanvasObjectPayload',
  'CanvasObjectReceipt',
  'CanvasObjectOperation',
]);
const sharedTextEditorExports = new Set([
  'InlineTextEditor',
  'InlineTextEditorHandle',
  'InlineTextFormat',
  'InlineTextFormatState',
  'RichText',
  'richTextFirstLine',
]);
const scriptExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const externalPath = /^(?:[\\/]|[a-z]:[\\/]|[a-z][a-z+.-]*:\/\/|file:)/iu;
const families = new Map([
  ['document', 'DocumentObject'],
  ['embed', 'EmbedObject'],
  ['media', 'MediaObject'],
  ['sticker', 'StickerObject'],
  ['table', 'TableObject'],
  ['text', 'TextObject'],
  ['todo', 'TodoObject'],
]);
const reactLibraries = new Set(['react', 'react-dom', 'react/jsx-runtime']);
const documentLibraries = new Set([
  '@blocknote/core',
  '@blocknote/core/locales',
  '@blocknote/core/fonts/inter.css',
  '@blocknote/react',
  '@blocknote/ariakit',
  '@blocknote/ariakit/style.css',
]);
const testLibraries = new Set([
  ...reactLibraries,
  'react-dom/client',
  'vitest',
  'node:test',
  'node:assert',
]);
const embedTestModules = new Set(
  ['protocol', 'runtime'].map((file) => resolve(objectsRoot, 'embed', file)),
);

function stem(file) {
  return file.replace(scriptExtension, '');
}

function objectFamily(file) {
  if (contains(objectsRoot, file)) {
    const [family, child] = relative(objectsRoot, file).split(sep);

    return child && families.has(family) ? family : undefined;
  }
}

export function isObjectEntry(file) {
  const family = objectFamily(file);
  const entry = stem(file);

  return (
    entry === assemblyEntry ||
    (family !== undefined && entry === resolve(objectsRoot, family, 'index'))
  );
}

export function objectTestFamily(file) {
  if (contains(objectUnitTests, file)) {
    const family = basename(stem(file), '.test');

    return families.has(family) ? family : undefined;
  }
  if (contains(objectTests, file)) {
    const component = basename(stem(file), '.test');

    return [...families].find(([, name]) => name === component)?.[0];
  }
}

export function objectTargets(file, specifier) {
  if (specifier === publicSpecifier) {
    return [baseEntry];
  }
  if (specifier === assemblySpecifier) {
    return [assemblyEntry];
  }

  if (specifier.startsWith(packagePath)) {
    const [family, ...path] = specifier.slice(packagePath.length).split('/');

    return [resolve(objectsRoot, family, ...(path.length ? path : ['index']))];
  }
  if (specifier.startsWith(packageSource)) {
    return [resolve(sourceRoot, specifier.slice(packageSource.length))];
  }
  if (specifier.startsWith('.')) {
    return [resolve(dirname(file), specifier)];
  }
  if (specifier.startsWith('/src/')) {
    return [resolve(sourceRoot, specifier.slice('/src/'.length))];
  }

  return aliasTargets(specifier);
}

function allowedObjectImport(node, family, target) {
  if (objectFamily(target) === family || stem(target) === baseEntry) {
    return true;
  }

  const sharedTextEditor =
    family === 'table' && isObjectEntry(target) && objectFamily(target) === 'text';

  return sharedTextEditor && usesNamedImports(node, sharedTextEditorExports);
}

function allowedTestImport(file, family, target) {
  const entry = stem(target);
  if (contains(objectUnitTests, file)) {
    return family === 'embed' && embedTestModules.has(entry);
  }

  return (
    entry === testSupport ||
    entry === baseEntry ||
    (objectFamily(target) === family && isObjectEntry(target))
  );
}

function allowedLibrary(file, family, specifier) {
  if (objectTestFamily(file)) {
    return testLibraries.has(specifier) || (family === 'embed' && specifier === 'jsdom');
  }

  return (
    reactLibraries.has(specifier) || (family === 'document' && documentLibraries.has(specifier))
  );
}

function privateObjectReference(target, clean, specifier) {
  if (!contains(objectsRoot, target)) {
    return false;
  }

  const internalPath =
    clean.startsWith(packagePath) && clean.slice(packagePath.length).includes('/');

  return clean !== specifier || externalPath.test(clean) || internalPath;
}

function usesNamedImports(node, members) {
  if (node.type !== 'ImportDeclaration' || node.specifiers.length === 0) {
    return false;
  }

  return node.specifiers.every(
    (specifier) => specifier.type === 'ImportSpecifier' && members.has(specifier.imported.name),
  );
}

function isExtensionTypeImport(node, file, family, targets) {
  const adapter = resolve(objectsRoot, family, 'canvas-extension');
  if (stem(file) !== adapter || !targets.every((target) => stem(target) === canvasEntry)) {
    return false;
  }

  return node.importKind === 'type' && usesNamedImports(node, canvasExtensionTypes);
}

const contractBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      dependency:
        'Whiteboard objects use approved libraries, public controls and their own implementation.',
      private: 'Use the public entry for this whiteboard object.',
      suite: 'Exercise the real whiteboard object through its public contract.',
      dynamic: 'Use a literal module specifier for a verifiable object dependency.',
      family: 'Register this whiteboard object or test in the object boundary.',
    },
  },

  create(context) {
    const file = context.physicalFilename;
    const family = objectFamily(file);
    const assembly = stem(file) === assemblyEntry;
    const test = objectTestFamily(file);
    const withinSuite = contains(objectTests, file) || contains(objectUnitTests, file);
    function report(node, messageId) {
      context.report({ node, messageId });
    }

    function check(node, source) {
      if (typeof source?.value !== 'string') {
        if (family || test || assembly) {
          report(node, 'dynamic');
        }

        return;
      }

      const specifier = source.value;
      const [clean] = specifier.split(/[?#]/u, 1);
      const targets = objectTargets(file, clean);
      if (targets.some((target) => privateObjectReference(target, clean, specifier))) {
        report(node, 'private');
      } else if (test && !allowedTestDependency(targets, clean)) {
        report(node, 'suite');
      } else if (family && !allowedSourceDependency(node, targets, clean)) {
        report(node, 'dependency');
      } else if (assembly && !assemblyImports(targets)) {
        report(node, 'dependency');
      } else if (
        !family &&
        !test &&
        targets.some((target) => contains(objectsRoot, target) && !isObjectEntry(target))
      ) {
        report(node, 'private');
      }
    }

    function assemblyImports(targets) {
      return (
        targets.length > 0 &&
        targets.every((target) => objectFamily(target) && isObjectEntry(target))
      );
    }

    function allowedTestDependency(targets, specifier) {
      return targets.length
        ? targets.every((target) => allowedTestImport(file, test, target))
        : allowedLibrary(file, test, specifier);
    }

    function allowedSourceDependency(node, targets, specifier) {
      return targets.length
        ? targets.every((target) => allowedObjectImport(node, family, target)) ||
            isExtensionTypeImport(node, file, family, targets)
        : allowedLibrary(file, family, specifier);
    }

    return {
      Program(node) {
        const unregisteredObject = !family && !assembly && contains(objectsRoot, file);
        const unregisteredTest = withinSuite && !test;
        if (unregisteredObject || unregisteredTest) {
          report(node, 'family');
        }
      },
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node, node.source);
        }
      },
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
      TSImportType: (node) => check(node, node.argument?.literal ?? node.argument ?? node.source),
    };
  },
};

export default {
  meta: { name: 'luming-objects' },
  rules: { 'contract-boundary': contractBoundary },
};
