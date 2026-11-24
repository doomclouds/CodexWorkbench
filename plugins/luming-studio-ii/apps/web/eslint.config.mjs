import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import studio from '../../../../tooling/studio-lint/script-plugin.mjs';
import { errorHandlingSyntax, scriptRules } from '../../../../tooling/studio-lint/script-rules.mjs';
import base from './lint/base-boundaries.mjs';
import { browserCapabilities } from './lint/browser-capabilities.mjs';

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
    plugins: { base },
    rules: {
      'base/contract-boundary': 'error',
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
    },
  },
  {
    files: ['tests/' + scripts],
    rules: {
      'max-nested-callbacks': ['error', 5],
      'no-restricted-syntax': [
        'error',
        ...errorHandlingSyntax,
        ...indirectImports,
        {
          selector:
            'MemberExpression[object.name=/^(test|it|describe)$/][property.name=/^(only|skip|todo)$/]',
          message: 'Run every declared contract test.',
        },
      ],
    },
  },
]);
