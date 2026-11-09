import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = fileURLToPath(new URL('../', import.meta.url));
const pluginRelative = 'plugins/agentero-library';
const sourceCommit = '2c0a7f85e0e3a1b78673f95abc187e04852a7f4f';
const sourceModuleRelative = `${pluginRelative}/src/app/pdf/translation`;
const sourceLicenseRelative = `${sourceModuleRelative}/MOTIF-LICENSE.txt`;
const sourceLicenseUpstream = 'packages/pdf/src/client/translation/MOTIF-LICENSE.txt';
// These npm releases omit their license text. Checked-in supplements were
// fetched once from the package's published gitHead, never from mutable HEAD.
// Collection itself is offline; upgrading a missing-license package requires
// reviewing and adding its exact source text and hash here.
const pinnedPackageLicenses = [
  ['@udecode/react-hotkeys', '52.0.11', 'udecode/plate', '0a02e15d2f704bf60d28176b97c3761fe7aa4923', 'LICENSE', '8b649e3569682298f50ed2048210e8f528034feb56f5d43a9977a7d60b0f7065'],
  ['@udecode/react-hotkeys', '52.0.11', 'JohannesKlauss/react-hotkeys-hook', '8e821c694d30454dd01609bb00a4b2fa0498121a', 'LICENSE', '1def416e8042d3442057400f3345c3bd089476898d94b5d5ae9669b0c0d340a8', 'ORIGINAL-LICENSE'],
  ['jotai-x', '2.3.4', 'udecode/jotai-x', '11cf4bb2e565c7d1734537bea3bf947e474d9a59', 'LICENSE', '5df218cd6bf499692e632d09c75078466f4e05f7c2ca2bf83febfc98c43a91a1'],
  ['react-compiler-runtime', '1.0.0', 'facebook/react', '5c15c1cd3442f28044217703b5625f98c40042ee', 'LICENSE', 'da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93'],
  ['remark-math', '6.0.0', 'remarkjs/remark-math', 'd5d0660b150810a535bbb07eac6cc96a4510aa24', 'license', 'cb992262f361a5359e6771c28740d33c7041e15332ae8537fae40538992591a9'],
  ['slate-dom', '0.146.0', 'ianstormtaylor/slate', 'b9237ba8077be40578f5882caa498c24955aa7b3', 'License.md', '519c180a1c7b62ae33d2beb749abd57dda92eddada65eb81daca7686fa1fef40'],
  ['slate-hyperscript', '0.138.3', 'ianstormtaylor/slate', '33b64bb871a5a8470b65330bb23766a8c9879ce2', 'License.md', '519c180a1c7b62ae33d2beb749abd57dda92eddada65eb81daca7686fa1fef40'],
  ['slate-react', '0.145.1', 'ianstormtaylor/slate', 'e1f20ded3d042662b576acffb266edc90b1f7b6f', 'License.md', '519c180a1c7b62ae33d2beb749abd57dda92eddada65eb81daca7686fa1fef40'],
  ['slate', '0.146.0', 'ianstormtaylor/slate', 'b9237ba8077be40578f5882caa498c24955aa7b3', 'License.md', '519c180a1c7b62ae33d2beb749abd57dda92eddada65eb81daca7686fa1fef40'],
  ['zustand-x', '6.2.1', 'udecode/zustand-x', '78abd51d8e3414ed3ae8c9b577ec273e91bdab4b', 'LICENSE', '5df218cd6bf499692e632d09c75078466f4e05f7c2ca2bf83febfc98c43a91a1'],
];
const slash = value => value.split(sep).join('/');
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, target) => {
  const value = relative(root, target);
  return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
};
const missing = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; } }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
const sort = values => [...values].sort((a, b) => a.localeCompare(b, 'en'));
async function retryLocked(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(50 * 2 ** attempt, 800)));
    }
  }
}

function inputFile(id, workingDirectory) {
  if (typeof id !== 'string') return null;
  let value = id.replace(/^\0+/, '');
  // Vite IDs can be actual files with proxy/query suffixes. Other virtual IDs
  // and built-ins are not distributable package files.
  if (value.startsWith('file:')) {
    try { value = fileURLToPath(value); } catch { return null; }
  }
  value = value.split('?')[0].split('#')[0];
  if (value.startsWith('/@fs/')) value = value.slice(5);
  if (!value.replaceAll('\\', '/').includes('/node_modules/') && !value.startsWith('node_modules/')) return null;
  return isAbsolute(value) ? value : resolve(workingDirectory, value);
}

