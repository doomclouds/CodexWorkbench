const pascalCase = /^[A-Z][A-Za-z0-9]*$/u;
const hookName = /^use[A-Z][A-Za-z0-9]*$/u;
const eventName = /^on[A-Z][A-Za-z0-9]*$/u;
const handlerName = /^handle[A-Z][A-Za-z0-9]*$/u;
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const branchingStatements = new Set([
  'IfStatement',
  'SwitchStatement',
  'TryStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);
const lowercaseDomEvents = new Set([
  'onblur',
  'onchange',
  'onclick',
  'oncontextmenu',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragover',
  'ondragstart',
  'ondrop',
  'onerror',
  'onfocus',
  'oninput',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onload',
  'onmousedown',
  'onmousemove',
  'onmouseup',
  'onpointerdown',
  'onpointermove',
  'onpointerup',
  'onscroll',
  'onsubmit',
  'onwheel',
]);

function bindingDefinition(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const binding = scope.set.get(name);
    if (binding) {
      return binding.defs.length === 1 ? binding.defs[0] : undefined;
    }
  }
}

function reactImport(sourceCode, node) {
  if (node?.type !== 'Identifier') {
    return;
  }

  const binding = bindingDefinition(sourceCode, node, node.name);
  return binding?.parent?.source?.value === 'react' ? binding.node : undefined;
}

function reactMember(sourceCode, node) {
  if (node?.type === 'Identifier') {
    return reactImport(sourceCode, node)?.imported?.name;
  }

  if (node?.type === 'MemberExpression' || node?.type === 'TSQualifiedName') {
    const qualifier = node.object ?? node.left;
    const property = node.property ?? node.right;
    const binding = reactImport(sourceCode, qualifier);
    if (
      !node.computed &&
      ['ImportNamespaceSpecifier', 'ImportDefaultSpecifier'].includes(binding?.type)
    ) {
      return property.name;
    }
  }
}

function localFunction(sourceCode, node) {
  if (node?.type !== 'Identifier' && node?.type !== 'JSXIdentifier') {
    return;
  }

  const definition = bindingDefinition(sourceCode, node, node.name);
  if (definition?.type !== 'FunctionName' && definition?.type !== 'Variable') {
    return;
  }

  const declaration = definition.node;
  let value = declaration.type === 'VariableDeclarator' ? declaration.init : declaration;
  if (value?.type === 'CallExpression' && reactMember(sourceCode, value.callee) === 'useCallback') {
    value = value.arguments[0];
  }
  if (functions.has(value?.type)) {
    return { value, name: declaration.id };
  }
}

function declarationName(node) {
  if (node.parent.type === 'VariableDeclarator') {
    return node.parent.id;
  }

  return node.id;
}

function looksLikeEvent(name) {
  return /^on[A-Z0-9_]/u.test(name) || lowercaseDomEvents.has(name);
}

function declarationIsAmbient(node, sourceCode) {
  return (
    node.declare ||
    sourceCode
      .getAncestors(node)
      .some(
        (ancestor) =>
          ancestor.type === 'TSModuleDeclaration' && (ancestor.declare || ancestor.global),
      )
  );
}

function componentType(sourceCode, node) {
  const annotation = node.id.typeAnnotation?.typeAnnotation;
  return (
    annotation?.type === 'TSTypeReference' &&
    ['FC', 'FunctionComponent', 'ComponentType'].includes(
      reactMember(sourceCode, annotation.typeName),
    )
  );
}

const roleNaming = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      type: 'Name TypeScript types in PascalCase. Rename {{name}} to an intention-revealing type name.',
      component: 'Name this React component in PascalCase.',
      hook: 'Name this custom Hook with a useX name.',
      event: 'Name this React event prop with an onX name.',
      handler: 'Name this multi-action JSX event handler with a handleX name.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const returnedJsx = new Set();
    const usedAsComponent = new Map();
    const defaultViews = new Map();
    const directHooks = new Set();
    const components = new Map();
    const handlers = new Map();

    function reportName(node, pattern, role) {
      if (node?.name && !pattern.test(node.name)) {
        context.report({ node, messageId: role, data: { name: node.name } });
      }
    }

    function recordJsx(node) {
      let value = node;
      while (
        [
          'ConditionalExpression',
          'LogicalExpression',
          'TSAsExpression',
          'TSNonNullExpression',
        ].includes(value.parent.type)
      ) {
        value = value.parent;
      }
      if (value.parent.type === 'ReturnStatement') {
        const owner = sourceCode
          .getAncestors(value)
          .findLast((ancestor) => functions.has(ancestor.type));

        if (owner) {
          returnedJsx.add(owner);
        }
      } else if (value.parent.type === 'ArrowFunctionExpression' && value.parent.body === value) {
        returnedJsx.add(value.parent);
      }
    }

    function validateType(node) {
      if (!declarationIsAmbient(node, sourceCode)) {
        reportName(node.id, pascalCase, 'type');
      }
    }

    function propSignature(node) {
      const owner = node.parent.parent;
      const key = node.key;
      if (!owner?.id?.name?.endsWith('Props') || key.type !== 'Identifier' || node.computed) {
        return;
      }

      const type = node.typeAnnotation?.typeAnnotation;
      const reactType =
        type?.type === 'TSTypeReference' ? reactMember(sourceCode, type.typeName) : undefined;
      const eventType = reactType?.endsWith('EventHandler');
      const callable = node.type === 'TSMethodSignature' || type?.type === 'TSFunctionType';
      if (eventType || (callable && looksLikeEvent(key.name))) {
        reportName(key, eventName, 'event');
      }
    }

    return {
      TSTypeAliasDeclaration: validateType,
      TSInterfaceDeclaration: validateType,
      TSEnumDeclaration: validateType,
      TSPropertySignature: propSignature,
      TSMethodSignature: propSignature,
      JSXElement: recordJsx,
      JSXFragment: recordJsx,
      JSXOpeningElement(node) {
        const target = localFunction(sourceCode, node.name);
        if (target) {
          usedAsComponent.set(target.value, target.name);
        }
      },
      ExportDefaultDeclaration(node) {
        const target = localFunction(sourceCode, node.declaration);
        if (target) {
          defaultViews.set(target.value, target.name);
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !looksLikeEvent(node.name.name)) {
          return;
        }

        reportName(node.name, eventName, 'event');
        const target = localFunction(sourceCode, node.value?.expression);
        const body = target?.value.body;
        if (!body) {
          return;
        }

        const isComplexBlock =
          body.type === 'BlockStatement' &&
          (body.body.length > 1 ||
            body.body.some((statement) => branchingStatements.has(statement.type)));

        if (body.type === 'ConditionalExpression' || isComplexBlock) {
          handlers.set(target.value, target.name);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') {
          return;
        }

        if (componentType(sourceCode, node)) {
          components.set(node.init ?? node, node.id);
        }
        if (
          node.init?.type === 'CallExpression' &&
          ['memo', 'forwardRef'].includes(reactMember(sourceCode, node.init.callee))
        ) {
          components.set(node.init, node.id);
        }
      },
      ClassDeclaration(node) {
        if (['Component', 'PureComponent'].includes(reactMember(sourceCode, node.superClass))) {
          components.set(node, node.id);
        }
      },
      CallExpression(node) {
        const name = reactMember(sourceCode, node.callee);
        if (!name || !hookName.test(name)) {
          return;
        }

        const owner = sourceCode
          .getAncestors(node)
          .findLast((ancestor) => functions.has(ancestor.type));

        if (owner) {
          directHooks.add(owner);
        }
      },
      'Program:exit'() {
        for (const fn of returnedJsx) {
          const identifier = usedAsComponent.get(fn) ?? defaultViews.get(fn);
          if (identifier) {
            components.set(fn, identifier);
          }
          if (fn.parent.type === 'ExportDefaultDeclaration') {
            components.set(fn, fn.id);
          }
        }
        for (const [view, name] of components) {
          if (name) {
            reportName(name, pascalCase, 'component');
          } else {
            context.report({ node: view, messageId: 'component' });
          }
        }
        for (const fn of directHooks) {
          const name = declarationName(fn);
          if (!returnedJsx.has(fn) && !components.has(fn) && !pascalCase.test(name?.name ?? '')) {
            reportName(name, hookName, 'hook');
          }
        }
        for (const [fn, name] of handlers) {
          if (!components.has(fn)) {
            reportName(name, handlerName, 'handler');
          }
        }
      },
    };
  },
};

