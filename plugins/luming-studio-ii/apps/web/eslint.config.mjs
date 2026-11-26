import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import studio from '../../../../tooling/studio-lint/script-plugin.mjs';
import { errorHandlingSyntax, scriptRules } from '../../../../tooling/studio-lint/script-rules.mjs';
import base from './lint/base-boundaries.mjs';
import { browserCapabilities } from './lint/browser-capabilities.mjs';
import canvas from './lint/canvas-boundaries.mjs';
import frontend from './lint/frontend-boundaries.mjs';
import objects from './lint/objects-boundaries.mjs';

const recommended = reactHooks.configs.flat.recommended;
const reactRules = Object.fromEntries(
  Object.entries(recommended.rules).map(([name, setting]) => {
    const [level, ...options] = Array.isArray(setting) ? setting : [setting];

    return [name, [level === 'warn' || level === 1 ? 'error' : level, ...options]];
  }),
);
const scripts = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const indirectImports = [
  { selector: 'TSImportEqualsDeclaration', message: 'Use an ES module import.' },
  {
    selector: 'CallExpression[callee.object.type="MetaProperty"][callee.property.name="glob"]',
    message: 'Use explicit imports so the UI contract boundary can be verified.',
  },
];
const baseGlobals = browserCapabilities.map((name) => ({
  name,
  message: 'Use a Surface or platform port for I/O.',
}));
const canvasGlobals = [
  ...baseGlobals,
  'navigator',
  'caches',
  'cookieStore',
  'WebTransport',
  'BroadcastChannel',
  'RTCPeerConnection',
  'openai',
].map((entry) =>
  typeof entry === 'string'
    ? { name: entry, message: 'Use a Surface or platform port for I/O.' }
    : entry,
);
const applicationGlobals = [
  ...canvasGlobals,
  ...[
    'Buffer',
    'FileReader',
    'FileReaderSync',
    'crypto',
    'globalThis',
    'process',
    'self',
    'showDirectoryPicker',
    'showOpenFilePicker',
    'showSaveFilePicker',
    'window',
  ].map((name) => ({
    name,
    message: 'Inject this host capability from the platform layer.',
  })),
];
const archiveReadMethods = '/^(arrayBuffer|bytes|stream|text)$/';
const archiveReads = [
  {
    selector: `MemberExpression:matches([property.name=${archiveReadMethods}], [property.value=${archiveReadMethods}])`,
    message: 'Pass the archive body to the platform upload capability.',
  },
  {
    selector: `ObjectPattern > Property:matches([key.name=${archiveReadMethods}], [key.value=${archiveReadMethods}])`,
    message: 'Pass the archive body to the platform upload capability.',
  },
];
const moduleMockNames = '/^(mock|doMock|importMock|spyOn|stubGlobal)$/';
const applicationMockSyntax = [
  {
    selector:
      'ImportDeclaration[source.value="vitest"] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier, ImportSpecifier[imported.name="vi"])',
    message: 'Mount the real application and inject the test ports.',
  },
  {
    selector:
      'ImportDeclaration[source.value=/^(node:)?test$/] > :matches(ImportNamespaceSpecifier, ImportSpecifier[imported.name="mock"])',
    message: 'Mount the real application and inject the test ports.',
  },
  {
    selector: `MemberExpression:matches([property.name=${moduleMockNames}], [property.value=${moduleMockNames}])`,
    message: 'Inject test ports in AppMock instead of replacing runtime modules.',
  },
  {
    selector: `ObjectPattern > Property:matches([key.name=${moduleMockNames}], [key.value=${moduleMockNames}])`,
    message: 'Inject test ports in AppMock instead of replacing runtime modules.',
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
    files: ['**/*.{jsx,tsx}'],
    languageOptions: {
      parserOptions: { babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } } },
    },
    extends: [recommended],
    rules: reactRules,
  },
  {
    files: ['src/' + scripts, 'tests/' + scripts],
    plugins: { base, canvas, frontend, objects },
    rules: {
      'base/contract-boundary': 'error',
      'canvas/contract-boundary': 'error',
      'frontend/contract-boundary': 'error',
      'objects/contract-boundary': 'error',
      'no-restricted-globals': ['error', { globals: ['require'], checkGlobalObject: true }],
      'no-restricted-syntax': ['error', ...errorHandlingSyntax, ...indirectImports],
    },
  },
  {
    files: ['src/ui/base/' + scripts],
    rules: {
      'no-restricted-globals': ['error', 'require', ...baseGlobals],
      'base/no-browser-io': 'error',
      'studio/no-stringified-comparison': 'error',
      'no-restricted-syntax': [
        'error',
        ...errorHandlingSyntax,
        ...indirectImports,
        {
          selector: 'JSXOpeningElement[name.name=/^[a-z]/] > JSXSpreadAttribute',
          message: 'Map the declared capabilities explicitly when rendering native elements.',
        },
      ],
    },
  },
  {
    files: ['src/ui/domain/canvas/' + scripts],
    rules: {
      'no-restricted-globals': [
        'error',
        { globals: ['require', ...canvasGlobals], checkGlobalObject: true },
      ],
      'base/no-browser-io': 'error',
    },
  },
  {
    files: ['src/ui/domain/objects/' + scripts],
    rules: {
      'no-restricted-globals': [
        'error',
        { globals: ['require', ...canvasGlobals], checkGlobalObject: true },
      ],
      'base/no-browser-io': 'error',
    },
  },
  {
    files: ['src/ui/domain/objects/embed/' + scripts],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: ['require', ...canvasGlobals.filter(({ name }) => name !== 'postMessage')],
          checkGlobalObject: true,
        },
      ],
      'base/no-browser-io': ['error', { frameMessaging: true }],
    },
  },
  {
    files: ['tests/' + scripts],
    rules: {
      'max-nested-callbacks': ['error', 5],
      'base/test-contract': 'error',
      'canvas/no-test-replacement': 'error',
    },
  },
  {
    files: ['app', 'pages', 'surfaces', 'data'].map((layer) => 'src/' + layer + '/' + scripts),
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': [
        'error',
        { globals: ['require', ...applicationGlobals], checkGlobalObject: true },
      ],
      'base/no-browser-io': 'error',
    },
  },
  {
    files: ['src/data/' + scripts],
    rules: {
      'no-restricted-globals': [
        'error',
        { globals: ['require', 'document', ...applicationGlobals], checkGlobalObject: true },
      ],
    },
  },
  {
    files: [
      'src/app/workflows/archive-import/' + scripts,
      'src/surfaces/workbench/' + scripts,
      'src/data/archive-import/' + scripts,
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...errorHandlingSyntax,
        ...indirectImports,
        ...archiveReads,
      ],
    },
  },
  {
    files: ['src/platform/' + scripts],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': [
        'error',
        { globals: ['require', 'Buffer', 'process'], checkGlobalObject: true },
      ],
    },
  },
  {
    files: ['tests/integration/' + scripts, 'tests/support/' + scripts],
    rules: {
      'no-restricted-globals': ['error', { globals: ['require', 'vi'], checkGlobalObject: true }],
      'no-restricted-syntax': [
        'error',
        ...errorHandlingSyntax,
        ...indirectImports,
        ...applicationMockSyntax,
      ],
    },
  },
]);
