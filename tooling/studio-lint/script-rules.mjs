const rejectionHandler =
  ':matches(CallExpression[callee.property.name="catch"] > .arguments, CallExpression[callee.property.name="then"] > .arguments:nth-child(2)):matches(ArrowFunctionExpression, FunctionExpression)';
const handlingMessage =
  'Use the caught error to handle an expected case, report it, or propagate it.';
export const errorHandlingSyntax = [
  { selector: 'CatchClause[param=null]', message: handlingMessage },
  { selector: `${rejectionHandler}[params.length=0]`, message: handlingMessage },
  { selector: `${rejectionHandler} > BlockStatement[body.length=0]`, message: handlingMessage },
];
const guard = {
  selector:
    'IfStatement:not([alternate.type])[consequent.body.length=1][consequent.body.0.type=/^(ReturnStatement|ThrowStatement|ContinueStatement|BreakStatement)$/]',
};
const moduleType = {
  selector:
    ':matches(Program > :matches(TSTypeAliasDeclaration, TSInterfaceDeclaration, TSEnumDeclaration), Program > ExportNamedDeclaration[declaration.type=/^(TSTypeAliasDeclaration|TSInterfaceDeclaration|TSEnumDeclaration)$/])',
};
const moduleRoutine = {
  selector:
    ':matches(Program > :matches(FunctionDeclaration, ClassDeclaration), Program > :matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type=/^(FunctionDeclaration|ClassDeclaration|ArrowFunctionExpression)$/])',
};

export const scriptRules = {
  'one-var': ['error', 'never'],
  'prefer-const': 'error',
  'no-var': 'error',
  curly: ['error', 'all'],
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
  'preserve-caught-error': ['error', { requireCatchParameter: true }],
  'arrow-body-style': ['error', 'as-needed'],
  'prefer-arrow-callback': 'error',
  'max-nested-callbacks': ['error', 3],
  'no-loop-func': 'error',
  'no-async-promise-executor': 'error',
  'no-promise-executor-return': 'error',
  'max-depth': ['error', 3],
  complexity: ['error', { max: 20, variant: 'modified' }],
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
    {
      blankLine: 'always',
      prev: ['multiline-const', 'multiline-let', 'multiline-expression', 'try', 'switch'],
      next: 'return',
    },
    { blankLine: 'always', prev: guard, next: '*' },
    { blankLine: 'never', prev: guard, next: guard },
  ],
};
