import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import studio from '../../../../tooling/studio-lint/script-plugin.mjs';
import { errorHandlingSyntax, scriptRules } from '../../../../tooling/studio-lint/script-rules.mjs';
import server from './lint/server-boundaries.mjs';

const scripts = '**/*.{ts,mts,cts,js,mjs,cjs}';
const indirectImports = [
  { selector: 'TSImportEqualsDeclaration', message: 'Use an ES module import.' },
  {
    selector: 'CallExpression[callee.object.type="MetaProperty"][callee.property.name="glob"]',
    message: 'Use explicit imports so the server boundary can be verified.',
  },
  {
    selector:
      'MemberExpression:matches([property.name="getBuiltinModule"], [property.value="getBuiltinModule"])',
    message: 'Import the builtin explicitly from its declared owner.',
  },
];
const pureGlobals = [
  'Buffer',
  'BroadcastChannel',
  'Date',
  'EventSource',
  'WebSocket',
  'XMLHttpRequest',
  'console',
  'crypto',
  'fetch',
  'global',
  'globalThis',
  'performance',
  'process',
  'self',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'window',
].map((name) => ({ name, message: 'Use a declared server port for host capabilities.' }));
const runtimeMockSyntax = [
  {
    selector:
      'ImportDeclaration[source.value="vitest"] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier, ImportSpecifier[imported.name="vi"])',
    message: 'Exercise the real application and SQLite adapters in this suite.',
  },
  {
    selector:
      'ImportDeclaration[source.value=/^(node:)?test$/] > :matches(ImportNamespaceSpecifier, ImportSpecifier[imported.name="mock"])',
    message: 'Exercise the real application and SQLite adapters in this suite.',
  },
  {
    selector:
      'MemberExpression:matches([property.name=/^(mock|doMock|spyOn|stubGlobal)$/], [property.value=/^(mock|doMock|spyOn|stubGlobal)$/])',
    message: 'Keep the production service and SQLite adapters active in this suite.',
  },
  {
    selector: 'ObjectPattern > Property:matches([key.name="mock"], [key.value="mock"])',
    message: 'Keep the production service and SQLite adapters active in this suite.',
  },
];

export default defineConfig([
  {
    files: [scripts],
    plugins: { studio, '@stylistic': stylistic },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['typescript'] },
        },
      },
    },
    linterOptions: { noInlineConfig: true },
    rules: scriptRules,
  },
  {
    files: ['src/' + scripts, 'tests/' + scripts],
    plugins: { server },
    rules: {
      'server/contract-boundary': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': ['error', { globals: ['require'], checkGlobalObject: true }],
      'no-restricted-syntax': ['error', ...errorHandlingSyntax, ...indirectImports],
    },
  },
  {
    files: [
      'src/modules/whiteboard/application/' + scripts,
      'src/modules/whiteboard/domain/' + scripts,
      'src/modules/whiteboard/ports/' + scripts,
      'src/modules/catalog/application/' + scripts,
      'src/modules/catalog/domain/' + scripts,
      'src/modules/catalog/ports/' + scripts,
      'src/application/workflows/' + scripts,
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { globals: ['require', ...pureGlobals], checkGlobalObject: true },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Provide randomness through a server port.',
        },
      ],
    },
  },
  {
    files: ['tests/' + scripts],
    rules: { 'max-nested-callbacks': ['error', 5] },
  },
  {
    files: [
      'tests/integration/' + scripts,
      'tests/support/' + scripts,
      'tests/fixtures/' + scripts,
    ],
    rules: {
      'no-restricted-globals': ['error', { globals: ['require', 'vi'], checkGlobalObject: true }],
      'no-restricted-syntax': [
        'error',
        ...errorHandlingSyntax,
        ...indirectImports,
        ...runtimeMockSyntax,
      ],
    },
  },
]);
