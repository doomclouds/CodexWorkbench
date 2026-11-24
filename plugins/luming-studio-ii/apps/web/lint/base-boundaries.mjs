import { existsSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import noBrowserIo from './browser-capabilities.mjs';
import {
  aliasTargets,
  baseRoot,
  contains,
  publicSpecifier,
  sourceRoot,
  testsRoot,
} from './project-paths.mjs';
import testContract from './test-contract.mjs';

const internalRoot = resolve(baseRoot, 'internal');
const publicEntry = resolve(baseRoot, 'index');
const componentTests = resolve(testsRoot, 'component');
const fixtureRoots = ['support/base-ui', 'fixtures/base-ui'].map((name) =>
  resolve(testsRoot, name),
);
const fixtureEntries = new Set(
  ['render-control', 'setup'].map((name) => resolve(testsRoot, 'support', name)),
);
const libraries = new Set(['react', 'react-dom', 'react/jsx-runtime']);
const testLibraries = new Set([...libraries, 'react-dom/client', 'vitest']);
const componentName = /^[A-Z][A-Za-z0-9]*$/u;
const scriptExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const absoluteSpecifier = /^(?:[\\/]|[a-z][a-z0-9+.-]*:\/\/|file:)/iu;

function baseFixture(file) {
  const stem = file.replace(scriptExtension, '');

  return fixtureEntries.has(stem) || fixtureRoots.some((directory) => contains(directory, file));
}

function entryComponent(file) {
  const parts = relative(baseRoot, file).split(sep);
  const [folder, filename] = parts;

  if (parts.length === 2 && folder === filename && componentName.test(folder)) {
    return folder;
  }

  return undefined;
}

function isBaseSuite(file) {
  const name = basename(file, '.test.tsx');

  return (
    contains(componentTests, file) &&
    componentName.test(name) &&
    existsSync(resolve(baseRoot, name, name + '.tsx'))
  );
}

function publicType(name, component) {
  return name.startsWith(component) && componentName.test(name.slice(component.length));
}

function typeMembers(declaration) {
  if (declaration.type === 'TSInterfaceDeclaration') {
    return declaration.body.body;
  }

  return declaration.typeAnnotation?.members ?? [];
}

function isTypeDeclaration(declaration) {
  return ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(declaration.type);
}

function explicitHandleFactory(node, members) {
  const factory = node.arguments[1];
  const body = factory?.type === 'ArrowFunctionExpression' && factory.body;
  if (body?.type !== 'ObjectExpression' || body.properties.length !== members.size) {
    return false;
  }

  return body.properties.every(
    (property) =>
      property.type === 'Property' && !property.computed && members.has(property.key.name),
  );
}

const contractBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      import: 'Base controls may import React and modules within ui/base.',
      private: 'Use the public ui/base index. Component implementation files are private.',
      tests: 'Production source cannot import test modules.',
      suite: 'Base control tests depend on the public control API and local test fixtures.',
      dynamic: 'Use a literal module path so the UI boundary can be checked.',
      absolute: 'Use relative source imports or a public package entry.',
      export: 'Export only the named component and its explicit public types.',
      props: 'Export {{component}}Props alongside the public component.',
      signature: 'Use the explicit {{component}}Props type in the public component signature.',
      test: 'Add tests/component/{{component}}.test.tsx to verify the public control contract.',
      ref: 'Declare public ref as Ref<{{component}}Handle> with an explicit capability handle.',
      handle: 'Expose exactly the methods declared in the public {{component}}Handle.',
      shape: 'Declare the public prop names explicitly.',
    },
  },

  create(context) {
    const file = context.physicalFilename;
    const fileStem = file.replace(scriptExtension, '');
    const fromBase = contains(baseRoot, file);
    const fromInternal = contains(internalRoot, file);
    const fromSource = contains(sourceRoot, file);
    const baseSuite = isBaseSuite(file) || baseFixture(file);
    const isPublicEntry = fileStem === publicEntry;
    const owner = relative(baseRoot, file).split(sep)[0];
    const component = entryComponent(fileStem);
    const published = new Set();
    const publishedTypes = new Set();
    const handles = new Set();
    const handleCalls = [];
    const handleAliases = new Set();
    const reactNamespaces = new Set();

    function checkPackageReference(node, specifier) {
      if (specifier === publicSpecifier && !fromBase) {
        return;
      }

      const aliases = aliasTargets(specifier);
      if (aliases.length > 0) {
        for (const path of aliases) {
          checkRelativeReference(node, specifier, path);
        }
        return;
      }

      if (baseSuite && !testLibraries.has(specifier)) {
        context.report({ node, messageId: 'suite' });
      }
      if (fromBase && !libraries.has(specifier)) {
        context.report({ node, messageId: 'import' });
      }
    }

    function checkRelativeReference(node, specifier, target) {
      const targetStem = target.replace(scriptExtension, '');
      const targetInBase = contains(baseRoot, target);
      const targetInternal = contains(internalRoot, target);
      const fixture = baseFixture(target);

      if (baseSuite && !fixture && !targetInBase) {
        context.report({ node, messageId: 'suite' });
      }
      if (fromSource && contains(testsRoot, target)) {
        context.report({ node, messageId: 'tests' });
      }
      if (fromBase && !targetInBase) {
        context.report({ node, messageId: 'import' });
      }
      if (!targetInBase) {
        return;
      }

      if (specifier.includes('?') || specifier.includes('#')) {
        context.report({ node, messageId: 'private' });
        return;
      }

      if (fromInternal && !targetInternal) {
        context.report({ node, messageId: 'private' });
        return;
      }
      if (fromBase && targetInternal) {
        return;
      }

      const targetOwner = relative(baseRoot, target).split(sep)[0];
      const sameComponent = fromBase && owner === targetOwner;
      const siblingEntry = fromBase && entryComponent(targetStem);
      if (targetStem !== publicEntry && !sameComponent && !siblingEntry) {
        context.report({ node, messageId: 'private' });
      }
    }

    function checkReference(node, source) {
      if (typeof source?.value !== 'string') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }

      const specifier = source.value;
      if (absoluteSpecifier.test(specifier)) {
        context.report({ node, messageId: 'absolute' });
        return;
      }
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier.split(/[?#]/u)[0]);
        checkRelativeReference(node, specifier, target);
      } else {
        checkPackageReference(node, specifier);
      }
    }

    function checkContract(declaration) {
      if (declaration.id.name === component + 'Handle') {
        for (const member of typeMembers(declaration)) {
          if (member.type !== 'TSMethodSignature' || member.computed || !member.key.name) {
            context.report({ node: member, messageId: 'handle', data: { component } });
          } else {
            handles.add(member.key.name);
          }
        }
      }
      if (declaration.id.name !== component + 'Props') {
        return;
      }

      const indirectType =
        declaration.type === 'TSTypeAliasDeclaration' &&
        declaration.typeAnnotation.type !== 'TSTypeLiteral';

      if (declaration.extends?.length || indirectType) {
        context.report({ node: declaration, messageId: 'shape' });
      }

      for (const member of typeMembers(declaration)) {
        if (member.type === 'TSIndexSignature') {
          context.report({ node: member, messageId: 'shape' });
        }
        if (member.key?.name === 'ref') {
          const type = member.typeAnnotation?.typeAnnotation;
          const reference = type && context.sourceCode.getText(type).replace(/\s/gu, '');
          if (reference !== 'Ref<' + component + 'Handle>') {
            context.report({ node: member, messageId: 'ref', data: { component } });
          }
        }
      }
    }

    function checkPublicEntry(node) {
      const source = node.source?.value;
      const target = typeof source === 'string' && resolve(dirname(file), source);
      const targetName = target && entryComponent(target.replace(scriptExtension, ''));
      if (!targetName || node.specifiers.length === 0) {
        context.report({ node, messageId: 'export' });
        return;
      }

      for (const specifier of node.specifiers) {
        const name = specifier.exported?.name ?? '';
        const type = node.exportKind === 'type' || specifier.exportKind === 'type';
        if (name !== specifier.local?.name) {
          context.report({ node: specifier, messageId: 'export' });
        } else if (type && publicType(name, targetName)) {
          publishedTypes.add(name);
        } else if (!type && name === targetName) {
          published.add(name);
        } else {
          context.report({ node: specifier, messageId: 'export' });
        }
      }
    }

    function checkNamedExport(node) {
      if (node.source) {
        checkReference(node, node.source);
      }
      if (isPublicEntry) {
        checkPublicEntry(node);
        return;
      }
      if (!component) {
        return;
      }

      const declaration = node.declaration;
      if (
        declaration &&
        isTypeDeclaration(declaration) &&
        publicType(declaration.id.name, component)
      ) {
        checkContract(declaration);
        return;
      }
      if (declaration?.type !== 'FunctionDeclaration' || declaration.id?.name !== component) {
        context.report({ node, messageId: 'export' });
        return;
      }

      const propsAnnotation = declaration.params[0]?.typeAnnotation?.typeAnnotation;
      const propsType = propsAnnotation && context.sourceCode.getText(propsAnnotation);
      if (declaration.params.length !== 1 || propsType !== component + 'Props') {
        context.report({ node, messageId: 'signature', data: { component } });
      }
    }

    function checkImport(node) {
      checkReference(node, node.source);
      if (!component || node.source.value !== 'react') {
        return;
      }

      for (const specifier of node.specifiers) {
        if (specifier.imported?.name === 'useImperativeHandle') {
          handleAliases.add(specifier.local.name);
        }
        if (
          specifier.type === 'ImportNamespaceSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier'
        ) {
          reactNamespaces.add(specifier.local.name);
        }
      }
    }

    function checkCall(node) {
      const { callee } = node;
      const namespaced =
        reactNamespaces.has(callee.object?.name) && callee.property?.name === 'useImperativeHandle';

      if (handleAliases.has(callee.name) || namespaced) {
        handleCalls.push(node);
      }
    }

    return {
      ImportDeclaration: checkImport,
      ImportExpression: (node) => checkReference(node, node.source),
      TSImportType: (node) =>
        checkReference(node, node.argument?.literal ?? node.argument ?? node.source),
      CallExpression: checkCall,
      ExportNamedDeclaration: checkNamedExport,
      ExportAllDeclaration(node) {
        checkReference(node, node.source);
        if (isPublicEntry || component) {
          context.report({ node, messageId: 'export' });
        }
      },
      ExportDefaultDeclaration(node) {
        if (isPublicEntry || component) {
          context.report({ node, messageId: 'export' });
        }
      },

      'Program:exit'(node) {
        for (const name of published) {
          if (!publishedTypes.has(name + 'Props')) {
            context.report({ node, messageId: 'props', data: { component: name } });
          }
          if (!existsSync(resolve(componentTests, name + '.test.tsx'))) {
            context.report({ node, messageId: 'test', data: { component: name } });
          }
        }
        for (const call of handleCalls) {
          if (!explicitHandleFactory(call, handles)) {
            context.report({ node: call, messageId: 'handle', data: { component } });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'luming-base-ui' },
  rules: {
    'contract-boundary': contractBoundary,
    'no-browser-io': noBrowserIo,
    'test-contract': testContract,
  },
};