const noSourceComments = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      comment:
        'Express this in code, tests, or documentation. Studio source comments are prohibited.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
};

const readableCondition = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { max: { type: 'integer', minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyOperators:
        'This condition uses {{count}} logical operators. Use at most {{max}} and name the underlying predicates.',
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 2;
    const { visitorKeys } = context.sourceCode;
    function operators(node) {
      if (!node || functions.has(node.type)) {
        return 0;
      }
      if (node.type === 'ConditionalExpression') {
        return operators(node.consequent) + operators(node.alternate);
      }

      let count = node.type === 'LogicalExpression' && ['&&', '||'].includes(node.operator) ? 1 : 0;
      for (const key of visitorKeys[node.type] ?? []) {
        const child = node[key];
        if (Array.isArray(child)) {
          for (const entry of child) {
            count += operators(entry);
          }
        } else {
          count += operators(child);
        }
      }
      return count;
    }

    return {
      'IfStatement, WhileStatement, DoWhileStatement, ForStatement, ConditionalExpression'(node) {
        const count = operators(node.test);
        if (count > max) {
          context.report({ node: node.test, messageId: 'tooManyOperators', data: { count, max } });
        }
      },
    };
  },
};

const composedTypes = new Set([
  'TSArrayType',
  'TSConditionalType',
  'TSConstructorType',
  'TSFunctionType',
  'TSIndexedAccessType',
  'TSIntersectionType',
  'TSMappedType',
  'TSTupleType',
  'TSTypeLiteral',
  'TSUnionType',
]);

