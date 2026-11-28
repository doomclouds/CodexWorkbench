import { realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const realSourceRoot = realpathSync(sourceRoot);
const sourceExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']);

function isWithin(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isSharedSource(importer, specifier) {
  if (
    typeof specifier !== 'string' ||
    !/^\.{1,2}\//u.test(specifier) ||
    /[\\#?%]/u.test(specifier)
  ) {
    return false;
  }

  const path = resolve(dirname(importer), specifier);
  if (!isWithin(sourceRoot, path) || !sourceExtensions.has(extname(path))) {
    return false;
  }

  try {
    const target = realpathSync(path);
    return isWithin(realSourceRoot, target) && statSync(target).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return false;
    }

    throw error;
  }
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      outside: 'Use an explicit relative path to an existing shared source file inside src/.',
    },
  },
  create(context) {
    function check(node, specifier) {
      if (!isSharedSource(context.physicalFilename, specifier?.value)) {
        context.report({ node, messageId: 'outside' });
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source),
      TSImportType: (node) => check(node, node.argument?.literal ?? node.argument ?? node.source),
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node, node.source);
        }
      },
      ExportAllDeclaration: (node) => check(node, node.source),
    };
  },
};