async function packageAt(file, cache) {
  let directory = dirname(await realpath(file));
  const visited = [];
  while (true) {
    if (cache.has(directory)) { const found = cache.get(directory); for (const item of visited) cache.set(item, found); return found; }
    visited.push(directory);
    try {
      const data = await json(join(directory, 'package.json'));
      // Many dist/esm subdirectories only contain {type:"module"}. They are
      // not a package identity; continue to the real named/versioned package.
      if (typeof data.name === 'string' && data.name && typeof data.version === 'string' && data.version) {
        if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(data.name) || !/^[a-z0-9.+_-]+$/i.test(data.version)) throw new Error('Unsafe package identity in bundle inputs.');
        // Some published dist/package.json files repeat the complete package
        // identity while LICENSE remains in the enclosing package root.
        let packageRoot = directory, packageData = data;
        for (let ancestor = dirname(directory); basename(ancestor) !== 'node_modules' && ancestor !== dirname(ancestor); ancestor = dirname(ancestor)) {
          try {
            const outer = await json(join(ancestor, 'package.json'));
            if (typeof outer.name === 'string' && typeof outer.version === 'string') {
              if (outer.name !== data.name || outer.version !== data.version) break;
              packageRoot = ancestor; packageData = outer;
            }
          } catch (error) { if (!missing(error)) throw error; }
        }
        const found = { directory: packageRoot, data: packageData };
        for (const item of visited) cache.set(item, found);
        return found;
      }
    } catch (error) { if (!missing(error)) throw error; }
    const parent = dirname(directory);
    if (parent === directory) { for (const item of visited) cache.set(item, null); return null; }
    directory = parent;
  }
}

function licenseName(name) {
  const match = /^(?:licen[cs]e|notice|copying|copyright|unlicense|ofl|patents)(?:$|[._-])|(?:^|[-_.])(?:licen[cs]e|notice|copying)(?:$|[._-])/i.test(name);
  return match && !/\.(?:[cm]?js|[cm]?ts|json|map|wasm|png|jpe?g|svg|ttf|otf|woff2?|zip|gz)$/i.test(name);
}

async function licenseFiles(packageRoot) {
  const result = [];
  const walk = async (directory, depth) => {
    if (depth > 32) throw new Error('License directory nesting exceeds the supported depth.');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name);
      // pnpm may link individual LICENSE files into its content store. Read
      // those files normally, but never recurse into dependency/symlink dirs.
      if (entry.isSymbolicLink()) { if (licenseName(entry.name) && (await stat(path)).isFile()) result.push(path); continue; }
      if (entry.isDirectory() && !['node_modules', '.git', '.pnpm'].includes(entry.name)) await walk(path, depth + 1);
      else if (entry.isFile() && licenseName(entry.name)) result.push(path);
    }
  };
  await walk(packageRoot, 0);
  return result;
}

function packageLicense(data) {
  if (typeof data.license === 'string') return data.license;
  if (typeof data.license?.type === 'string') return data.license.type;
  if (Array.isArray(data.licenses)) return data.licenses.map(value => value?.type ?? String(value)).join(' OR ');
  return 'UNKNOWN';
}

