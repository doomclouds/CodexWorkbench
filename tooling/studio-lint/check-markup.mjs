import { glob, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

import { findMarkupCommentLines, markupExtensions } from './markup-comments.mjs';

function markupPattern(path) {
  const normalized = relative(process.cwd(), resolve(path)).replaceAll('\\', '/');
  if (markupExtensions.includes(extname(normalized).slice(1))) {
    return normalized;
  }

  return (normalized || '.') + '/**/*.{' + markupExtensions.join(',') + '}';
}

const paths = process.argv.slice(2);
const roots = paths.length ? paths : ['src', 'tests'];
const sources = await Array.fromAsync(
  glob(roots.map(markupPattern), { exclude: ['**/node_modules/**'] }),
);
const messages = await Promise.all(
  [...new Set(sources)].sort().map(async (path) => {
    const source = await readFile(path, 'utf8');
    const displayPath = path.replaceAll('\\', '/');
    return findMarkupCommentLines(source, extname(path)).map(
      (line) =>
        displayPath +
        ':' +
        line +
        '  error  Source comments are prohibited.  studio/no-source-comments',
    );
  }),
);
const violations = messages.flat();

if (violations.length) {
  process.stderr.write(violations.join('\n') + '\n');
  process.exitCode = 1;
}
