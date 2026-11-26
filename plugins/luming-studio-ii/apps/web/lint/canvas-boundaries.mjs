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
import { bindingOf } from './scope.mjs';
import {
  isObjectEntry,
  objectsRoot,
  objectTargets,
  objectTestFamily,
} from './objects-boundaries.mjs';

const canvasRoot = resolve(sourceRoot, 'ui/domain/canvas');
const canvasEntry = resolve(canvasRoot, 'index');
const canvasComponent = resolve(canvasRoot, 'Canvas');
const canvasContracts = resolve(canvasRoot, 'contracts');
const baseEntry = resolve(baseRoot, 'index');
const packageName = manifest.name;
const canvasSpecifier = packageName + '/ui/domain/canvas';
const webRoot = dirname(sourceRoot);
const canvasFixtureRoot = resolve(testsRoot, 'fixtures/canvas');
const canvasUnitRoot = resolve(testsRoot, 'unit/canvas');
const canvasComponentTests = new Set([
  resolve(testsRoot, 'component/Canvas.test'),
  resolve(testsRoot, 'component/CanvasParity.test'),
]);
const canvasObjectsTest = resolve(testsRoot, 'component/CanvasObjects.test');
const testSupport = resolve(testsRoot, 'support/render-control');
const scriptExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const absoluteSpecifier = /^(?:[\\/]|[a-z]:[\\/]|[a-z][a-z0-9+.-]*:\/\/|file:)/iu;
const canvasTypeName = /^Canvas[A-Z][A-Za-z0-9]*$/u;
const domTypeName =
  /^(?:HTML\w*Element|SVG\w*Element|Element|ElementRef|Node|Document|Window|Navigator|Event|EventTarget|DOM\w+|(?:Animation|BeforeUnload|Clipboard|Composition|Drag|Focus|Form|Input|Keyboard|Mouse|Pointer|Synthetic|Touch|Transition|UI|Wheel)Event|ComponentProps(?:WithRef|WithoutRef)?|DetailedHTMLProps|HTMLAttributes|JSX|RefObject|document|window)$/u;
const publicReactTypes = new Set(['ComponentType', 'ReactNode', 'Ref']);
const publicDeclarations = new Set(['TSInterfaceDeclaration', 'TSTypeAliasDeclaration']);
const libraries = new Set(['react', 'react-dom', 'react/jsx-runtime']);
const testLibraries = new Set([
  ...libraries,
  'react-dom/client',
  'vitest',
  'node:assert',
  'node:test',
]);
const pathModules = new Set(['connectors', 'ink']);
const pathGeometry = new Set(
  [
    'connectors/adjacent',
    'connectors/geometry',
    'connectors/handles',
    'connectors/path',
    'ink/geometry',
  ].map((file) => resolve(canvasRoot, file)),
);
const pureModules = new Set(['viewport', 'scene', 'selection', 'gestures', ...pathModules]);
const moduleDependencies = new Map([
  ['viewport', []],
  ['scene', ['viewport', 'connectors', 'ink']],
  ['selection', ['viewport', 'scene', 'connectors', 'ink']],
  ['gestures', ['viewport']],
  ['connectors', ['viewport']],
  ['ink', ['viewport']],
  ['adapters', ['connectors', 'ink']],
  ['rendering', ['adapters', 'scene', 'connectors']],
  ['overlays', ['viewport', 'scene', 'gestures', 'connectors']],
]);
const handleMethods = new Set(['focus', 'fitToObjects']);
const requiredExports = ['Canvas', 'CanvasProps', 'CanvasHandle'];
const readonlyExports = new Map([
  ['CanvasShapeOutline', './adapters/CanvasShapeOutline.js'],
  ['expandCanvasSelection', './selection/index.js'],
]);

function stem(file) {
  return file.replace(scriptExtension, '');
}

function nameOf(node) {
  return node?.name ?? node?.value;
}

