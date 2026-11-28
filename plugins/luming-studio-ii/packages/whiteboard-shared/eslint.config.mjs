import babelParser from '@babel/eslint-parser';
import localReference from './lint/local-reference.mjs';

const runtimeImports =
  ':matches(ImportExpression, CallExpression[callee.type="Import"], TSImportEqualsDeclaration, MetaProperty[meta.name="import"])';
const ambientDeclarations =
  ':matches(DeclareVariable, TSDeclareFunction, TSModuleDeclaration, [declare=true])';
const runtimeGlobals = [
  'globalThis',
  'global',
  'window',
  'document',
  'self',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'postMessage',
  'Worker',
  'process',
  'require',
  'module',
  'exports',
  'Buffer',
  'Deno',
  'Bun',
  'console',
  'crypto',
  'performance',
  'queueMicrotask',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'Date',
  'Atomics',
  'SharedArrayBuffer',
];

export default [
  {
    files: ['src/**/*.{js,cjs,mjs,ts,cts,mts,jsx,tsx}'],
    plugins: { shared: { rules: { 'local-reference': localReference } } },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          configFile: false,
          babelrc: false,
          parserOpts: { plugins: ['typescript'] },
        },
      },
    },
    linterOptions: { noInlineConfig: true },
    rules: {
      'shared/local-reference': 'error',
      'no-restricted-globals': ['error', ...runtimeGlobals],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: runtimeImports,
          message: 'Use a static relative import for other shared modules.',
        },
        {
          selector: ambientDeclarations,
          message: 'Declare shared inputs as local types and parameters.',
        },
      ],
      'no-warning-comments': [
        'error',
        {
          terms: ['<reference', '<amd-module', '<amd-dependency'],
          location: 'start',
          decoration: ['/'],
        },
      ],
    },
  },
];
