import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverRoot = fileURLToPath(new URL('../', import.meta.url));

const sourceExtension = /\.(?:[cm]?[jt]s)$/u;
const emittedExtensions = new Map([
  ['.js', ['.ts', '.js']],
  ['.mjs', ['.mts', '.mjs']],
  ['.cjs', ['.cts', '.cjs']],
]);

export function projectPath(root, filePath) {
  const local = relative(root, filePath);
  if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) {
    return undefined;
  }

  return local.replaceAll(sep, '/').replace(sourceExtension, '');
}

function candidateFiles(path) {
  const extension = extname(path);
  if (emittedExtensions.has(extension)) {
    const stem = path.slice(0, -extension.length);

    return emittedExtensions.get(extension).map((suffix) => stem + suffix);
  }
  if (extension) {
    return [path];
  }

  return [path, path + '.ts', path + '.js', resolve(path, 'index.ts'), resolve(path, 'index.js')];
}

function resolveFile(path) {
  const found = candidateFiles(path).find((candidate) =>
    statSync(candidate, { throwIfNoEntry: false })?.isFile(),
  );

  return found ? realpathSync(found) : undefined;
}

function wildcardValue(specifier, pattern) {
  const star = pattern.indexOf('*');
  if (star === -1) {
    return specifier === pattern ? '' : undefined;
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

function aliasCandidates(root, specifier, config) {
  const paths = config.paths ?? {};
  const exact = paths[specifier];
  const base = resolve(root, config.baseUrl ?? '.');
  if (exact) {
    return exact.map((target) => resolve(base, target));
  }

  const matches = Object.keys(paths).filter(
    (pattern) => pattern.includes('*') && wildcardValue(specifier, pattern) !== undefined,
  );
  matches.sort((left, right) => right.indexOf('*') - left.indexOf('*'));
  const [pattern] = matches;
  if (!pattern) {
    return undefined;
  }

  const value = wildcardValue(specifier, pattern);

  return paths[pattern].map((target) => resolve(base, target.replace('*', value)));
}

function compilerOptions(root) {
  const file = resolve(root, 'tsconfig.json');
  if (!statSync(file, { throwIfNoEntry: false })) {
    return {};
  }

  return JSON.parse(readFileSync(file, 'utf8')).compilerOptions ?? {};
}

export function localResolver(root, importer) {
  const options = compilerOptions(root);

  return (specifier) => {
    if (specifier.startsWith('.')) {
      return { file: resolveFile(resolve(dirname(importer), specifier)) };
    }

    const candidates = aliasCandidates(root, specifier, options);
    if (candidates) {
      return { file: candidates.map(resolveFile).find(Boolean) };
    }

    if (options.baseUrl) {
      const file = resolveFile(resolve(root, options.baseUrl, specifier));
      if (file) {
        return { file };
      }
    }

    return undefined;
  };
}