function canvasModule(file) {
  const [directory, fileName] = relative(canvasRoot, file).split(sep);

  return fileName ? directory : '';
}

function isPureCanvasFile(file) {
  const module = canvasModule(file);

  return pureModules.has(module) && (!pathModules.has(module) || pathGeometry.has(stem(file)));
}

function suiteKind(file) {
  if (contains(canvasUnitRoot, file)) {
    return 'unit';
  }

  const canvasTest = canvasComponentTests.has(stem(file)) || stem(file) === canvasObjectsTest;

  return canvasTest || contains(canvasFixtureRoot, file) ? 'component' : '';
}

function unitSubject(file) {
  const [directory, fileName] = relative(canvasUnitRoot, file).split(sep);

  return fileName ? directory : basename(stem(file), '.test');
}

function referenceTargets(file, specifier) {
  if (specifier === canvasSpecifier) {
    return [canvasEntry];
  }
  if (specifier === publicSpecifier) {
    return [baseEntry];
  }
  if (specifier.startsWith(canvasSpecifier + '/')) {
    return [resolve(canvasRoot, specifier.slice(canvasSpecifier.length + 1))];
  }
  if (specifier.startsWith(packageName + '/src/')) {
    return [resolve(webRoot, specifier.slice(packageName.length + 1))];
  }
  if (specifier.startsWith('.')) {
    return [resolve(dirname(file), specifier)];
  }

  return aliasTargets(specifier);
}

function typeSource(node) {
  return node.argument?.literal ?? node.argument ?? node.source;
}

function withoutSpaces(sourceCode, node) {
  return node && sourceCode.getText(node).replace(/\s/gu, '');
}

function isPublicReExport(node, file) {
  const source = node.source?.value;
  if (!source?.startsWith('.') || node.specifiers.length === 0) {
    return false;
  }

  const target = stem(resolve(dirname(file), source));

  return node.specifiers.every((specifier) => {
    const name = nameOf(specifier.exported);
    const sameName = specifier.type === 'ExportSpecifier' && name === nameOf(specifier.local);
    const typeOnly = node.exportKind === 'type' || specifier.exportKind === 'type';
    const valueAllowed =
      (target === canvasComponent && name === 'Canvas') || readonlyExports.get(name) === source;

    return (
      sameName &&
      (typeOnly ? target === canvasContracts && canvasTypeName.test(name) : valueAllowed)
    );
  });
}

function handleMemberMatches(member, sourceCode) {
  const name = nameOf(member.key);
  const requiredMethod =
    member.type === 'TSMethodSignature' && !member.computed && !member.optional;

  if (!requiredMethod || !handleMethods.has(name)) {
    return false;
  }

  const parameters = member.params ?? member.parameters;
  const parameterType = parameters[0]?.typeAnnotation?.typeAnnotation;
  const returnType = member.returnType ?? member.typeAnnotation;
  const hasVoidResult = returnType?.typeAnnotation.type === 'TSVoidKeyword';
  if (name === 'focus') {
    return hasVoidResult && parameters.length === 0;
  }

  return (
    hasVoidResult &&
    parameters.length === 1 &&
    !parameters[0].optional &&
    withoutSpaces(sourceCode, parameterType) === 'readonlystring[]'
  );
}

function hasExactHandleMembers(keys) {
  return (
    keys.length === handleMethods.size &&
    new Set(keys).size === handleMethods.size &&
    keys.every((key) => handleMethods.has(key))
  );
}

function handleFactoryMatches(node) {
  const factory = node.arguments[1];
  const body = factory?.type === 'ArrowFunctionExpression' && factory.body;
  if (body?.type !== 'ObjectExpression') {
    return false;
  }

  const keys = body.properties.map(
    (property) => property.type === 'Property' && !property.computed && nameOf(property.key),
  );

  return hasExactHandleMembers(keys);
}

