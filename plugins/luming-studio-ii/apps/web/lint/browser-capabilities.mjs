import { bindingOf } from './scope.mjs';

export const browserCapabilities = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'postMessage',
];

const browserGlobals = new Set(['globalThis', 'window', 'self']);
const restrictedMembers = new Map([
  ['window', new Set([...browserCapabilities, 'parent', 'top'])],
  ['navigator', new Set(['clipboard'])],
  ['document', new Set(['cookie'])],
]);

function propertyName(property, computed) {
  return computed || property.type === 'Literal' ? property.value : property.name;
}

function identifierObject(sourceCode, identifier, visited) {
  const binding = bindingOf(sourceCode, identifier);
  if (!binding?.defs.length) {
    return identifier.name;
  }

  const definition = binding.defs[0];
  if (visited.has(binding) || binding.defs.length !== 1) {
    return undefined;
  }
  if (definition.type !== 'Variable' || definition.parent.kind !== 'const') {
    return undefined;
  }
  if (definition.node.id.type !== 'Identifier') {
    return undefined;
  }

  visited.add(binding);

  return browserObject(sourceCode, definition.node.init, visited);
}

function browserObject(sourceCode, expression, visited = new Set()) {
  if (expression?.type === 'Identifier') {
    return identifierObject(sourceCode, expression, visited);
  }
  if (expression?.type !== 'MemberExpression') {
    return undefined;
  }

  const parent = browserObject(sourceCode, expression.object, visited);
  const property = propertyName(expression.property, expression.computed);
  if (browserGlobals.has(parent)) {
    return property;
  }
  if (property === 'ownerDocument') {
    return 'document';
  }
  if (parent === 'document' && property === 'defaultView') {
    return 'window';
  }

  return undefined;
}

const noBrowserIo = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { capability: 'Use a Surface or platform port for {{name}}.' },
  },

  create(context) {
    function reportCapability(node, target, name) {
      const group = browserGlobals.has(target) ? 'window' : target;

      if (restrictedMembers.get(group)?.has(name)) {
        context.report({ node, messageId: 'capability', data: { name } });
      }
    }

    function checkPattern(pattern, source) {
      if (pattern.type !== 'ObjectPattern') {
        return;
      }

      const object = browserObject(context.sourceCode, source);
      for (const property of pattern.properties) {
        if (property.type === 'Property') {
          const name = propertyName(property.key, property.computed);

          reportCapability(property, object, name);
        }
      }
    }

    return {
      MemberExpression(node) {
        const object = browserObject(context.sourceCode, node.object);
        reportCapability(node, object, propertyName(node.property, node.computed));
      },
      VariableDeclarator(node) {
        checkPattern(node.id, node.init);
      },
      AssignmentExpression(node) {
        checkPattern(node.left, node.right);
      },
    };
  },
};

export default noBrowserIo;
