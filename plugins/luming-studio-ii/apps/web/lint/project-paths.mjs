import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from '../package.json' with { type: 'json' };
import tsconfig from '../tsconfig.json' with { type: 'json' };

const webRoot = fileURLToPath(new URL('../', import.meta.url));

export const sourceRoot = resolve(webRoot, 'src');
export const baseRoot = resolve(sourceRoot, 'ui/base');
export const testsRoot = resolve(webRoot, 'tests');
export const publicSpecifier = manifest.name + '/ui/base';

const pathRoot = resolve(webRoot, tsconfig.compilerOptions.baseUrl ?? '.');
const mappings = Object.entries(tsconfig.compilerOptions.paths ?? {});

export function contains(directory, file) {
  const path = relative(directory, file);

  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function substitute(pattern, specifier) {
  const star = pattern.indexOf('*');
  if (star === -1) {
    return pattern === specifier ? '' : undefined;
  }

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return undefined;
  }
  if (specifier.length < prefix.length + suffix.length) {
    return undefined;
  }

  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

export function aliasTargets(specifier) {
  const targets = [];
  for (const [pattern, paths] of mappings) {
    const match = substitute(pattern, specifier);
    if (match !== undefined) {
      targets.push(...paths.map((path) => resolve(pathRoot, path.replace('*', match))));
    }
  }

  return targets;
}
