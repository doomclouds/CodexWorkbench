import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import babelParser from '@babel/eslint-parser';
import { ESLint, RuleTester } from 'eslint';
import { findMarkupCommentLines } from './markup-comments.mjs';
import studio from './studio-rules.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: {
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
      },
    },
  },
});

tester.run('studio/role-naming', studio.rules['role-naming'], {
  valid: [
    'interface BoardProps { onOpen: () => void } type BoardId = string; export default function Board() { return <div />; }',
    'interface WireEvent { onclick: () => void; origin_url: string } declare type external_value = string;',
    'function renderNode() { return <span />; } export function Surface() { const x = 8; return <div data-x={x}>{renderNode()}</div>; }',
    'import { useState } from "react"; function useViewport() { return useState(0); } function View() { useState(0); return null; }',
    'import { forwardRef as forward } from "react"; const Item = forward(() => null); const forwardRef = f => f; const helper = forwardRef(() => null);',
    'function toggle() { open(); } function handleOpen() { select(); open(); } const Page = () => <button onClick={toggle} onDoubleClick={handleOpen} />;',
    'import { save } from "./service"; const Page = () => <button onClick={save} />;',
    'function Dialog({ onClose }: { onClose(): void }) { prepare(); return <button onClick={onClose} />; }',
  ],
  invalid: [
    { code: 'type board_id = string; interface board_props {} enum size { Small }', errors: [{ messageId: 'type' }, { messageId: 'type' }, { messageId: 'type' }] },
    { code: 'export default function boardView() { return <div />; }', errors: [{ messageId: 'component' }] },
    { code: 'const boardCard = () => <button />; const view = <boardCard />;', errors: [{ messageId: 'component' }] },
    { code: 'const boardCard = () => <button />; export default boardCard;', errors: [{ messageId: 'component' }] },
    { code: 'export default () => <div />;', errors: [{ messageId: 'component' }] },
    { code: 'import * as React from "react"; const board: React.FC = () => null;', errors: [{ messageId: 'component' }] },
    { code: 'import { memo as wrap } from "react"; const view = wrap(() => null);', errors: [{ messageId: 'component' }] },
    { code: 'import { useState as state } from "react"; function use_viewport() { return state(0); }', errors: [{ messageId: 'hook' }] },
    { code: 'import * as React from "react"; const observe = () => React.useEffect(() => {});', errors: [{ messageId: 'hook' }] },
    { code: 'type MenuProps = { on_select(): void }; const view = <button onclick={() => {}} />;', errors: [{ messageId: 'event' }, { messageId: 'event' }] },
    { code: 'import type { MouseEventHandler as Handler } from "react"; interface BoardProps { activate: Handler<HTMLButtonElement> }', errors: [{ messageId: 'event' }] },
    { code: 'function save() { validate(); publish(); } const page = <button onClick={save} onKeyDown={save} />;', errors: [{ messageId: 'handler' }] },
    { code: 'const save = () => { if (ready) publish(); }; const page = <button onClick={save} />;', errors: [{ messageId: 'handler' }] },
    { code: 'import { useCallback } from "react"; function Page() { const save = useCallback(() => { prepare(); publish(); }, []); return <button onClick={save} />; }', errors: [{ messageId: 'handler' }] },
  ],
});

const license = readFileSync(new URL('../assets/licenses/sources/open-artifacts/LICENSE', import.meta.url), 'utf8').trimEnd();
const licenseComment = ['/*!', ...license.split('\n').map((line) => line ? ` * ${line}` : ' *'), ' */'].join('\n');

