import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import noBrowserIo from './browser-capabilities.mjs';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const baseRoot = resolve(sourceRoot, 'ui/base');
const publicEntry = resolve(baseRoot, 'index');
const testsRoot = fileURLToPath(new URL('../tests/', import.meta.url));
const libraries = new Set(['react', 'react-dom', 'react/jsx-runtime']);
const componentName = /^[A-Z][A-Za-z0-9]*$/u;
const scriptExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const absoluteSpecifier = /^(?:[\\/]|[a-z][a-z0-9+.-]*:\/\/|file:)/iu;
const moduleMockMethods = new Set(['mock', 'doMock', 'importMock']);

function contains(directory, file) {
  const path = relative(directory, file);

  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function entryComponent(file) {
  const parts = relative(baseRoot, file).split(sep);
  const [folder, filename] = parts;

  if (parts.length === 2 && folder === filename && componentName.test(folder)) {
    return folder;
  }

  return undefined;
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
      dynamic: 'Use a literal module path so the UI boundary can be checked.',
      absolute: 'Use relative source imports or a public package entry.',
      export: 'Export only the named component and its explicit public types.',
      props: 'Export {{component}}Props alongside the public component.',
      test: 'Add tests/component/{{component}}.test.tsx to verify the public control contract.',
      ref: 'Declare public ref as Ref<{{component}}Handle> with an explicit capability handle.',
      handle: 'Expose exactly the methods declared in the public {{component}}Handle.',
      shape: 'Declare the public prop names explicitly.',
      mock: 'Exercise real base controls from their public entry.',
    },
  },

  create(context) {
    const file = context.physicalFilename;
    const fileStem = file.replace(scriptExtension, '');
    const fromBase = contains(baseRoot, file);
    const fromSource = contains(sourceRoot, file);
    const fromTests = contains(testsRoot, file);
    const isPublicEntry = fileStem === publicEntry;
    const owner = relative(baseRoot, file).split(sep)[0];
    const component = entryComponent(fileStem);
    const published = new Set();
    const publishedTypes = new Set();
    const handles = new Set();
    const handleCalls = [];
    const handleAliases = new Set();
    const reactNamespaces = new Set();

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
      if (!specifier.startsWith('.')) {
        if (fromBase && !libraries.has(specifier)) {
          context.report({ node, messageId: 'import' });
        }
        return;
      }

      const target = resolve(dirname(file), specifier.split(/[?#]/u)[0]);
      const targetStem = target.replace(scriptExtension, '');

      if (fromSource && contains(testsRoot, target)) {
        context.report({ node, messageId: 'tests' });
      }
      if (fromBase && !contains(baseRoot, target)) {
        context.report({ node, messageId: 'import' });
      }
      if (!contains(baseRoot, target)) {
        return;
      }

      if (specifier.includes('?') || specifier.includes('#')) {
        context.report({ node, messageId: 'private' });
        return;
      }

      const targetOwner = relative(baseRoot, target).split(sep)[0];
      const sameComponent = fromBase && owner === targetOwner;
      const siblingEntry = fromBase && entryComponent(targetStem);
      if (targetStem !== publicEntry && !sameComponent && !siblingEntry) {
        context.report({ node, messageId: 'private' });
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

    function checkMock(node) {
      const { callee } = node;
      if (callee.object?.name !== 'vi' || !moduleMockMethods.has(callee.property?.name)) {
        return;
      }

      const argument = node.arguments[0];
      const source = argument?.type === 'ImportExpression' ? argument.source : argument;
      if (typeof source?.value !== 'string') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }

      const specifier = source.value;
      const target = resolve(dirname(file), specifier);
      if (
        contains(baseRoot, target) ||
        specifier === '@codexworkbench/luming-studio-ii-web/ui/base'
      ) {
        context.report({ node, messageId: 'mock' });
      }
    }

    function checkCall(node) {
      if (fromTests) {
        checkMock(node);
      }

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
          if (!existsSync(resolve(testsRoot, 'component', name + '.test.tsx'))) {
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
  rules: { 'contract-boundary': contractBoundary, 'no-browser-io': noBrowserIo },
};
