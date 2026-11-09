import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const textExtensions = new Set(['.md', '.json', '.yaml', '.yml', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.toml']);
const textNames = new Set(['LICENSE', '.gitignore', '.gitattributes', '.editorconfig', '.node-version']);

export async function checkRepository(root) {
  const listing = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (listing.error || listing.status !== 0) {
    throw new Error(listing.error?.message ?? listing.stderr.trim());
  }

  const files = [...new Set(listing.stdout.split('\0').filter(Boolean))];
  const errors = [];
  let checked = 0;
  for (const file of files) {
    // Preserve upstream license bytes, including their original whitespace and links.
    if (/^plugins\/[^/]+\/assets\/licenses\/(?:packages|sources)\//.test(file)) continue;
    if (!textExtensions.has(extname(file)) && !textNames.has(basename(file))) continue;
    checked += 1;
    const path = resolve(root, file);
    let text;
    try {
      const bytes = await readFile(path);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        errors.push(`${file}: remove the UTF-8 BOM`);
      }
    } catch (error) {
      errors.push(`${file}: cannot read UTF-8 text (${error.message})`);
      continue;
    }

    if (text.includes('\r')) errors.push(`${file}: use LF line endings`);
    if (text && !text.endsWith('\n')) errors.push(`${file}: add a final newline`);
    if (extname(file) === '.json') {
      try {
        JSON.parse(text);
      } catch (error) {
        errors.push(`${file}: invalid JSON (${error.message})`);
      }
    }
    if (extname(file) !== '.md') continue;

    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      try {
        const destination = resolve(dirname(path), decodeURIComponent(target.split(/[?#]/)[0]));
        const within = relative(root, destination);
        if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
          errors.push(`${file}: local link leaves the repository (${target})`);
          continue;
        }
        await access(destination);
      } catch {
        errors.push(`${file}: broken local link (${target})`);
      }
    }

    if (basename(file) === 'SKILL.md') {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
      const name = frontmatter?.match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      const description = frontmatter?.match(/^description:\s*(.+)$/m)?.[1].trim();
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || name !== basename(dirname(path))) {
        errors.push(`${file}: skill name must be kebab-case and match its directory`);
      }
      if (!description || /^['"]?\[TODO:/.test(description)) {
        errors.push(`${file}: add a skill description`);
      }
    }
  }
  return { checked, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkRepository(fileURLToPath(new URL('../', import.meta.url)));
    for (const error of result.errors) console.error(error);
    console.log(`Checked ${result.checked} text files; ${result.errors.length} problems.`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