tester.run('studio/no-source-comments', studio.rules['no-source-comments'], {
  valid: [
    'const source = "<!-- HTML --> // URL /* text */"; const view = <pre>{source}</pre>;',
  ],
  invalid: [
    { code: 'const view = <div>{/* JSX note */}</div>;\n// another note', errors: [{ messageId: 'comment' }, { messageId: 'comment' }] },
    { code: '// @vitest-environment jsdom\nconst view = <div />;', errors: [{ messageId: 'comment' }] },
    { filename: 'src/core/shared/safe-merge.ts', code: licenseComment + '\nconst merge = 42;', errors: [{ messageId: 'comment' }] },
    { filename: 'src/app/shared/comments/CommentPopover.tsx', code: '/** Positions a comment. */\nconst view = <div />;', errors: [{ messageId: 'comment' }] },
  ],
});

it('rejects CSS comments in selectors and values while keeping string content', () => {
  const source = [
    '/* leading */',
    '.item/**/.selected { color: /* inline */ red; content: "/* literal */"; }',
    '.item { background-image: url(https://example.invalid/a.svg); }',
  ].join('\n');
  assert.deepEqual(findMarkupCommentLines(source, '.css'), [1, 2, 2]);
});

it('rejects HTML, template, inline CSS and script comments while keeping literal data', () => {
  const source = [
    '<!-- leading -->',
    '<div style="color: /* inline */ red" data-value="<!-- literal -->"></div>',
    '<style>.item { color: /* embedded */ red; }</style>',
    '<script type="module">const value = 1; // embedded',
    '</script>',
    '<template><!-- nested --></template>',
    '<script type="application/json">{"text":"<!-- data -->"}</script>',
    '<button onclick="return true; // handler">Button</button>',
  ].join('\n');
  assert.deepEqual(findMarkupCommentLines(source, '.html'), [1, 2, 3, 4, 6, 8]);
});

tester.run('studio/readable-condition', studio.rules['readable-condition'], {
  valid: [
    'if (a && (b || c)) apply();',
    'const eligible = a && b && c && d; if (eligible) apply();',
    'if (records.some((record) => record.a && record.b && record.c && record.d)) apply();',
    'while (a ?? b) break;',
    { code: 'if (a && b && c && d) apply();', options: [{ max: 3 }] },
  ],
  invalid: [
    { code: 'if ((a && b) || !(c && d)) apply();', errors: [{ messageId: 'tooManyOperators', data: { count: 3, max: 2 } }] },
    { code: 'const state = !(a && b && c && d) ? 1 : 2;', errors: [{ messageId: 'tooManyOperators', data: { count: 3, max: 2 } }] },
    { code: 'while (a && (b && c || d)) break;', errors: [{ messageId: 'tooManyOperators' }] },
    { code: 'do { apply(); } while (a || (b && c && d));', errors: [{ messageId: 'tooManyOperators' }] },
    { code: 'for (let i = 0; a && (b || (c && d)); i++) apply();', errors: [{ messageId: 'tooManyOperators' }] },
    { code: 'if (a && b && records.some(() => { if (c && d && e && f) return true; })) apply();', errors: [{ messageId: 'tooManyOperators' }] },
    { code: 'if ((a ? b && c : d && e) || f) apply();', errors: [{ messageId: 'tooManyOperators' }] },
    { code: 'if ((a && b && c && d ? yes : no) || e) apply();', errors: [{ messageId: 'tooManyOperators' }] },
  ],
});

tester.run('studio/type-complexity', studio.rules['type-complexity'], {
  valid: [
    'type Json = string | Json[] | { [key: string]: Json };',
    'type Row = { id: string }; type Rows = Promise<ReadonlyArray<Row>>;',
    'type Rows = Promise<ReadonlyArray<{ id: string }>>;',
    'interface Zone { cells: Map<string, ReadonlyArray<Cell>> }',
    { code: 'type Rows = Promise<Array<Readonly<{ id: string }>>>;', options: [{ maxDepth: 4 }] },
  ],
  invalid: [
    {
      code: 'type Rows = Promise<Array<Readonly<{ id: string }>>>;',
      errors: [{ messageId: 'tooDeep', data: { depth: 4, maxDepth: 3 } }],
    },
    {
      code: 'interface Props { run: () => Promise<readonly [ReadonlyArray<string>]> }',
      errors: [{ messageId: 'tooDeep', data: { depth: 4, maxDepth: 3 } }],
    },
  ],
});