const typeComplexity = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { maxDepth: { type: 'integer', minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooDeep:
        'This type is nested {{depth}} levels. Name an inner type to keep the depth at {{maxDepth}} or less.',
    },
  },
  create(context) {
    const maxDepth = context.options[0]?.maxDepth ?? 3;
    const covered = new WeakSet();
    const { visitorKeys } = context.sourceCode;

    function typeDepth(node) {
      if (!node) {
        return 0;
      }

      covered.add(node);
      const generic = node.type === 'TSTypeReference' || node.type === 'TSImportType';
      const argumentsCount = (node.typeArguments ?? node.typeParameters)?.params.length ?? 0;
      const layer = composedTypes.has(node.type) || (generic && argumentsCount > 0) ? 1 : 0;
      let deepest = 0;
      for (const key of visitorKeys[node.type] ?? []) {
        const children = Array.isArray(node[key]) ? node[key] : [node[key]];
        for (const child of children) {
          deepest = Math.max(deepest, typeDepth(child));
        }
      }
      return layer + deepest;
    }

    return {
      [[...composedTypes, 'TSTypeReference', 'TSImportType'].join(', ')](node) {
        if (covered.has(node)) {
          return;
        }

        const depth = typeDepth(node);
        if (depth > maxDepth) {
          context.report({ node, messageId: 'tooDeep', data: { depth, maxDepth } });
        }
      },
    };
  },
};

const comparisonOperators = new Set(['===', '!==', '==', '!=']);

function callsGlobalJsonStringify(sourceCode, node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') {
    return false;
  }

  const { object, property, computed } = node.callee;
  const method = computed ? property.value : property.name;
  return (
    object.type === 'Identifier' &&
    object.name === 'JSON' &&
    method === 'stringify' &&
    !bindingDefinition(sourceCode, object, 'JSON')
  );
}

const noStringifiedComparison = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      compareValues: 'Compare values structurally. JSON serialization depends on object key order.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!comparisonOperators.has(node.operator)) {
          return;
        }

        if (
          callsGlobalJsonStringify(context.sourceCode, node.left) &&
          callsGlobalJsonStringify(context.sourceCode, node.right)
        ) {
          context.report({ node, messageId: 'compareValues' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'studio-lint' },
  rules: {
    'role-naming': roleNaming,
    'no-source-comments': noSourceComments,
    'readable-condition': readableCondition,
    'type-complexity': typeComplexity,
    'no-stringified-comparison': noStringifiedComparison,
  },
};
