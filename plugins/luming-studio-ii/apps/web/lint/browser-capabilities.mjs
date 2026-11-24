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

function localBinding(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      return variable.defs.length > 0;
    }

    scope = scope.upper;
  }

  return false;
}

function browserObject(sourceCode, expression) {
  if (expression?.type === 'Identifier' && !localBinding(sourceCode, expression)) {
    return expression.name;
  }
  if (expression?.type !== 'MemberExpression') {
    return undefined;
  }

  const parent = browserObject(sourceCode, expression.object);
  if (browserGlobals.has(parent)) {
    return propertyName(expression.property, expression.computed);
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
