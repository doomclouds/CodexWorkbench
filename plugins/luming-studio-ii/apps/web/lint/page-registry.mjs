import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import babelParser from '@babel/eslint-parser';
import { sourceRoot } from './project-paths.mjs';

export const pageRegistryFile = resolve(sourceRoot, 'app/routes.ts');
const pageImport = /^\.\.\/pages\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/index\.js$/u;
const pageModules = new Set(['workbench', 'whiteboard', 'recycle-bin']);
let previousSource;
let previousEntries;

function pageBindings(statement) {
  if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') {
    return [];
  }

  const module = pageImport.exec(statement.source.value)?.[1];
  if (!module) {
    return [];
  }

  return statement.specifiers
    .filter((member) => member.type === 'ImportSpecifier' && member.importKind !== 'type')
    .map((member) => [member.local.name, module]);
}

function registryDeclaration(statement) {
  if (statement.type !== 'ExportNamedDeclaration' || statement.declaration?.kind !== 'const') {
    return [];
  }

  return statement.declaration.declarations;
}

function pageName(member) {
  if (member.type !== 'Property' || member.computed || member.value.type !== 'Identifier') {
    return undefined;
  }

  return member.key.type === 'Identifier' ? member.key.name : member.key.value;
}

export function pageRegistryEntries(program) {
  const initializer = program.body
    .flatMap(registryDeclaration)
    .find(({ id }) => id.type === 'Identifier' && id.name === 'studioPages')?.init;

  if (initializer?.type !== 'ObjectExpression') {
    return undefined;
  }

  const imports = new Map(program.body.flatMap(pageBindings));
  const entries = new Set();
  for (const member of initializer.properties) {
    const name = pageName(member);
    if (!pageModules.has(name)) {
      return undefined;
    }
    if (imports.get(member.value.name) !== name || entries.has(name)) {
      return undefined;
    }

    entries.add(name);
  }

  return entries.size > 0 ? entries : undefined;
}

export function isRegisteredPage(root) {
  const source = readFileSync(pageRegistryFile, 'utf8');
  if (source !== previousSource) {
    const { ast } = babelParser.parseForESLint(source, {
      filePath: pageRegistryFile,
      requireConfigFile: false,
      babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } },
    });
    const entries = pageRegistryEntries(ast);
    previousEntries = new Set(
      [...(entries ?? [])].map((name) => resolve(sourceRoot, 'pages', name)),
    );
    previousSource = source;
  }

  return previousEntries.has(root);
}