/** Collect licenses only for modules actually seen by this version's build. */
export async function collectLicenses({ repoRoot = defaultRepoRoot, version } = {}) {
  const repository = await realpath(resolve(repoRoot)), pluginRoot = join(repository, pluginRelative);
  const canonicalPlugin = await realpath(pluginRoot);
  if (!inside(repository, canonicalPlugin) || slash(relative(repository, canonicalPlugin)) !== pluginRelative) throw new Error('The plugin directory must resolve inside this repository.');
  const licenseArchive = join(pluginRoot, 'assets', 'licenses');
  const packageInfo = await json(join(pluginRoot, 'package.json'));
  const selectedVersion = version ?? packageInfo.version;
  if (typeof selectedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(selectedVersion)) throw new Error('A safe semantic plugin version is required.');
  const inventoryRelative = `artifacts/agentero-library/v${selectedVersion}/validation/bundle-inputs.json`;
  const inventory = await json(join(repository, inventoryRelative));
  if (!inventory.server?.inputs || !Array.isArray(inventory.appInputs)) throw new Error('Build input inventory is missing server.inputs or appInputs; run the plugin build first.');
  const identities = new Map(), packageCache = new Map();
  for (const [scope, ids] of [['server', Object.keys(inventory.server.inputs)], ['app', inventory.appInputs]]) {
    for (const id of ids) {
      const file = inputFile(id, pluginRoot); if (!file) continue;
      if (!(await exists(file))) throw new Error(`A ${scope} package input is missing; rebuild from this checkout before collecting licenses.`);
      const found = await packageAt(file, packageCache);
      if (!found) throw new Error('A bundled node_modules input has no named/versioned package.json.');
      const key = `${found.data.name}@${found.data.version}`;
      const item = identities.get(key) ?? { data: found.data, roots: new Set(), scopes: new Set(), inputs: new Set() };
      item.roots.add(found.directory); item.scopes.add(scope); item.inputs.add(`${scope}:${await realpath(file)}`);
      identities.set(key, item);
    }
  }
  if (!identities.size) throw new Error('No bundled packages were found; refusing to replace the existing license archive.');
  const documents = new Map(), packages = [], missingPackages = [];
  const direct = new Set([...Object.keys(packageInfo.dependencies ?? {}), ...Object.keys(packageInfo.optionalDependencies ?? {})]);
  for (const [key, item] of [...identities].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const files = [], seen = new Map();
    const packageDirectory = item.data.name.replace(/^@/, '').replaceAll('/', '__');
    for (const root of sort(item.roots)) {
      for (const path of await licenseFiles(root)) {
        const upstreamPath = slash(relative(root, path)), bytes = await readFile(path), sha = hash(bytes);
        if (seen.get(upstreamPath) === sha) continue;
        const archivePath = `packages/${packageDirectory}/${item.data.version}/${seen.has(upstreamPath) ? `${sha.slice(0, 12)}-${upstreamPath}` : upstreamPath}`;
        documents.set(archivePath, bytes); seen.set(upstreamPath, sha);
        files.push({ path: archivePath, upstreamPath, source: `npm:${key}/${upstreamPath}`, sourceSha256: sha });
      }
    }
    if (!files.length) {
      for (const [name, version, upstream, commit, upstreamPath, sha, archiveName] of pinnedPackageLicenses.filter(([name, version]) => `${name}@${version}` === key)) {
        const path = `sources/npm-supplements/${name.replace(/^@/, '').replaceAll('/', '__')}/${version}/${archiveName ?? upstreamPath}`;
        const bytes = await readFile(join(licenseArchive, path));
        if (hash(bytes) !== sha) throw new Error(`Pinned license text changed for ${key}; review its source and hash.`);
        documents.set(path, bytes);
        files.push({ path, upstreamPath, upstreamCommit: commit, source: `https://raw.githubusercontent.com/${upstream}/${commit}/${upstreamPath}`, sourceSha256: sha });
      }
      if (!files.length) missingPackages.push(key);
    }
    packages.push({ name: item.data.name, version: item.data.version, license: packageLicense(item.data), scope: sort(item.scopes), direct: direct.has(item.data.name), inputCount: item.inputs.size, files: files.sort((a, b) => a.path.localeCompare(b.path, 'en')) });
  }
  if (missingPackages.length) throw new Error(`Bundled packages have no LICENSE/NOTICE/COPYING text; resolve their attribution before distributing: ${missingPackages.join(', ')}`);

  // This local file is checked in alongside the adapted source. Never reach
  // outside this checkout for a reference project's license during a build.
  const sourceLicense = join(repository, sourceLicenseRelative);
  if (!(await exists(sourceLicense))) throw new Error('The checked-in motif source license is missing.');
  const sourceBytes = await readFile(sourceLicense), sourceArchive = 'sources/motif-translation/MOTIF-LICENSE.txt';
  documents.set(sourceArchive, sourceBytes);
  const sources = [{
    name: 'motif translation core via agentero-dsh-plugin', license: 'MIT',
    upstreamRepository: 'https://github.com/poco-ai/agentero-dsh-plugin', upstreamCommit: sourceCommit,
    sourceDirectory: sourceModuleRelative,
    files: [{ path: sourceArchive, upstreamPath: sourceLicenseUpstream, source: `https://github.com/poco-ai/agentero-dsh-plugin/blob/${sourceCommit}/${sourceLicenseUpstream}`, sourceSha256: hash(sourceBytes) }],
  }];
  const manifest = { schemaVersion: 1, plugin: 'agentero-library', pluginVersion: selectedVersion, scope: 'bundled-runtime-inputs', inputInventory: inventoryRelative, packages, sources };
  const parts = ['Third-party licenses for agentero-library', '', 'Generated from the runtime build input inventory. Original license/notice texts follow.', ''];
  for (const item of [...packages, ...sources]) {
    parts.push('='.repeat(78), `${item.name}${item.version ? `@${item.version}` : ''}`, `Declared license: ${item.license}`, '');
    for (const file of item.files) parts.push(`--- ${file.source} ---`, documents.get(file.path).toString('utf8').trimEnd(), '');
  }
  documents.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  documents.set('THIRD_PARTY_LICENSES.txt', Buffer.from(`${parts.join('\n')}\n`));
  documents.set('README.md', Buffer.from('# 运行文件中的第三方许可\n\n[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) 汇总许可与声明原文；[manifest.json](manifest.json) 记录实际构建输入涉及的包、版本、来源、SHA-256 和源码许可。`packages/` 与 `sources/` 保存原文。\n\n由 `node tooling/collect-agentero-licenses.mjs` 在插件构建之后生成，不复制 node_modules，也不把整棵开发依赖列入运行清单。包内字体、CMap、ICC、WASM 等附属许可一并归档；保留许可不代表分发了每一种可选资源。源代码目录中的 motif MIT 许可从本仓库归档，来源固定到记录的上游提交。\n\n用户自行安装的 Node.js、Agentero CLI 和原生 PDFium 不随插件分发。\n'));

  const assetsRoot = join(pluginRoot, 'assets');
  if (await exists(assetsRoot) && (await lstat(assetsRoot)).isSymbolicLink()) throw new Error('The plugin assets directory must not be a symlink.');
  await mkdir(assetsRoot, { recursive: true });
  const canonicalAssets = await realpath(assetsRoot);
  if (!inside(canonicalPlugin, canonicalAssets) || relative(canonicalPlugin, canonicalAssets) !== 'assets') throw new Error('The assets directory escaped the plugin.');
  const licenseRoot = join(assetsRoot, 'licenses');
  if (await exists(licenseRoot)) { if ((await lstat(licenseRoot)).isSymbolicLink()) throw new Error('The generated license directory must not be a symlink.'); }
  await mkdir(licenseRoot, { recursive: true });
  const canonicalRoot = await realpath(licenseRoot);
  if (!inside(canonicalAssets, canonicalRoot) || relative(canonicalAssets, canonicalRoot) !== 'licenses') throw new Error('The resolved license directory escaped the plugin assets directory.');
  const checked = async target => {
    const absolute = resolve(target);
    if (absolute === canonicalRoot || !inside(canonicalRoot, absolute)) throw new Error('Refusing to touch a path outside the generated license directory.');
    // Check the nearest existing ancestor too: a missing file underneath a
    // junction must never become an out-of-tree write or rollback target.
    for (let probe = absolute; probe !== canonicalRoot; probe = dirname(probe)) {
      if (!(await exists(probe))) continue;
      const info = await lstat(probe), actual = await realpath(probe);
      const same = process.platform === 'win32' ? actual.toLowerCase() === probe.toLowerCase() : actual === probe;
      if (info.isSymbolicLink() || !inside(canonicalRoot, actual) || !same) throw new Error('Refusing to clean a generated path with a symlink or external target.');
      break;
    }
    return absolute;
  };

  const existing = new Map(), directories = [];
  const scan = async directory => {
    const path = await checked(directory);
    if (!(await exists(path))) return;
    if (!(await lstat(path)).isDirectory()) throw new Error('A generated license subtree is not a directory.');
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = await checked(join(path, entry.name));
      if (entry.isDirectory()) await scan(child);
      else if (entry.isFile()) existing.set(slash(relative(canonicalRoot, child)), await readFile(child));
      else throw new Error('Unexpected non-file entry in the generated license archive.');
    }
    directories.push(path);
  };
  for (const name of ['packages', 'sources']) await scan(join(canonicalRoot, name));
  const metadata = ['README.md', 'THIRD_PARTY_LICENSES.txt', 'manifest.json'];
  for (const name of metadata) {
    const path = await checked(join(canonicalRoot, name));
    if (await exists(path)) existing.set(name, await readFile(path));
  }
  const updates = [...documents].filter(([path, bytes]) => !existing.get(path)?.equals(bytes));
  // These checked-in supplements are source inputs, not obsolete generated
  // package output. Keep them intact even if a future bundle omits a package.
  const obsolete = [...existing.keys()].filter(path => !documents.has(path) && !path.startsWith('sources/npm-supplements/'));
  if (!updates.length && !obsolete.length) return { manifest, outputDirectory: `${pluginRelative}/assets/licenses`, packageCount: packages.length, licenseFileCount: [...packages, ...sources].reduce((total, item) => total + item.files.length, 0), sourceCount: sources.length };
  const stage = await checked(join(canonicalRoot, `.generated-${randomUUID()}`));
  await mkdir(stage);
  const applied = [];
  let keepRecovery = false;
  const replaceFile = async (relativePath, bytes) => {
    const target = await checked(join(canonicalRoot, relativePath));
    await retryLocked(() => mkdir(dirname(target), { recursive: true }));
    const temporary = await checked(join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`));
    try {
      await retryLocked(() => writeFile(temporary, bytes, { flag: 'wx' }));
      await retryLocked(async () => { await checked(target); await rename(temporary, target); });
    } finally {
      // Never unlink the destination to make a rename succeed. A persistent
      // lock must leave its prior contents in place.
      await retryLocked(() => rm(temporary, { force: true })).catch(() => undefined);
    }
  };
  try {
    // Back up only files we may change/delete, before touching any destination.
    // If rollback itself encounters a persistent lock, these exact old bytes
    // remain on disk for recovery instead of being discarded in finally.
    for (const path of [...updates.map(([path]) => path), ...obsolete]) {
      const before = existing.get(path);
      if (before === undefined) continue;
      const backup = await checked(join(stage, 'backup', path));
      await mkdir(dirname(backup), { recursive: true }); await writeFile(backup, before);
    }
    await writeFile(join(stage, 'recovery.json'), `${JSON.stringify({ changed: updates.map(([path]) => ({ path, existed: existing.has(path) })), obsolete }, null, 2)}\n`);
    // Publish the manifest last. Unchanged originals and pinned source texts
    // are not opened for writing, renamed or deleted on repeat builds.
    const ordered = [...updates.filter(([path]) => !metadata.includes(path)), ...metadata.flatMap(name => updates.filter(([path]) => path === name))];
    for (const [path, bytes] of ordered.filter(([path]) => !metadata.includes(path))) {
      await replaceFile(path, bytes); applied.push(path);
    }
    for (const path of obsolete) { const target = await checked(join(canonicalRoot, path)); await retryLocked(() => rm(target)); applied.push(path); }
    for (const directory of directories) {
      if ((await readdir(await checked(directory))).length) continue;
      await retryLocked(() => rmdir(directory));
    }
    for (const [path, bytes] of ordered.filter(([path]) => metadata.includes(path))) { await replaceFile(path, bytes); applied.push(path); }
  } catch (error) {
    const failures = [];
    for (const path of applied.reverse()) {
      try {
        const before = existing.get(path);
        if (before !== undefined) await replaceFile(path, before);
        else { const target = await checked(join(canonicalRoot, path)); await retryLocked(() => rm(target, { force: true })); }
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) {
      keepRecovery = true;
      throw new AggregateError([error, ...failures], `License collection failed and rollback was blocked; old bytes are retained at ${stage}.`);
    }
    throw new Error('License collection failed; the previous archive files were restored.', { cause: error });
  } finally {
    if (!keepRecovery) await retryLocked(async () => { await rm(await checked(stage), { recursive: true, force: true }); }).catch(error => { console.warn(`License recovery directory retained after cleanup failed (${error.code}): ${stage}`); });
  }
  return { manifest, outputDirectory: `${pluginRelative}/assets/licenses`, packageCount: packages.length, licenseFileCount: [...packages, ...sources].reduce((total, item) => total + item.files.length, 0), sourceCount: sources.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const option = process.argv[index], value = process.argv[++index];
    if (!value || !['--repo-root', '--version'].includes(option)) throw new Error('Usage: node tooling/collect-agentero-licenses.mjs [--repo-root PATH] [--version VERSION]');
    options[option === '--repo-root' ? 'repoRoot' : 'version'] = value;
  }
  const result = await collectLicenses(options);
  console.log(JSON.stringify({ pluginVersion: result.manifest.pluginVersion, packageCount: result.packageCount, licenseFileCount: result.licenseFileCount, sourceCount: result.sourceCount, outputDirectory: result.outputDirectory }));
}
