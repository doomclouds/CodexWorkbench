import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import { builtinModules } from 'node:module';
import { errorHandlingSyntax, scriptRules } from '../../tooling/studio-lint/script-rules.mjs';
import studio from './lint/studio-rules.mjs';

export const lintDirectories = ['src', 'tests'];
export const scriptExtensions = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];
const scripts = `*.{${scriptExtensions.join(',')}}`;

const recommended = reactHooks.configs.flat.recommended;
const reactRules = Object.fromEntries(Object.entries(recommended.rules).map(([name, configured]) => {
  const [level, ...options] = Array.isArray(configured) ? configured : [configured];
  return [name, [level === 'warn' || level === 1 ? 'error' : level, ...options]];
}));
const inlineEvent = 'JSXAttribute[name.name=/^on[A-Z]/] > JSXExpressionContainer > :matches(ArrowFunctionExpression, FunctionExpression)';
const eventControlFlow = 'IfStatement, SwitchStatement, TryStatement, ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement, ConditionalExpression';
const inlineEventMessage = 'Extract multi-step or conditional event logic into a named handler.';
const backendImportMessage = 'Access Studio services through the frontend client and shared contracts.';
const relativeImport = '^(?:\\.{1,2}/)+';
const frontendRestrictedPaths = builtinModules.map(name => ({ name, message: backendImportMessage }));
const frontendRestrictedPatterns = [
  { regex: `^node:|${relativeImport}server(?:/|$)`, message: backendImportMessage },
];
const views = [
  'src/app/pages/editor/StudioEditorView.tsx',
  'src/app/pages/library/StudioLibraryView.tsx',
];
const shellBoundary = {
  regex: '(?:^|/)(?:StudioApp|StudioEditorView|StudioLibraryView)(?:\\.[jt]sx?)?$',
  message: 'Receive shell data and actions through the view props. Compose the views in StudioApp.',
};
const commonScriptConfig = {
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
    rules: {
      ...scriptRules,
      'preserve-caught-error': ['error', {
        requireCatchParameter: true,
        errorClassNames: [
          { name: 'StudioError', argumentPosition: 4 },
          { name: 'ExportError', argumentPosition: 3 },
        ],
      }],
    },
};

const jsxParserOptions = {
  parserOptions: { babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } } },
};

export const toolingLintConfig = defineConfig([
  {
    ...commonScriptConfig,
    files: [`tooling/**/${scripts}`, `plugins/luming-studio/benchmarks/**/${scripts}`],
    rules: {
      ...commonScriptConfig.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'all', ignoreRestSiblings: true }],
    },
  },
  {
    files: [`tooling/**/*.test.{${scriptExtensions.join(',')}}`],
    rules: { 'max-nested-callbacks': ['error', 5] },
  },
  {
    files: ['tooling/**/*.{tsx,jsx}'],
    languageOptions: jsxParserOptions,
  },
]);

export default defineConfig([
  {
    ...commonScriptConfig,
    files: lintDirectories.map(directory => `${directory}/**/${scripts}`),
    extends: [recommended],
    rules: { ...commonScriptConfig.rules, ...reactRules },
  },
  {
    files: lintDirectories.map(directory => `${directory}/**/*.{tsx,jsx}`),
    languageOptions: jsxParserOptions,
  },
  {
    files: [`src/**/${scripts}`],
    rules: { 'studio/managed-tool-names': 'error' },
  },
  {
    files: [`src/app/**/${scripts}`],
    rules: {
      'no-restricted-imports': ['error', {
        paths: frontendRestrictedPaths,
        patterns: frontendRestrictedPatterns,
      }],
    },
  },
  {
    files: views,
    rules: {
      'no-restricted-imports': ['error', {
        paths: frontendRestrictedPaths,
        patterns: [...frontendRestrictedPatterns, shellBoundary],
      }],
    },
  },
  {
    files: [`src/contracts/**/${scripts}`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: `${relativeImport}(?:app|core|server)(?:/|$)`,
          message: 'Define shared contracts independently of their UI, service and transport consumers.',
        }],
      }],
    },
  },
  {
    files: [`src/core/**/${scripts}`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: `${relativeImport}(?:app|server)(?:/|$)`,
          message: 'Keep core operations independent of UI and transport adapters.',
        }],
      }],
    },
  },
  {
    files: [`src/app/features/whiteboard/canvas/**/${scripts}`],
    rules: { 'studio/no-stringified-comparison': 'error' },
  },
  {
    files: [`tests/**/${scripts}`],
    rules: { 'max-nested-callbacks': ['error', 5] },
  },
  {
    files: ['src/app/**/*.{tsx,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...errorHandlingSyntax,
        { selector: `${inlineEvent} > BlockStatement[body.length>1]`, message: inlineEventMessage },
        { selector: `${inlineEvent} :matches(${eventControlFlow})`, message: inlineEventMessage },
      ],
    },
  },
]);
