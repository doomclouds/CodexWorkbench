import { spawnSync } from 'node:child_process';
import { glob, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  lintDirectories,
  scriptExtensions,
  toolingLintConfig,
} from '../plugins/luming-studio/eslint.config.mjs';
import {
  findMarkupCommentLines,
  markupExtensions,
} from '../plugins/luming-studio/lint/markup-comments.mjs';
import { findModuleBoundaryProblems } from '../plugins/luming-studio/lint/module-boundaries.mjs';

const studioRoot = new URL('../plugins/luming-studio/', import.meta.url);
const directory = fileURLToPath(studioRoot);
const repository = fileURLToPath(new URL('../', import.meta.url));
const toolingRoots = ['tooling', 'plugins/luming-studio/benchmarks'];
const requirePlugin = createRequire(new URL('package.json', studioRoot));
const { ESLint } = requirePlugin('eslint');

function runStudioTool(name, args, packageName = name, cwd = directory) {
  const manifest = requirePlugin.resolve(packageName + '/package.json');
  const executable = resolve(dirname(manifest), requirePlugin(manifest).bin[name]);
  const result = spawnSync(process.execPath, [executable, ...args], { cwd, stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      'Luming Studio ' + name + ' failed (' + (result.signal ?? result.status) + ').',
    );
  }
}

export function typecheckStudio() {
  runStudioTool('tsc', ['--noEmit'], 'typescript');
}

function normalizedPath(cwd, path) {
  return relative(cwd, resolve(cwd, path)).replaceAll('\\', '/');
}

async function selectSources(paths, cwd, roots) {
  const extensions = [...scriptExtensions, ...markupExtensions].join(',');
  const patterns = roots.map((root) => root + '/**/*.{' + extensions + '}');
  const sources = await Array.fromAsync(glob(patterns, { cwd, exclude: ['**/node_modules/**'] }));
  const selected = new Set();

  for (const path of paths) {
    const target = normalizedPath(cwd, path);
    const matches = sources
      .map((file) => file.replaceAll('\\', '/'))
      .filter(
        (file) =>
          !target || file === target || file.startsWith(target + '/') || matchesGlob(file, target),
      );

    if (!matches.length) {
      throw new Error('No source files match "' + path + '".');
    }

    matches.forEach((file) => selected.add(file));
  }

  return [...selected].sort();
}

async function lintMarkup(files, cwd) {
  const problems = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(resolve(cwd, file), 'utf8');
      return findMarkupCommentLines(source, extname(file)).map(
        (line) =>
          file + ':' + line + '  error  Source comments are prohibited.  studio/no-source-comments',
      );
    }),
  );

  if (problems.some((lines) => lines.length)) {
    process.stderr.write(problems.flat().join('\n') + '\n');
    throw new Error('Markup lint failed.');
  }
}

async function lintModuleBoundaries(scripts) {
  const selected = new Set(scripts);
  const all = await selectSources(lintDirectories, directory, lintDirectories);
  const sources = await Promise.all(
    all
      .filter((filePath) => scriptExtensions.includes(extname(filePath).slice(1)))
      .map(async (filePath) => ({
        filePath,
        source: await readFile(resolve(directory, filePath), 'utf8'),
      })),
  );
  const problems = (await findModuleBoundaryProblems(sources, directory)).filter(
    ({ filePath, relatedFiles }) =>
      selected.has(filePath) || relatedFiles?.some((file) => selected.has(file)),
  );

  if (problems.length === 0) {
    return;
  }

  const messages = problems.map(({ filePath, line, column, message, rule, target }) => {
    const dependency = target ? ' (' + target + ')' : '';
    return filePath + ':' + line + ':' + column + '  error  ' + message + dependency + '  ' + rule;
  });
  process.stderr.write(messages.join('\n') + '\n');
  throw new Error('Luming Studio module boundary lint failed.');
}

async function lintScripts(scripts, options, scope) {
  const eslint = new ESLint(options);
  const results = await eslint.lintFiles(scripts);
  const formatter = await eslint.loadFormatter('stylish');
  const report = await formatter.format(results);

  if (report) {
    process.stdout.write(report);
  }
  if (results.some((result) => result.errorCount || result.warningCount)) {
    throw new Error(scope + ' lint failed. Resolve all errors and warnings before building.');
  }
}

export async function lintTooling(paths = toolingRoots) {
  const sources = await selectSources(paths, repository, toolingRoots);
  const scripts = sources.filter((file) => scriptExtensions.includes(extname(file).slice(1)));
  await lintMarkup(
    sources.filter((file) => markupExtensions.includes(extname(file).slice(1))),
    repository,
  );

  if (!scripts.length) {
    return;
  }

  await lintScripts(
    scripts,
    {
      cwd: repository,
      overrideConfigFile: true,
      overrideConfig: toolingLintConfig,
    },
    'Repository tooling',
  );
  runStudioTool(
    'oxfmt',
    ['--check', '--config', resolve(directory, '.oxfmtrc.json'), ...scripts],
    'oxfmt',
    repository,
  );
}

export async function lintStudio(paths = lintDirectories) {
  const sources = await selectSources(paths, directory, lintDirectories);
  const scripts = sources.filter((file) => scriptExtensions.includes(extname(file).slice(1)));
  await lintMarkup(
    sources.filter((file) => markupExtensions.includes(extname(file).slice(1))),
    directory,
  );

  if (!scripts.length) {
    return;
  }

  await lintScripts(
    scripts,
    {
      cwd: directory,
      overrideConfigFile: fileURLToPath(new URL('eslint.config.mjs', studioRoot)),
    },
    'Luming Studio',
  );
  await lintModuleBoundaries(scripts);
  runStudioTool('oxlint', ['--deny-warnings', ...scripts]);
  runStudioTool('oxfmt', ['--check', ...scripts]);
}

async function lintRequestedSources(paths) {
  if (!paths.length) {
    await lintTooling();
    await lintStudio();
    return;
  }

  const tooling = [];
  const studio = [];
  for (const path of paths) {
    const normalized = normalizedPath(repository, path);

    if (toolingRoots.some((root) => normalized === root || normalized.startsWith(root + '/'))) {
      tooling.push(normalized);
    } else {
      studio.push(path);
    }
  }

  if (tooling.length) {
    await lintTooling(tooling);
  }
  if (studio.length) {
    await lintStudio(studio);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await lintRequestedSources(process.argv.slice(2));
}