function reactHandleCall(sourceCode, callee) {
  const receiver = callee.type === 'MemberExpression' ? callee.object : callee;
  if (receiver.type !== 'Identifier') {
    return false;
  }

  const definition = bindingOf(sourceCode, receiver)?.defs[0];
  if (definition?.type !== 'ImportBinding' || definition.parent.source.value !== 'react') {
    return false;
  }
  if (callee.type === 'MemberExpression') {
    return (
      ['ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(definition.node.type) &&
      nameOf(callee.property) === 'useImperativeHandle'
    );
  }

  return nameOf(definition.node.imported) === 'useImperativeHandle';
}

function allowedCanvasDependency(file, target) {
  const owner = canvasModule(file);
  const dependency = canvasModule(target);
  if (stem(target) === canvasEntry) {
    return false;
  }
  if (stem(file) === canvasContracts) {
    return false;
  }
  if (stem(target) === canvasContracts || !owner) {
    return true;
  }
  if (isPureCanvasFile(file) && pathModules.has(dependency) && !pathGeometry.has(stem(target))) {
    return false;
  }

  const allowed = moduleDependencies.get(owner);

  return allowed !== undefined && (dependency === owner || allowed.includes(dependency));
}

function allowedUnitDependency(file, target) {
  const subject = unitSubject(file);

  return (
    stem(target) === canvasContracts ||
    (isPureCanvasFile(target) && canvasModule(target) === subject && /\.(?:js|ts)$/u.test(target))
  );
}

function allowedTestDependency(file, target) {
  if (suiteKind(file) === 'unit') {
    return allowedUnitDependency(file, target);
  }

  const entry = stem(target);
  const shapeHarness = contains(canvasFixtureRoot, file) || stem(file) === canvasObjectsTest;

  return (
    entry === canvasEntry ||
    entry === baseEntry ||
    entry === testSupport ||
    contains(canvasFixtureRoot, target) ||
    (shapeHarness && isObjectEntry(target))
  );
}

function dependencyProblem(file, target) {
  if (contains(canvasRoot, file)) {
    if (contains(canvasRoot, target)) {
      return allowedCanvasDependency(file, target) ? undefined : 'layer';
    }

    return stem(file) !== canvasContracts && !isPureCanvasFile(file) && stem(target) === baseEntry
      ? undefined
      : 'import';
  }
  if (suiteKind(file)) {
    return allowedTestDependency(file, target) ? undefined : 'suite';
  }
  if (contains(canvasRoot, target) && stem(target) !== canvasEntry) {
    return 'private';
  }

  return undefined;
}

function packageProblem(file, specifier) {
  if (stem(file) === canvasContracts) {
    return specifier === 'react' ? undefined : 'import';
  }
  if (contains(canvasRoot, file)) {
    return !isPureCanvasFile(file) && libraries.has(specifier) ? undefined : 'import';
  }
  if (suiteKind(file)) {
    return testLibraries.has(specifier) ? undefined : 'suite';
  }

  return undefined;
}

const contractBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      private: 'Import Canvas through its public index or package subpath.',
      dynamic: 'Use a literal module path so the Canvas boundary can be checked.',
      import: 'Canvas depends on React, the public Base API and approved Canvas modules.',
      layer: 'This dependency crosses the Canvas module boundary.',
      suite: 'Keep Canvas tests within their public contract or the matching pure unit.',
      export: 'Publish Canvas and explicit, unaliased Canvas contract types only.',
      signature: 'Declare Canvas as a named function with a CanvasProps parameter.',
      dom: 'Keep native DOM and browser events out of Canvas public contracts.',
      ref: 'Declare the Canvas ref as Ref<CanvasHandle>.',
      handle: 'Expose exactly focus() and fitToObjects(ids) through CanvasHandle.',
    },
  },

  create(context) {
    const file = context.physicalFilename;
    const entry = stem(file);
    const sourceCode = context.sourceCode;
    const exports = new Set();
    const observesBase = contains(canvasRoot, file) || suiteKind(file);

    function inspectReference(node, source) {
      const specifier = source?.value;
      if (typeof specifier !== 'string' || absoluteSpecifier.test(specifier)) {
        context.report({ node, messageId: 'dynamic' });
        return;
      }

      const clean = specifier.split(/[?#]/u)[0];
      const targets = referenceTargets(file, clean);
      for (const target of targets) {
        const privatePackagePath = clean !== canvasSpecifier && clean.startsWith(packageName + '/');
        const obstructedEntry =
          (clean !== specifier || privatePackagePath) && contains(canvasRoot, target);
        const baseResource = observesBase && clean !== specifier && contains(baseRoot, target);
        const problem =
          obstructedEntry || baseResource ? 'private' : dependencyProblem(file, target);

        if (problem) {
          context.report({ node, messageId: problem });
          return;
        }
      }
      if (targets.length === 0) {
        const problem = packageProblem(file, specifier);
        if (problem) {
          context.report({ node, messageId: problem });
        }
      }
    }

    function inspectContractType(node, name) {
      if (entry !== canvasContracts) {
        return;
      }

      let part = name;
      while (part) {
        if (domTypeName.test(nameOf(part.right ?? part))) {
          context.report({ node, messageId: 'dom' });
          return;
        }
        part = part.left;
      }
    }

    function inspectImport(node) {
      inspectReference(node, node.source);
      if (entry !== canvasContracts) {
        return;
      }

      for (const specifier of node.specifiers) {
        const name = nameOf(specifier.imported);
        const typeOnly = node.importKind === 'type' || specifier.importKind === 'type';
        if (!typeOnly || !publicReactTypes.has(name) || name !== specifier.local.name) {
          context.report({ node: specifier, messageId: 'dom' });
        }
      }
    }

    function inspectDeclaredHandle(declaration) {
      const members = declaration.body?.body ?? [];
      const names = members.map((member) => nameOf(member.key));
      const directInterface =
        declaration.type === 'TSInterfaceDeclaration' && !declaration.extends?.length;

      if (
        !directInterface ||
        !hasExactHandleMembers(names) ||
        !members.every((member) => handleMemberMatches(member, sourceCode))
      ) {
        context.report({ node: declaration, messageId: 'handle' });
      }
    }

    function inspectExport(node) {
      if (node.source) {
        inspectReference(node, node.source);
      }
      if (entry === canvasEntry) {
        if (isPublicReExport(node, file)) {
          for (const specifier of node.specifiers) {
            exports.add(nameOf(specifier.exported));
          }
        } else {
          context.report({ node, messageId: 'export' });
        }
      }
      if (entry === canvasContracts && !publicDeclarations.has(node.declaration?.type)) {
        context.report({ node, messageId: 'export' });
      }
      if (entry === canvasComponent) {
        const declaration = node.declaration;
        const props = declaration?.params?.[0]?.typeAnnotation?.typeAnnotation;
        if (declaration?.type !== 'FunctionDeclaration' || declaration.id?.name !== 'Canvas') {
          context.report({ node, messageId: 'export' });
        } else if (declaration.params.length !== 1 || nameOf(props?.typeName) !== 'CanvasProps') {
          context.report({ node, messageId: 'signature' });
        }
      }
    }

    function rejectNonNamedExport(node) {
      if (entry === canvasEntry || entry === canvasComponent || entry === canvasContracts) {
        context.report({ node, messageId: 'export' });
      }
    }

    return {
      ImportDeclaration: inspectImport,
      ImportExpression: (node) => inspectReference(node, node.source),
      TSImportType(node) {
        inspectReference(node, typeSource(node));
        inspectContractType(node, node.qualifier);
      },
      ExportNamedDeclaration: inspectExport,
      ExportAllDeclaration(node) {
        inspectReference(node, node.source);
        rejectNonNamedExport(node);
      },
      ExportDefaultDeclaration: rejectNonNamedExport,
      TSTypeReference(node) {
        inspectContractType(node, node.typeName);
      },
      TSTypeQuery(node) {
        inspectContractType(node, node.exprName);
      },
      TSExpressionWithTypeArguments(node) {
        inspectContractType(node, node.expression);
      },
      TSInterfaceDeclaration(node) {
        if (entry === canvasContracts && node.id.name === 'CanvasHandle') {
          inspectDeclaredHandle(node);
        }
      },
      TSTypeAliasDeclaration(node) {
        if (entry === canvasContracts && node.id.name === 'CanvasHandle') {
          inspectDeclaredHandle(node);
        }
      },
      TSPropertySignature(node) {
        if (
          entry === canvasContracts &&
          nameOf(node.key) === 'ref' &&
          withoutSpaces(sourceCode, node.typeAnnotation?.typeAnnotation) !== 'Ref<CanvasHandle>'
        ) {
          context.report({ node, messageId: 'ref' });
        }
      },
      CallExpression(node) {
        if (
          contains(canvasRoot, file) &&
          reactHandleCall(sourceCode, node.callee) &&
          !handleFactoryMatches(node)
        ) {
          context.report({ node, messageId: 'handle' });
        }
      },
      'Program:exit'(node) {
        if (entry === canvasEntry && requiredExports.some((name) => !exports.has(name))) {
          context.report({ node, messageId: 'export' });
        }
      },
    };
  },
};

const moduleMocks = new Set(['mock', 'doMock', 'importMock']);

function importBinding(sourceCode, identifier) {
  if (identifier?.type !== 'Identifier') {
    return undefined;
  }

  const definition = bindingOf(sourceCode, identifier)?.defs[0];

  return definition?.type === 'ImportBinding' ? definition : undefined;
}

function runnerBinding(sourceCode, actor) {
  if (actor?.type === 'MemberExpression' && nameOf(actor.property) === 'vi') {
    const definition = importBinding(sourceCode, actor.object);

    return (
      definition?.node.type === 'ImportNamespaceSpecifier' &&
      definition.parent.source.value === 'vitest'
    );
  }
  if (actor?.type !== 'Identifier') {
    return false;
  }

  const definition = importBinding(sourceCode, actor);
  if (definition) {
    return definition.parent.source.value === 'vitest' && nameOf(definition.node.imported) === 'vi';
  }

  return actor.name === 'vi' && !bindingOf(sourceCode, actor)?.defs.length;
}

function isControlReference(file, source) {
  return (
    typeof source === 'string' &&
    [...referenceTargets(file, source), ...objectTargets(file, source)].some(
      (target) =>
        contains(canvasRoot, target) || contains(baseRoot, target) || contains(objectsRoot, target),
    )
  );
}

const noTestReplacement = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      replace: 'Exercise the real Canvas, Base and object modules in UI contract tests.',
    },
  },

  create(context) {
    const file = context.physicalFilename;
    const sourceCode = context.sourceCode;
    if (!suiteKind(file) && !objectTestFamily(file)) {
      return {};
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== 'MemberExpression' || !runnerBinding(sourceCode, callee.object)) {
          return;
        }

        const operation = nameOf(callee.property);
        const argument = node.arguments[0];
        if (operation === 'spyOn') {
          const definition = importBinding(sourceCode, argument);
          if (isControlReference(file, definition?.parent.source.value)) {
            context.report({ node, messageId: 'replace' });
          }
        }
        if (moduleMocks.has(operation)) {
          const source = argument?.type === 'ImportExpression' ? argument.source : argument;
          if (typeof source?.value !== 'string' || isControlReference(file, source.value)) {
            context.report({ node, messageId: 'replace' });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'luming-canvas' },
  rules: {
    'contract-boundary': contractBoundary,
    'no-test-replacement': noTestReplacement,
  },
};
