import { spawnSync } from 'node:child_process';
import { glob, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lintDirectories, scriptExtensions } from '../plugins/agentero-studio/eslint.config.mjs';
import { findMarkupCommentLines, markupExtensions } from '../plugins/agentero-studio/lint/markup-comments.mjs';

const studioRoot = new URL('../plugins/agentero-studio/', import.meta.url);
const directory = fileURLToPath(studioRoot);
const requirePlugin = createRequire(new URL('package.json', studioRoot));
const { ESLint } = requirePlugin('eslint');

function runStudioTool(name, args, packageName = name) {
  const manifest = requirePlugin.resolve(`${packageName}/package.json`);
  const executable = resolve(dirname(manifest), requirePlugin(manifest).bin[name]);
  const result = spawnSync(process.execPath, [executable, ...args], { cwd: directory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Agentero Studio ${name} failed (${result.signal ?? result.status}).`);
}

export function typecheckStudio() {
  runStudioTool('tsc', ['--noEmit'], 'typescript');
}

async function selectSources(paths) {
  const extensions = [...scriptExtensions, ...markupExtensions].join(',');
  const patterns = lintDirectories.map((root) => `${root}/**/*.{${extensions}}`);
  const sources = await Array.fromAsync(glob(patterns, { cwd: directory, exclude: ['**/node_modules/**'] }));
  const selected = new Set();
  for (const path of paths) {
    const target = relative(directory, resolve(directory, path)).replaceAll('\\', '/');
    const matches = sources.map((file) => file.replaceAll('\\', '/')).filter((file) =>
      !target || file === target || file.startsWith(`${target}/`) || matchesGlob(file, target),
    );
    if (!matches.length) throw new Error(`No Studio source files match "${path}".`);
    matches.forEach((file) => selected.add(file));
  }
  return [...selected].sort();
}

async function lintMarkup(files) {
  const problems = await Promise.all(files.map(async (file) => {
    const source = await readFile(resolve(directory, file), 'utf8');
    return findMarkupCommentLines(source, extname(file)).map(
      (line) => `${file}:${line}  error  Studio source comments are prohibited.  studio/no-source-comments`,
    );
  }));
  if (problems.some((lines) => lines.length)) {
    process.stderr.write(`${problems.flat().join('\n')}\n`);
    throw new Error('Agentero Studio markup lint failed.');
  }
}

export async function lintStudio(paths = lintDirectories) {
  const sources = await selectSources(paths);
  const scripts = sources.filter((file) => scriptExtensions.includes(extname(file).slice(1)));
  await lintMarkup(sources.filter((file) => markupExtensions.includes(extname(file).slice(1))));
  if (!scripts.length) return;
  const eslint = new ESLint({
    cwd: directory,
    overrideConfigFile: fileURLToPath(new URL('eslint.config.mjs', studioRoot)),
  });
  const results = await eslint.lintFiles(scripts);
  const formatter = await eslint.loadFormatter('stylish');
  const report = await formatter.format(results);
  if (report) process.stdout.write(report);
  if (results.some(result => result.errorCount || result.warningCount)) {
    throw new Error('Agentero Studio lint failed. Resolve all errors and warnings before building.');
  }
  const files = results.map(result => relative(directory, result.filePath).replaceAll('\\', '/'));
  runStudioTool('oxlint', ['--deny-warnings', ...files]);
  runStudioTool('oxfmt', ['--check', ...files]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  await lintStudio(paths.length ? paths : undefined);
}
