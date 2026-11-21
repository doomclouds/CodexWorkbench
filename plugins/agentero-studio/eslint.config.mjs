import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import { builtinModules } from 'node:module';
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
const views = ['src/app/StudioEditorView.tsx', 'src/app/StudioLibraryView.tsx'];
const shellBoundary = {
  regex: '(?:^|/)(?:StudioApp|StudioEditorView|StudioLibraryView)(?:\\.[jt]sx?)?$',
  message: 'Receive shell data and actions through the view props. Compose the views in StudioApp.',
};
const rejectionHandler = ':matches(CallExpression[callee.property.name="catch"] > .arguments, CallExpression[callee.property.name="then"] > .arguments:nth-child(2)):matches(ArrowFunctionExpression, FunctionExpression)';
const handlingMessage = 'Use the caught error to handle an expected case, report it, or propagate it.';
const errorHandlingSyntax = [
  { selector: 'CatchClause[param=null]', message: handlingMessage },
  { selector: `${rejectionHandler}[params.length=0]`, message: handlingMessage },
  { selector: `${rejectionHandler} > BlockStatement[body.length=0]`, message: handlingMessage },
];
const guard = {
  selector: 'IfStatement:not([alternate.type])[consequent.body.length=1][consequent.body.0.type=/^(ReturnStatement|ThrowStatement|ContinueStatement|BreakStatement)$/]',
};
const moduleType = {
  selector: ':matches(Program > :matches(TSTypeAliasDeclaration, TSInterfaceDeclaration, TSEnumDeclaration), Program > ExportNamedDeclaration[declaration.type=/^(TSTypeAliasDeclaration|TSInterfaceDeclaration|TSEnumDeclaration)$/])',
};
const moduleRoutine = {
  selector: ':matches(Program > :matches(FunctionDeclaration, ClassDeclaration), Program > :matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type=/^(FunctionDeclaration|ClassDeclaration|ArrowFunctionExpression)$/])',
};

export default defineConfig([
  {
    files: lintDirectories.map(directory => `${directory}/**/${scripts}`),
    extends: [recommended],
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
      ...reactRules,
      'one-var': ['error', 'never'],
      'prefer-const': 'error',
      'no-var': 'error',
      'curly': ['error', 'all'],
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'no-dupe-else-if': 'error',
      'no-fallthrough': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      'no-unsafe-finally': 'error',
      'no-empty': 'error',
      'no-useless-catch': 'error',
      'preserve-caught-error': ['error', {
        requireCatchParameter: true,
        errorClassNames: [
          { name: 'StudioError', argumentPosition: 4 },
          { name: 'ExportError', argumentPosition: 3 },
        ],
      }],
      'arrow-body-style': ['error', 'as-needed'],
      'prefer-arrow-callback': 'error',
      'max-nested-callbacks': ['error', 3],
      'no-loop-func': 'error',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'max-depth': ['error', 3],
      'complexity': ['error', { max: 20, variant: 'modified' }],
      'no-restricted-syntax': ['error', ...errorHandlingSyntax],
      'studio/role-naming': 'error',
      'studio/no-source-comments': 'error',
      'studio/readable-condition': ['error', { max: 2 }],
      'studio/type-complexity': ['error', { maxDepth: 3 }],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: '*', next: moduleType },
        { blankLine: 'always', prev: moduleType, next: '*' },
        { blankLine: 'any', prev: moduleType, next: moduleType },
        { blankLine: 'always', prev: '*', next: moduleRoutine },
        { blankLine: 'always', prev: moduleRoutine, next: '*' },
        {
          blankLine: 'always',
          prev: ['multiline-const', 'multiline-let', 'multiline-expression'],
          next: ['if', 'for', 'while', 'switch', 'try', 'throw', 'return'],
        },
        { blankLine: 'always', prev: ['multiline-const', 'multiline-let', 'multiline-expression', 'try', 'switch'], next: 'return' },
        { blankLine: 'always', prev: guard, next: '*' },
        { blankLine: 'never', prev: guard, next: guard },
      ],
    },
  },
  {
    files: lintDirectories.map(directory => `${directory}/**/*.{tsx,jsx}`),
    languageOptions: {
      parserOptions: { babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } } },
    },
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
    files: [`src/app/canvas/**/${scripts}`],
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
