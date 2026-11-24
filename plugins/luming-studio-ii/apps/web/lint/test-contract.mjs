import { dirname, resolve } from 'node:path';
import { aliasTargets, baseRoot, contains, publicSpecifier } from './project-paths.mjs';
import { bindingOf } from './scope.mjs';

const testNames = new Set(['describe', 'it', 'test']);
const testSources = new Set(['vitest', 'node:test']);
const hiddenModes = new Set(['only', 'skip', 'skipIf', 'runIf', 'todo', 'fails']);
const moduleMocks = new Set(['mock', 'doMock', 'importMock']);

function nameOf(node) {
  return node?.name ?? node?.value;
}

function matchesBase(file, source) {
  if (source === publicSpecifier) {
    return true;
  }
  if (typeof source !== 'string') {
    return false;
  }
  if (source.startsWith('.')) {
    return contains(baseRoot, resolve(dirname(file), source));
  }

  return aliasTargets(source).some((target) => contains(baseRoot, target));
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      mocks: 'Observe the real control through its public contract.',
      mode: 'Run every declared contract test.',
      literal: 'Use a literal module path so the test boundary can be checked.',
    },
  },

  create(context) {
    const testAliases = new Set(testNames);
    const runnerNamespaces = new Set();
    const mockAliases = new Set(['vi']);
    const controlNamespaces = new Set();

    function isRunnerBinding(node, aliases) {
      if (!aliases.has(node?.name)) {
        return false;
      }

      const definition = bindingOf(context.sourceCode, node)?.defs[0];
      if (!definition) {
        return true;
      }

      return definition.type === 'ImportBinding' && testSources.has(definition.parent.source.value);
    }

    function fromRunnerNamespace(node) {
      return node?.type === 'MemberExpression' && isRunnerBinding(node.object, runnerNamespaces);
    }

    function inspectRunnerImport(node) {
      for (const specifier of node.specifiers) {
        const imported = nameOf(specifier.imported);
        const local = specifier.local.name;
        if (testNames.has(imported) || specifier.type === 'ImportDefaultSpecifier') {
          testAliases.add(local);
        }
        if (specifier.type === 'ImportNamespaceSpecifier') {
          runnerNamespaces.add(local);
        }
        if (imported === 'vi') {
          mockAliases.add(local);
        }
      }
    }

    function inspectImport(node) {
      const source = node.source.value;
      if (testSources.has(source)) {
        inspectRunnerImport(node);
      }
      if (!matchesBase(context.physicalFilename, source)) {
        return;
      }

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          controlNamespaces.add(specifier.local.name);
        }
      }
    }

    function inspectTestMode(node) {
      if (!hiddenModes.has(nameOf(node.property))) {
        return;
      }

      const runner = node.object;
      const namespaceRunner = fromRunnerNamespace(runner) && testNames.has(nameOf(runner.property));

      if (isRunnerBinding(runner, testAliases) || namespaceRunner) {
        context.report({ node, messageId: 'mode' });
      }
    }

    function inspectMock(node) {
      const actor = node.callee.object;
      const namespaced = fromRunnerNamespace(actor) && nameOf(actor.property) === 'vi';

      if (!isRunnerBinding(actor, mockAliases) && !namespaced) {
        return;
      }

      const operation = nameOf(node.callee.property);
      const argument = node.arguments[0];
      if (operation === 'spyOn' && controlNamespaces.has(argument?.name)) {
        context.report({ node, messageId: 'mocks' });
        return;
      }
      if (!moduleMocks.has(operation)) {
        return;
      }

      const source = argument?.type === 'ImportExpression' ? argument.source : argument;
      if (typeof source?.value !== 'string') {
        context.report({ node, messageId: 'literal' });
        return;
      }
      if (matchesBase(context.physicalFilename, source.value)) {
        context.report({ node, messageId: 'mocks' });
      }
    }

    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type === 'ImportDeclaration') {
            inspectImport(statement);
          }
        }
      },
      MemberExpression: inspectTestMode,
      CallExpression: inspectMock,
    };
  },
};