tester.run('studio/managed-tool-names', studio.rules['managed-tool-names'], {
  valid: [
    'client.call(STUDIO_TOOLS.apply, args);',
    'const hint = "使用 artifact_apply 写入白板";',
    {
      filename: fileURLToPath(new URL('../src/contracts/studio.ts', import.meta.url)),
      code: 'export const STUDIO_TOOLS = { apply: "artifact_apply" } as const;',
    },
  ],
  invalid: [
    { code: 'client.call("artifact_apply", args);', errors: [{ messageId: 'useContract' }] },
    { code: 'send({ name: "studio_app_request" });', errors: [{ messageId: 'useContract' }] },
  ],
});

tester.run('studio/no-stringified-comparison', studio.rules['no-stringified-comparison'], {
  valid: [
    'const body = JSON.stringify(board);',
    'const matches = jsonEqual(left, right);',
    'const unchanged = JSON.stringify(board) === originalRequest;',
    'function compare(JSON, left, right) { return JSON.stringify(left) === JSON.stringify(right); }',
  ],
  invalid: [
    { code: 'JSON.stringify(left) === JSON.stringify(right);', errors: [{ messageId: 'compareValues' }] },
    { code: 'JSON["stringify"](left) !== JSON.stringify(right);', errors: [{ messageId: 'compareValues' }] },
    { code: 'JSON.stringify(left) != JSON.stringify(right);', errors: [{ messageId: 'compareValues' }] },
  ],
});

it('keeps layer dependencies and view composition in their owning modules', async () => {
  const lint = new ESLint({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
  const invalidImports = [
    ['src/contracts/example.ts', "export { StudioService } from '../core/service';"],
    ['src/core/example.ts', "import { connectStudio } from '../server/client';"],
    ['src/app/StudioEditorView.tsx', "import type { StudioController } from './StudioApp.js';"],
    ['src/app/StudioLibraryView.tsx', "import { StudioEditorView } from '../app/StudioEditorView';"],
    ['src/app/StudioEditorView.tsx', "import { createServer } from 'node:http';"],
  ];
  const validImports = [
    ['src/app/StudioApp.tsx', "import { StudioEditorView } from './StudioEditorView';"],
    ['src/app/StudioLibraryView.tsx', "import type { Artifact } from '../contracts/studio';"],
    ['src/core/example.ts', "import type { Board } from '../contracts/studio';"],
  ];

  for (const [filePath, source] of invalidImports) {
    const [result] = await lint.lintText(source, { filePath });
    assert.deepEqual(result.messages.map(({ ruleId }) => ruleId), ['no-restricted-imports']);
  }

  for (const [filePath, source] of validImports) {
    const [result] = await lint.lintText(source, { filePath });
    assert.deepEqual(result.messages, []);
  }
});

it('separates a group of guards from the main flow and keeps related guards together', async () => {
  const lint = new ESLint({
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    fix: (problem) => problem.ruleId === '@stylistic/padding-line-between-statements',
  });
  const code = [
    "import { load } from './storage';",
    'function open(board) {',
    '  if (!board) {',
    '    return;',
    '  }',
    '',
    '  if (board.closed) {',
    '    return;',
    '  }',
    '  load(board);',
    '}',
    '',
  ].join('\n');
  const [result] = await lint.lintText(code, { filePath: 'src/app/layout-probe.ts' });
  assert.equal(result.messages.length, 0);
  assert.match(result.output, /storage';\n\nfunction open/u);
  assert.match(result.output, /\n  \}\n  if \(board\.closed\)/u);
  assert.match(result.output, /\n  \}\n\n  load\(board\);/u);
});
